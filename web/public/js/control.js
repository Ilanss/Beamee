'use strict';

// ---------------------------------------------------------------------------
// Beamee Web — Control UI
//
// Adapted from renderer/js/renderer.js.
// All Electron-specific calls (ipcRenderer, window.fs) are replaced with
// fetch() and WebSocket. The core song/projection logic is unchanged.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'beamee_preferences';

function loadStoredPreferences() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

let currentSongPath = null;
let currentSongData = null;
let currentLyrics = [];
let currentVerseIndex = undefined;
let currentPreferences = null;
let currentUseArrangement = true;
let libraryState = null; // { tree, songsById }
let projectorWindow = null; // reference to the popup opened by the toggle button

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------

const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
let ws = null;
let wsReconnectTimer = null;

function wsSend(type, payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type, payload }));
    }
}

function connectWs() {
    ws = new WebSocket(WS_URL);

    ws.addEventListener('open', () => {
        clearTimeout(wsReconnectTimer);
    });

    ws.addEventListener('message', (event) => {
        let msg;
        try {
            msg = JSON.parse(event.data);
        } catch {
            return;
        }

        const { type, payload } = msg;

        switch (type) {
            case 'state:sync':
                handleRemoteStateSync(payload);
                break;
            case 'preferences:changed':
                if (payload) {
                    applyPreviewPreferences(payload);
                    if (payload.theme) {
                        document.documentElement.setAttribute('data-theme', resolveTheme(payload.theme));
                    }
                }
                break;
            default:
                break;
        }
    });

    ws.addEventListener('close', () => {
        wsReconnectTimer = setTimeout(connectWs, 2000);
    });

    ws.addEventListener('error', () => {
        ws.close();
    });

    // Expose socket for settings.js (loaded inside the settings iframe on the
    // same origin) to reuse for broadcasting preferences:changed messages.
    window.__beameeWs = ws;
}

// Apply a full state snapshot pushed by the server (e.g. on reconnect or
// when another control client changes something).
function handleRemoteStateSync(state) {
    if (!state) {
        return;
    }

    // Server thinks projection is on but we have no live popup (e.g. page was
    // refreshed while the projector was open). Reset server state to off so
    // the button starts in the correct play state.
    if (state.isProjectionOn && (!projectorWindow || projectorWindow.closed)) {
        projectorWindow = null;
        setToggleProjectionIcon(false);
        wsSend('projection:toggle');
        return;
    }

    setToggleProjectionIcon(state.isProjectionOn);
    // If another client turned projection off, close our popup if it's still open.
    if (!state.isProjectionOn && projectorWindow && !projectorWindow.closed) {
        projectorWindow.close();
        projectorWindow = null;
    }
}

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const libraryUl             = document.getElementById('library-ul');
const librarySearch         = document.getElementById('library-search');
const searchIcon            = document.getElementById('search-icon');
const verseList             = document.getElementById('verse-list');
const songNameNode          = document.getElementById('song-name');
const songNumberNode        = document.getElementById('song-number');
const songPlaceholder       = document.getElementById('song-placeholder');
const previewEl             = document.getElementById('preview');
const previewLyrics         = document.getElementById('preview-lyrics');
const arrangementCheckbox   = document.getElementById('arrangement');
const toggleProjectionBtn   = document.getElementById('toggle-projection');
const prevVerseBtn          = document.getElementById('prev-verse');
const nextVerseBtn          = document.getElementById('next-verse');
const blackScreenBtn        = document.getElementById('black-screen');

// ---------------------------------------------------------------------------
// i18n — minimal inline map for section type labels
// ---------------------------------------------------------------------------

const SECTION_LABELS = {
    verse:       'Verse',
    chorus:      'Chorus',
    'pre-chorus':'Pre-chorus',
    bridge:      'Bridge',
    intro:       'Intro',
    outro:       'Outro',
    tag:         'Tag',
    other:       'Other',
};

function sectionLabel(type) {
    return SECTION_LABELS[type] || 'Other';
}

