/**
 * control.js — Beamee web control UI
 *
 * Web/Docker wrapper around the shared songDisplay.js logic.
 * This file owns everything that is specific to the browser environment:
 *   - WebSocket communication with the server
 *   - fetch() calls to the REST API
 *   - localStorage persistence
 *   - window.open() projector popup management
 *   - Library tree rendering (uses pre-built tree from /api/library)
 *   - Settings overlay wiring
 *
 * Platform-independent display logic lives in /assets/js/songDisplay.js.
 * When adding a new display field, update songDisplay.js only — this file
 * and renderer.js will both benefit automatically.
 */

import {
    expandSongForProjection,
    normalizeSearchText,
    buildSongSearchText,
    appendTextWithLineBreaks,
    setToggleProjectionIcon,
    setActiveVerseHighlight,
    renderSongHeader,
    renderSongView,
    applyPreviewPreferences,
    enableFolderToggleFallback,
    unpinActiveSong,
    applyLibrarySearchFilter as _applyLibrarySearchFilter,
} from '/assets/js/songDisplay.js';

import { resolveLanguage, loadLocale, t, applyTranslations } from '/assets/js/i18n.js';

/** Web loader: fetches /locales/<lang>.json and returns its text. */
async function webLocaleLoader(lang) {
    const res = await fetch(`/locales/${lang}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
}

// ---------------------------------------------------------------------------
// localStorage helpers
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

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let currentSongPath       = null;
let currentSongData       = null;
let currentLyrics         = [];
let currentVerseIndex     = undefined;
let currentPreferences    = null;
let currentUseArrangement = true;
let libraryState          = null; // { tree, songsById }
let projectorWindow       = null; // reference to the popup opened by the toggle button

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
        try { msg = JSON.parse(event.data); } catch { return; }

        const { type, payload } = msg;

        switch (type) {
            case 'state:sync':
                handleRemoteStateSync(payload);
                break;
            case 'preferences:changed':
                if (payload) {
                    applyPreviewPreferences(
                        { previewEl: previewEl, backgroundImageUrl: webBackgroundImageUrl },
                        payload,
                    );
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

    // Expose socket so settings.js (loaded inside the settings iframe on the
    // same origin) can reuse it for broadcasting preferences:changed messages.
    window.__beameeWs = ws;
}

function handleRemoteStateSync(state) {
    if (!state) return;

    // Server thinks projection is on but we have no live popup (e.g. page was
    // refreshed while the projector was open). Reset server state to off.
    if (state.isProjectionOn && (!projectorWindow || projectorWindow.closed)) {
        projectorWindow = null;
        setToggleProjectionIcon(toggleProjectionBtn, false);
        wsSend('projection:toggle');
        return;
    }

    setToggleProjectionIcon(toggleProjectionBtn, state.isProjectionOn);

    // If another client turned projection off, close our popup if it's still open.
    if (!state.isProjectionOn && projectorWindow && !projectorWindow.closed) {
        projectorWindow.close();
        projectorWindow = null;
    }
}

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const libraryUl           = document.getElementById('library-ul');
const librarySearch       = document.getElementById('library-search');
const searchIcon          = document.getElementById('search-icon');
const verseListEl         = document.getElementById('verse-list');
const songNameEl          = document.getElementById('song-name');
const songNumberEl        = document.getElementById('song-number');
const copyrightEl         = document.querySelector('#copyright p');
const previewEl           = document.getElementById('preview');
const previewLyricsEl     = document.getElementById('preview-lyrics');
const arrangementCheckbox = document.getElementById('arrangement');
const toggleProjectionBtn = document.getElementById('toggle-projection');
const prevVerseBtn        = document.getElementById('prev-verse');
const nextVerseBtn        = document.getElementById('next-verse');
const blackScreenBtn      = document.getElementById('black-screen');

// ---------------------------------------------------------------------------
// Web-specific helpers
// ---------------------------------------------------------------------------

/** URL scheme for background images served via /assets/* from the library dir */
function webBackgroundImageUrl(filename) {
    return `/assets/${filename}`;
}

function resolveTheme(theme) {
    if (theme === 'system') {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return theme || 'dark';
}

// ---------------------------------------------------------------------------
// Projection controls
// ---------------------------------------------------------------------------

function applyCurrentPreviewPreferences() {
    if (!currentPreferences) return;
    applyPreviewPreferences(
        { previewEl, backgroundImageUrl: webBackgroundImageUrl },
        currentPreferences,
    );
}

function updateProjection() {
    if (!Array.isArray(currentLyrics) || currentVerseIndex === undefined || !currentLyrics[currentVerseIndex]) {
        if (previewLyricsEl) previewLyricsEl.replaceChildren();
        return;
    }

    const verseText = currentLyrics[currentVerseIndex].text;

    if (previewLyricsEl) {
        previewLyricsEl.replaceChildren();
        const p = document.createElement('p');
        p.style.margin = '0';
        appendTextWithLineBreaks(p, verseText);
        previewLyricsEl.appendChild(p);
    }

    applyCurrentPreviewPreferences();
    wsSend('display:lyrics', { text: verseText });
}

function onVerseClick(index) {
    currentVerseIndex = index;
    setActiveVerseHighlight(verseListEl, index);
    updateProjection();
}

function changeToPrevVerse() {
    if (currentVerseIndex !== undefined && currentVerseIndex > 0) {
        currentVerseIndex--;
        setActiveVerseHighlight(verseListEl, currentVerseIndex);
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
        setActiveVerseHighlight(verseListEl, currentVerseIndex);
        updateProjection();
    }
}

function changeToChorus() {
    if (!Array.isArray(currentLyrics)) return;
    const idx = currentLyrics.findIndex((v) => v?.type === 'chorus');
    if (idx === -1) return;
    currentVerseIndex = idx;
    setActiveVerseHighlight(verseListEl, idx);
    updateProjection();
}

// ---------------------------------------------------------------------------
// Song rendering
// ---------------------------------------------------------------------------

function renderCurrentSong() {
    if (!currentSongData) {
        renderSongHeader({ nameEl: songNameEl, numberEl: songNumberEl, copyrightEl }, null);
        showSongPlaceholder();
        return;
    }

    renderSongHeader({ nameEl: songNameEl, numberEl: songNumberEl, copyrightEl }, currentSongData);

    const { verses } = renderSongView({
        listEl:         verseListEl,
        songData:       currentSongData,
        useArrangement: currentUseArrangement,
        onVerseClick,
    });

    currentLyrics     = verses;
    currentVerseIndex = undefined;

    if (previewLyricsEl) previewLyricsEl.replaceChildren();
}

function showSongPlaceholder() {
    if (!verseListEl) return;
    verseListEl.replaceChildren();
    const li = document.createElement('li');
    li.id = 'song-placeholder';
    li.className = 'text-center pt-16 text-lg font-bold';
    li.innerHTML = `<p>
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
             stroke-width="1.5" stroke="currentColor" class="size-6 inline-block mr-3">
            <path stroke-linecap="round" stroke-linejoin="round"
                  d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18"/>
        </svg>
        Select a song
    </p>`;
    verseListEl.appendChild(li);
}

// ---------------------------------------------------------------------------
// Load a song by file path (fetch from server)
// ---------------------------------------------------------------------------

async function loadSong(songPath) {
    if (!songPath) return;
    unpinActiveSong(libraryUl);
    try {
        const res = await fetch(`/api/song?path=${encodeURIComponent(songPath)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const songData = await res.json();

        currentSongPath = songPath;
        currentSongData = songData;

        renderCurrentSong();
        pinActiveSongInLibrary(songPath);
        wsSend('song:selected', { path: songPath });
    } catch (err) {
        console.error('Failed to load song', err);
        currentSongPath = null;
        currentSongData = null;
        currentLyrics   = [];
        currentVerseIndex = undefined;
        renderSongHeader({ nameEl: songNameEl, numberEl: songNumberEl, copyrightEl }, null);
        showSongPlaceholder();
    }
}

// ---------------------------------------------------------------------------
// Library rendering
// ---------------------------------------------------------------------------

const ICON_FOLDER = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="h-4 w-4"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"/></svg>`;
const ICON_SONG   = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="h-4 w-4"><path stroke-linecap="round" stroke-linejoin="round" d="m9 9 10.5-3m0 6.553v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 1 1-.99-3.467l2.31-.66a2.25 2.25 0 0 0 1.632-2.163Zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 1 1-.99-3.467l2.31-.66A2.25 2.25 0 0 0 9 15.553Z"/></svg>`;

function renderLibrary(state) {
    libraryState = state;
    libraryUl.replaceChildren();

    if (!state || !Array.isArray(state.tree) || state.tree.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'p-2 opacity-60 text-sm';
        empty.textContent = t('library.empty');
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

function renderCollectionNode(collection) {
    const li = document.createElement('li');
    li.dataset.libraryKind = 'folder';
    const details = document.createElement('details');
    const summary = document.createElement('summary');

    // data-collection-id is read by handleFolderToggle to guard pin/unpin
    details.dataset.collectionId = collection.id ?? collection.name ?? '';

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

    enableFolderToggleFallback(details, summary, () => currentSongPath);
}

function renderSongNode(parentUl, node, songsById) {
    const song = songsById[node.id] || node;
    const li = document.createElement('li');
    li.dataset.libraryKind = 'song';
    li.setAttribute('data-song-path', node.path);
    li.setAttribute('data-song-id', node.id || '');
    li.setAttribute('data-library-search-text', buildSongSearchText(song, node.name));

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

    li.addEventListener('click', () => loadSong(node.path));
    parentUl.appendChild(li);
}

function pinActiveSongInLibrary(songPath) {
    libraryUl.querySelectorAll('li[data-song-path] a').forEach((el) => el.classList.remove('menu-active'));
    if (!songPath) return;
    const target = libraryUl.querySelector(`li[data-song-path="${CSS.escape(songPath)}"]`);
    if (target) {
        target.querySelector('a')?.classList.add('menu-active');
        const parentDetails = target.closest('details');
        if (parentDetails) parentDetails.open = true;
    }
}

// ---------------------------------------------------------------------------
// Library search / filter
// ---------------------------------------------------------------------------

function applyLibrarySearchFilter() {
    const query = normalizeSearchText(librarySearch.value);
    _applyLibrarySearchFilter(libraryUl, query);
    setSearchIcon(Boolean(query));
}

function setSearchIcon(isSearching) {
    if (!searchIcon) return;
    if (isSearching) {
        searchIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25Zm-1.72 6.97a.75.75 0 1 0-1.06 1.06L10.94 12l-1.72 1.72a.75.75 0 1 0 1.06 1.06L12 13.06l1.72 1.72a.75.75 0 1 0 1.06-1.06L13.06 12l1.72-1.72a.75.75 0 1 0-1.06-1.06L12 10.94l-1.72-1.72Z" clip-rule="evenodd"/></svg>`;
    } else {
        searchIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 30 30" fill="currentColor"><path d="M13 3C7.489 3 3 7.489 3 13s4.489 10 10 10a9.95 9.95 0 0 0 6.322-2.264l5.971 5.971a1 1 0 1 0 1.414-1.414l-5.97-5.97A9.95 9.95 0 0 0 23 13c0-5.511-4.489-10-10-10m0 2c4.43 0 8 3.57 8 8s-3.57 8-8 8-8-3.57-8-8 3.57-8 8-8"/></svg>`;
    }
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

toggleProjectionBtn.addEventListener('click', () => {
    const projectorIsOpen = projectorWindow && !projectorWindow.closed;

    if (projectorIsOpen) {
        projectorWindow.close();
        projectorWindow = null;
        if (previewLyricsEl) previewLyricsEl.replaceChildren();
        currentVerseIndex = undefined;
        setActiveVerseHighlight(verseListEl, undefined);
        setToggleProjectionIcon(toggleProjectionBtn, false);
        wsSend('projection:toggle');
    } else {
        projectorWindow = window.open(
            '/projector',
            'beamee-projector',
            'width=1280,height=720,menubar=no,toolbar=no,location=no,status=no,scrollbars=no,resizable=yes',
        );
        setToggleProjectionIcon(toggleProjectionBtn, true);
        wsSend('projection:toggle');
    }
});

prevVerseBtn.addEventListener('click', changeToPrevVerse);
nextVerseBtn.addEventListener('click', changeToNextVerse);

blackScreenBtn.addEventListener('click', () => {
    if (previewLyricsEl) previewLyricsEl.replaceChildren();
    currentVerseIndex = undefined;
    setActiveVerseHighlight(verseListEl, undefined);
    wsSend('display:black');
});

arrangementCheckbox.addEventListener('change', () => {
    currentUseArrangement = arrangementCheckbox.checked;
    if (currentSongData) renderCurrentSong();
});