// ---------------------------------------------------------------------------
// Search helpers (verbatim from renderer.js)
// ---------------------------------------------------------------------------

function normalizeSearchText(value) {
    return String(value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
}

// ---------------------------------------------------------------------------
// Song expansion (verbatim from renderer.js — no Electron deps)
// ---------------------------------------------------------------------------

function expandSongForProjection(songData, useArrangement = true) {
    if (!songData || !Array.isArray(songData.sections)) {
        return [];
    }

    const sectionsById = new Map(
        songData.sections
            .filter((s) => s && typeof s.id === 'string')
            .map((s) => [s.id, s])
    );

    if (!useArrangement || !Array.isArray(songData.arrangement) || songData.arrangement.length === 0) {
        return songData.sections
            .filter((s) => s && typeof s.id === 'string')
            .map((s) => ({
                id: s.id,
                type: s.type || 'other',
                label: s.title || s.type || 'other',
                text: Array.isArray(s.lines) ? s.lines.join('\n') : '',
            }));
    }

    return songData.arrangement
        .map((step) => {
            const section = sectionsById.get(step?.sectionId);
            if (!section) return null;
            return {
                id: section.id,
                type: section.type || 'other',
                label: step.label || section.title || section.type || 'other',
                text: Array.isArray(section.lines) ? section.lines.join('\n') : '',
            };
        })
        .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Text helpers (verbatim from renderer.js)
// ---------------------------------------------------------------------------

function appendTextWithLineBreaks(parent, value) {
    if (!parent) return;
    const lines = String(value ?? '').split('\n');
    lines.forEach((line, i) => {
        if (i > 0) parent.appendChild(document.createElement('br'));
        parent.appendChild(document.createTextNode(line));
    });
}

// ---------------------------------------------------------------------------
// Preview panel styling
// ---------------------------------------------------------------------------

function applyPreviewPreferences(preferences) {
    if (!previewEl || !preferences) return;

    currentPreferences = preferences;
    currentUseArrangement = preferences.useArrangement !== false;

    if (arrangementCheckbox && arrangementCheckbox.checked !== currentUseArrangement) {
        arrangementCheckbox.checked = currentUseArrangement;
    }

    previewEl.style.fontFamily = preferences.fontFamily;
    const previewWidth = previewEl.offsetWidth || 1280;
    previewEl.style.fontSize = `${preferences.fontSize * (previewWidth / 1280)}px`;
    previewEl.style.color = preferences.textColor;
    previewEl.style.backgroundColor = preferences.backgroundColor;
    previewEl.style.lineHeight = String(preferences.lineHeight);
    previewEl.style.paddingTop = `${preferences.paddingTop}px`;
    previewEl.style.paddingBottom = `${preferences.paddingBottom}px`;
    previewEl.style.paddingLeft = `${preferences.paddingLeft}px`;
    previewEl.style.paddingRight = `${preferences.paddingRight}px`;

    if (preferences.backgroundImage) {
        previewEl.style.backgroundImage = `url('/assets/${preferences.backgroundImage}')`;
        previewEl.style.backgroundSize = 'cover';
        previewEl.style.backgroundPosition = 'center';
    } else {
        previewEl.style.backgroundImage = '';
        previewEl.style.backgroundSize = '';
        previewEl.style.backgroundPosition = '';
    }
}

// ---------------------------------------------------------------------------
// Projection controls
// ---------------------------------------------------------------------------

function setToggleProjectionIcon(isOn) {
    if (!toggleProjectionBtn) return;
    if (isOn) {
        // Stop square
        toggleProjectionBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="size-4"><rect width="10" height="10" x="3" y="3" rx="1.5"/></svg>';
    } else {
        // Play triangle
        toggleProjectionBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="size-4"><path d="M3 3.732a1.5 1.5 0 0 1 2.305-1.265l6.706 4.267a1.5 1.5 0 0 1 0 2.531l-6.706 4.268A1.5 1.5 0 0 1 3 12.267V3.732Z"/></svg>';
    }
}

function updateProjection() {
    if (!Array.isArray(currentLyrics) || currentVerseIndex === undefined || !currentLyrics[currentVerseIndex]) {
        if (previewLyrics) previewLyrics.replaceChildren();
        return;
    }

    const verseText = currentLyrics[currentVerseIndex].text;

    if (previewLyrics) {
        previewLyrics.replaceChildren();
        const paragraph = document.createElement('p');
        paragraph.style.margin = '0';
        appendTextWithLineBreaks(paragraph, verseText);
        previewLyrics.appendChild(paragraph);
    }

    if (currentPreferences) {
        applyPreviewPreferences(currentPreferences);
    }

    wsSend('display:lyrics', { text: verseText });
}

function setActiveVerseHighlight(index) {
    verseList.querySelectorAll('li[data-verse-index]').forEach((el) => {
        el.classList.remove('bg-base-300');
    });
    if (index !== undefined) {
        const target = verseList.querySelector(`li[data-verse-index="${index}"]`);
        target?.classList.add('bg-base-300');
        target?.scrollIntoView({ block: 'nearest' });
    }
}

function changeToPrevVerse() {
    if (currentVerseIndex !== undefined && currentVerseIndex > 0) {
        currentVerseIndex--;
        setActiveVerseHighlight(currentVerseIndex);
        updateProjection();
    }
}

function changeToNextVerse() {
    if (
        currentVerseIndex !== undefined &&
        Array.isArray(currentLyrics) &&
        currentVerseIndex < currentLyrics.length - 1
    ) {
        currentVerseIndex++;
        setActiveVerseHighlight(currentVerseIndex);
        updateProjection();
    }
}

function changeToChorus() {
    if (!Array.isArray(currentLyrics)) return;
    const idx = currentLyrics.findIndex((v) => v?.type === 'chorus');
    if (idx === -1) return;
    currentVerseIndex = idx;
    setActiveVerseHighlight(idx);
    updateProjection();
}

// ---------------------------------------------------------------------------
// Song view rendering
// ---------------------------------------------------------------------------

function renderSongView(songData) {
    const verses = expandSongForProjection(songData, currentUseArrangement);
    currentLyrics = verses;
    currentVerseIndex = undefined;

    verseList.replaceChildren();

    if (verses.length === 0) {
        showSongPlaceholder();
        return;
    }

    verses.forEach((verse, i) => {
        const li = document.createElement('li');
        li.setAttribute('data-verse-index', String(i));
        li.id = `verse-${i}`;

        const label = document.createElement('p');
        label.className = 'mt-2 text-xs uppercase';
        const verseNum = verse.id.split('-').slice(-1)[0];
        const displayLabel =
            verse.label && verse.label !== verse.type
                ? verse.label
                : sectionLabel(verse.type || 'other');
        label.textContent = `#${verseNum} ${displayLabel}`;

        const text = document.createElement('div');
        appendTextWithLineBreaks(text, verse.text);

        li.appendChild(label);
        li.appendChild(text);
        li.classList.add(
            'bg-base-200', 'p-2', 'px-4', 'pb-3',
            'hover:bg-base-300', 'active:bg-base-300',
            'rounded-field', 'cursor-pointer'
        );

        li.addEventListener('click', () => {
            currentVerseIndex = i;
            setActiveVerseHighlight(i);
            updateProjection();
        });

        verseList.appendChild(li);
    });
}

function renderSongHeader(songData) {
    if (!songData) {
        songNameNode.textContent = '';
        songNumberNode.textContent = '';
        return;
    }

    songNameNode.textContent = songData.name || '';

    const collection = Array.isArray(songData.collections) && songData.collections[0];
    if (collection) {
        const ref = collection.reference || collection.collectionId || '';
        const num = collection.number != null ? ` #${collection.number}` : '';
        songNumberNode.textContent = `${ref}${num}`;
    } else {
        songNumberNode.textContent = '';
    }
}

function showSongPlaceholder() {
    verseList.replaceChildren();
    const placeholder = document.createElement('li');
    placeholder.id = 'song-placeholder';
    placeholder.className = 'text-center pt-16 text-lg font-bold';
    placeholder.innerHTML = `<p>
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
             stroke-width="1.5" stroke="currentColor" class="size-6 inline-block mr-3">
            <path stroke-linecap="round" stroke-linejoin="round"
                  d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18"/>
        </svg>
        Select a song
    </p>`;
    verseList.appendChild(placeholder);
}

// ---------------------------------------------------------------------------
// Load a song by file path (fetch from server)
// ---------------------------------------------------------------------------

async function loadSong(songPath) {
    if (!songPath) return;

    try {
        const res = await fetch(`/api/song?path=${encodeURIComponent(songPath)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const songData = await res.json();

        currentSongPath = songPath;
        currentSongData = songData;

        if (previewLyrics) previewLyrics.replaceChildren();

        renderSongHeader(songData);
        renderSongView(songData);
        pinActiveSongInLibrary(songPath);
    } catch (err) {
        console.error('Failed to load song', err);
        currentSongPath = null;
        currentSongData = null;
        currentLyrics = [];
        currentVerseIndex = undefined;
        renderSongHeader(null);
        showSongPlaceholder();
    }
}

// ---------------------------------------------------------------------------
// Library rendering
// ---------------------------------------------------------------------------

function buildLibrarySearchText(song) {
    const parts = [];

    const add = (v) => {
        if (typeof v === 'string' && v.trim()) parts.push(v.trim());
    };

    add(song.name);
    (song.authors || []).forEach(add);
    (song.collections || []).forEach((col) => {
        add(col.name);
        add(col.reference);
        add(col.collectionId);
        if (col.number != null) add(String(col.number));
    });
    (song.tags || []).forEach(add);

    return normalizeSearchText(parts.join(' '));
}

function renderLibrary(state) {
    libraryState = state;
    libraryUl.replaceChildren();

    if (!state || !Array.isArray(state.tree) || state.tree.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'p-2 opacity-60 text-sm';
        empty.textContent = 'Library is empty.';
        libraryUl.appendChild(empty);
        return;
    }

    state.tree.forEach((node) => {
        if (node.isDirectory) {
            renderCollectionNode(node);
        } else {
            renderSongNode(libraryUl, node, state.songsById);
        }
    });
}

const ICON_FOLDER = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="h-4 w-4"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"/></svg>`;
const ICON_SONG   = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="h-4 w-4"><path stroke-linecap="round" stroke-linejoin="round" d="m9 9 10.5-3m0 6.553v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 1 1-.99-3.467l2.31-.66a2.25 2.25 0 0 0 1.632-2.163Zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 1 1-.99-3.467l2.31-.66A2.25 2.25 0 0 0 9 15.553Z"/></svg>`;

function renderCollectionNode(collection) {
    const li = document.createElement('li');

    const details = document.createElement('details');

    const summary = document.createElement('summary');
    const iconSpan = document.createElement('span');
    iconSpan.innerHTML = ICON_FOLDER;
    summary.appendChild(iconSpan);
    summary.appendChild(document.createTextNode(collection.name));

    const childUl = document.createElement('ul');

    (collection.children || []).forEach((child) => {
        renderSongNode(childUl, child, libraryState.songsById);
    });

    details.appendChild(summary);
    details.appendChild(childUl);
    li.appendChild(details);
    libraryUl.appendChild(li);
}

function renderSongNode(parentUl, node, songsById) {
    const song = songsById[node.id] || node;
    const li = document.createElement('li');
    li.setAttribute('data-song-path', node.path);
    li.setAttribute('data-song-id', node.id || '');
    li.setAttribute('data-library-search-text', buildLibrarySearchText(song));

    const a = document.createElement('a');
    a.classList.add('flex');

    const iconSpan = document.createElement('span');
    iconSpan.innerHTML = ICON_SONG;
    a.appendChild(iconSpan);

    if (node.collectionNumber != null) {
        const numSpan = document.createElement('span');
        numSpan.className = 'opacity-60';
        numSpan.textContent = '#' + node.collectionNumber;
        a.appendChild(numSpan);
    }

    a.appendChild(document.createTextNode(song.name || node.name.replace('.json', '')));
    li.appendChild(a);

    li.addEventListener('click', () => {
        loadSong(node.path);
    });

    parentUl.appendChild(li);
}

// ---------------------------------------------------------------------------
// Pin the active song in the sidebar (highlight)
// ---------------------------------------------------------------------------

function pinActiveSongInLibrary(songPath) {
    // Remove active class from all song anchors
    libraryUl.querySelectorAll('li[data-song-path] a').forEach((el) => {
        el.classList.remove('active');
    });

    if (!songPath) return;

    const target = libraryUl.querySelector(`li[data-song-path="${CSS.escape(songPath)}"]`);
    if (target) {
        const a = target.querySelector('a');
        if (a) a.classList.add('active');
        // Open parent <details> if collapsed
        const parentDetails = target.closest('details');
        if (parentDetails) parentDetails.open = true;
    }
}

// ---------------------------------------------------------------------------
// Search / filter
// ---------------------------------------------------------------------------

function applyLibrarySearchFilter() {
    const query = normalizeSearchText(librarySearch.value);

    if (!query) {
        libraryUl.querySelectorAll('li[data-song-path]').forEach((el) => {
            el.hidden = false;
        });
        libraryUl.querySelectorAll('details').forEach((el) => {
            el.hidden = false;
        });
        setSearchIcon(false);
        return;
    }

    setSearchIcon(true);

    libraryUl.querySelectorAll('details').forEach((details) => {
        let anyVisible = false;

        details.querySelectorAll('li[data-song-path]').forEach((li) => {
            const text = li.getAttribute('data-library-search-text') || '';
            const match = text.includes(query);
            li.hidden = !match;
            if (match) {
                anyVisible = true;
                details.open = true;
            }
        });

        details.hidden = !anyVisible;
    });

    // Root-level song nodes (no collection)
    libraryUl.querySelectorAll(':scope > li[data-song-path]').forEach((li) => {
        const text = li.getAttribute('data-library-search-text') || '';
        li.hidden = !text.includes(query);
    });
}

function setSearchIcon(isSearching) {
    if (!searchIcon) return;
    if (isSearching) {
        searchIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"
            viewBox="0 0 24 24" fill="currentColor">
            <path fill-rule="evenodd"
                  d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25Zm-1.72 6.97a.75.75 0 1 0-1.06 1.06L10.94 12l-1.72 1.72a.75.75 0 1 0 1.06 1.06L12 13.06l1.72 1.72a.75.75 0 1 0 1.06-1.06L13.06 12l1.72-1.72a.75.75 0 1 0-1.06-1.06L12 10.94l-1.72-1.72Z"
                  clip-rule="evenodd"/>
        </svg>`;
    } else {
        searchIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22"
            viewBox="0 0 30 30" fill="currentColor">
            <path d="M13 3C7.489 3 3 7.489 3 13s4.489 10 10 10a9.95 9.95 0 0 0 6.322-2.264l5.971 5.971a1 1 0 1 0 1.414-1.414l-5.97-5.97A9.95 9.95 0 0 0 23 13c0-5.511-4.489-10-10-10m0 2c4.43 0 8 3.57 8 8s-3.57 8-8 8-8-3.57-8-8 3.57-8 8-8"/>
        </svg>`;
    }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

toggleProjectionBtn.addEventListener('click', () => {
    const projectorIsOpen = projectorWindow && !projectorWindow.closed;

    if (projectorIsOpen) {
        // Second click — stop projection: close the popup and notify server.
        projectorWindow.close();
        projectorWindow = null;
        if (previewLyrics) previewLyrics.replaceChildren();
        currentVerseIndex = undefined;
        setActiveVerseHighlight(undefined);
        setToggleProjectionIcon(false);
        wsSend('projection:toggle');
    } else {
        // First click — start projection: open the popup and notify server.
        projectorWindow = window.open(
            '/projector',
            'beamee-projector',
            'width=1280,height=720,menubar=no,toolbar=no,location=no,status=no,scrollbars=no,resizable=yes'
        );
        setToggleProjectionIcon(true);
        wsSend('projection:toggle');
    }
});

prevVerseBtn.addEventListener('click', changeToPrevVerse);
nextVerseBtn.addEventListener('click', changeToNextVerse);

blackScreenBtn.addEventListener('click', () => {
    if (previewLyrics) previewLyrics.replaceChildren();
    currentVerseIndex = undefined;
    setActiveVerseHighlight(undefined);
    wsSend('display:black');
});

arrangementCheckbox.addEventListener('change', () => {
    currentUseArrangement = arrangementCheckbox.checked;
    if (currentSongData) {
        renderSongView(currentSongData);
        if (previewLyrics) previewLyrics.replaceChildren();
        currentVerseIndex = undefined;
    }
});

librarySearch.addEventListener('input', applyLibrarySearchFilter);

searchIcon.addEventListener('click', () => {
    if (librarySearch.value) {
        librarySearch.value = '';
        applyLibrarySearchFilter();
        librarySearch.focus();
    }
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

    switch (e.key) {
        case 'ArrowRight':
        case 'n':
            e.preventDefault();
            changeToNextVerse();
            break;
        case 'ArrowLeft':
        case 'p':
            e.preventDefault();
            changeToPrevVerse();
            break;
        case 'r':
            e.preventDefault();
            changeToChorus();
            break;
        case 'b':
            e.preventDefault();
            blackScreenBtn.click();
            break;
        default:
            if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
                e.preventDefault();
                toggleProjectionBtn.click();
            }
            break;
    }
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function resolveTheme(theme) {
    if (theme === 'system') {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return theme || 'dark';
}

async function init() {
    // --- Settings button: show/hide the settings overlay ---
    const settingsBtn  = document.getElementById('settings-btn');
    const settingsView = document.getElementById('settings-view');

    if (settingsBtn && settingsView) {
        settingsBtn.addEventListener('click', () => {
            settingsView.hidden = false;
        });

        // Close when settings.js dispatches beameeSettingsClose from inside the iframe
        window.addEventListener('beameeSettingsClose', () => {
            settingsView.hidden = true;
        });

        // The iframe's contentWindow fires the event on its own window, not the parent.
        // Listen for the iframe's load and forward the event.
        const iframe = document.getElementById('settings-iframe');
        if (iframe) {
            iframe.addEventListener('load', () => {
                try {
                    iframe.contentWindow.addEventListener('beameeSettingsClose', () => {
                        settingsView.hidden = true;
                    });
                } catch {
                    // cross-origin guard (shouldn't happen on same origin)
                }
            });
        }
    }

    // --- Re-apply preferences whenever settings.js saves ---
    window.addEventListener('beameePreferencesChanged', (e) => {
        const prefs = e.detail;
        if (!prefs) return;
        applyPreviewPreferences(prefs);
        if (prefs.theme) {
            document.documentElement.setAttribute('data-theme', resolveTheme(prefs.theme));
        }
    });

    // --- Load preferences: localStorage first, fall back to /api/preferences ---
    let prefs = loadStoredPreferences();

    const libRes = await fetch('/api/library').catch(() => null);

    if (!prefs) {
        const prefsRes = await fetch('/api/preferences').catch(() => null);
        if (prefsRes?.ok) {
            prefs = await prefsRes.json();
        }
    }

    if (prefs) {
        applyPreviewPreferences(prefs);
        if (prefs.theme) {
            document.documentElement.setAttribute('data-theme', resolveTheme(prefs.theme));
        }
    }

    if (libRes?.ok) {
        const data = await libRes.json();
        renderLibrary(data);
    }

    connectWs();
}

document.addEventListener('DOMContentLoaded', init);