librarySearch.addEventListener('input', applyLibrarySearchFilter);

searchIcon.addEventListener('click', () => {
    if (librarySearch.value) {
        librarySearch.value = '';
        applyLibrarySearchFilter();
        librarySearch.focus();
    }
});

document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

    switch (e.key) {
        case 'ArrowRight': case 'n': e.preventDefault(); changeToNextVerse(); break;
        case 'ArrowLeft':  case 'p': e.preventDefault(); changeToPrevVerse(); break;
        case 'r': e.preventDefault(); changeToChorus(); break;
        case 'b': e.preventDefault(); blackScreenBtn.click(); break;
        default:
            if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
                e.preventDefault();
                toggleProjectionBtn.click();
            }
            break;
    }
});

// ---------------------------------------------------------------------------
// Settings overlay
// ---------------------------------------------------------------------------

const settingsBtn  = document.getElementById('settings-btn');
const settingsView = document.getElementById('settings-view');
const settingsIframe = document.getElementById('settings-iframe');

if (settingsBtn && settingsView) {
    settingsBtn.addEventListener('click', () => { settingsView.hidden = false; });
}

// settings.js dispatches beameeSettingsClose on window.parent (this window),
// so we listen here directly — no iframe load-event timing required.
window.addEventListener('beameeSettingsClose', () => {
    if (settingsView) settingsView.hidden = true;
});

// Re-translate the whole control page when the user changes language in settings.
window.addEventListener('beameeLanguageChanged', async (e) => {
    const lang = resolveLanguage(e.detail?.language, navigator.language);
    await loadLocale(lang, webLocaleLoader);
    applyTranslations(document.body);
});

// Re-apply preferences whenever settings.js saves
window.addEventListener('beameePreferencesChanged', (e) => {
    const prefs = e.detail;
    if (!prefs) return;
    currentPreferences = prefs;
    applyPreviewPreferences(
        { previewEl, backgroundImageUrl: webBackgroundImageUrl },
        prefs,
    );
    if (prefs.theme) {
        document.documentElement.setAttribute('data-theme', resolveTheme(prefs.theme));
    }
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init() {
    // Load preferences: localStorage first, fall back to /api/preferences
    let prefs = loadStoredPreferences();

    const libResPromise = fetch('/api/library').catch(() => null);

    if (!prefs) {
        const prefsRes = await fetch('/api/preferences').catch(() => null);
        if (prefsRes?.ok) prefs = await prefsRes.json();
    }

    if (prefs) {
        currentPreferences    = prefs;
        currentUseArrangement = prefs.useArrangement !== false;
        if (arrangementCheckbox) arrangementCheckbox.checked = currentUseArrangement;
        applyPreviewPreferences(
            { previewEl, backgroundImageUrl: webBackgroundImageUrl },
            prefs,
        );
        if (prefs.theme) {
            document.documentElement.setAttribute('data-theme', resolveTheme(prefs.theme));
        }
    }

    // Load locale before rendering the library so t() calls and data-i18n
    // attributes both resolve correctly. navigator.language replaces Electron's
    // app.getLocale() — both produce BCP-47 tags like 'fr-CA'.
    const lang = resolveLanguage(prefs?.language, navigator.language);
    await loadLocale(lang, webLocaleLoader).catch(() => {});
    applyTranslations(document.body);

    const libRes = await libResPromise;
    if (libRes?.ok) {
        const data = await libRes.json();
        renderLibrary(data);
    }

    connectWs();
}

document.addEventListener('DOMContentLoaded', init);
