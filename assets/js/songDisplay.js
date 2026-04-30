/**
 * songDisplay.js — shared song display logic
 *
 * Platform-independent functions used by both:
 *   - renderer/js/renderer.js  (Electron)
 *   - web/public/js/control.js (Docker / browser)
 *
 * Rules for this file:
 *   - No ipcRenderer, no window.fs, no window.path, no window.Sortable
 *   - No fetch(), no WebSocket, no localStorage
 *   - No framework imports (no i18n, no themeUtils)
 *   - Pure DOM manipulation + pure data transforms only
 *
 * When adding a new display field to Beamee, update this file.
 * Both wrappers will pick it up automatically.
 */

// ---------------------------------------------------------------------------
// Section type labels (i18n-free fallback map)
// Wrappers that have i18n can override `sectionTypeLabel` via the options
// passed to `renderSongView`.
// ---------------------------------------------------------------------------

const SECTION_TYPE_LABELS = {
    verse:        'Verse',
    chorus:       'Chorus',
    'pre-chorus': 'Pre-chorus',
    bridge:       'Bridge',
    intro:        'Intro',
    outro:        'Outro',
    tag:          'Tag',
    other:        'Other',
};

// ---------------------------------------------------------------------------
// Pure data helpers
// ---------------------------------------------------------------------------

/**
 * Expand a song's sections into a flat, ordered array of verse objects
 * ready for projection and display.
 *
 * @param {object}  songData        - Raw song JSON object
 * @param {boolean} useArrangement  - Whether to honour the arrangement array
 * @returns {{ id: string, type: string, label: string, text: string }[]}
 */
export function expandSongForProjection(songData, useArrangement = true) {
    if (!songData || !Array.isArray(songData.sections)) {
        return [];
    }

    const sectionsById = new Map(
        songData.sections
            .filter((section) => section && typeof section.id === 'string')
            .map((section) => [section.id, section]),
    );

    if (!useArrangement || !Array.isArray(songData.arrangement) || songData.arrangement.length === 0) {
        return songData.sections
            .filter((section) => section && typeof section.id === 'string')
            .map((section) => ({
                id:    section.id,
                type:  section.type || 'other',
                label: section.title || section.type || 'other',
                text:  Array.isArray(section.lines) ? section.lines.join('\n') : '',
            }));
    }

    return songData.arrangement
        .map((step) => {
            const section = sectionsById.get(step?.sectionId);
            if (!section) return null;
            return {
                id:    section.id,
                type:  section.type || 'other',
                label: step.label || section.title || section.type || 'other',
                text:  Array.isArray(section.lines) ? section.lines.join('\n') : '',
            };
        })
        .filter(Boolean);
}

// ---------------------------------------------------------------------------
// String / search helpers
// ---------------------------------------------------------------------------

/**
 * Normalise a string for search comparison: strip diacritics, lowercase,
 * remove all non-alphanumeric characters.
 *
 * @param {*} value
 * @returns {string}
 */
export function normalizeSearchText(value) {
    return String(value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
}

/**
 * Derive a short prefix from a collection identifier by stripping trailing
 * numbers and separators (e.g. "hymns-1" → "hymns").
 *
 * @param {*} value
 * @returns {string}
 */
export function deriveCollectionPrefix(value) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed) return '';
    return trimmed.replace(/(?:[-_\s]*\d+)$/, '');
}

/**
 * Build a list of searchable alias strings for a collection object, including
 * variants with the song number (e.g. "HYM", "HYM 42", "HYM-42", "HYM42").
 *
 * @param {object} collection
 * @returns {string[]}
 */
export function buildCollectionSearchAliases(collection) {
    const aliases = [];
    const prefixCandidates = [
        collection?.reference,
        deriveCollectionPrefix(collection?.collectionId),
        collection?.collectionId,
        collection?.name,
    ];
    const number = Number.isInteger(collection?.number) && collection.number > 0
        ? String(collection.number)
        : '';

    prefixCandidates.forEach((prefix) => {
        if (typeof prefix !== 'string' || !prefix.trim()) return;
        const p = prefix.trim();
        aliases.push(p);
        if (number) {
            aliases.push(`${p} ${number}`);
            aliases.push(`${p}-${number}`);
            aliases.push(`${p}${number}`);
        }
    });

    return aliases;
}

/**
 * Build a single normalised search string for a song, covering name, id,
 * file name, and all collection aliases.
 *
 * @param {object} songData
 * @param {string} [fileName]
 * @returns {string}
 */
export function buildSongSearchText(songData, fileName) {
    const parts = [];

    const add = (v) => {
        if (typeof v === 'string' && v.trim()) parts.push(v.trim());
    };

    add(songData?.name);
    add(songData?.id);

    if (typeof fileName === 'string' && fileName.trim()) {
        add(fileName.replace(/\.[^.]+$/, ''));
    }

    (Array.isArray(songData?.authors) ? songData.authors : []).forEach(add);

    (Array.isArray(songData?.collections) ? songData.collections : []).forEach((col) => {
        buildCollectionSearchAliases(col).forEach((alias) => parts.push(alias));
    });

    (Array.isArray(songData?.tags) ? songData.tags : []).forEach(add);

    return normalizeSearchText(parts.join(' '));
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

/**
 * Append a string to a parent element, inserting <br> elements at each
 * newline character.
 *
 * @param {Element} parent
 * @param {*}       value
 */
export function appendTextWithLineBreaks(parent, value) {
    if (!parent) return;
    const lines = String(value ?? '').split('\n');
    lines.forEach((line, i) => {
        if (i > 0) parent.appendChild(document.createElement('br'));
        parent.appendChild(document.createTextNode(line));
    });
}

// ---------------------------------------------------------------------------
// Projection button icon
// ---------------------------------------------------------------------------

const SVG_PLAY = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="size-4"><path d="M3 3.732a1.5 1.5 0 0 1 2.305-1.265l6.706 4.267a1.5 1.5 0 0 1 0 2.531l-6.706 4.268A1.5 1.5 0 0 1 3 12.267V3.732Z"/></svg>';
const SVG_STOP = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="size-4"><rect width="10" height="10" x="3" y="3" rx="1.5"/></svg>';

/**
 * Update the toggle-projection button's icon to reflect the current state.
 *
 * @param {Element} button         - The button element to update
 * @param {boolean} isProjectionOn
 */
export function setToggleProjectionIcon(button, isProjectionOn) {
    if (!button) return;
    button.innerHTML = isProjectionOn ? SVG_STOP : SVG_PLAY;
}

// ---------------------------------------------------------------------------
// Active verse highlight
// ---------------------------------------------------------------------------

/**
 * Apply a highlight class to the active verse list item and remove it from
 * all others.
 *
 * @param {Element}          verseListEl  - The <ul> containing verse <li>s
 * @param {number|undefined} index        - Index of the active verse, or undefined to clear
 */
export function setActiveVerseHighlight(verseListEl, index) {
    if (!verseListEl) return;
    verseListEl.querySelectorAll('li[data-verse-index]').forEach((el) => {
        el.classList.remove('bg-base-300');
    });
    if (index !== undefined) {
        const target = verseListEl.querySelector(`li[data-verse-index="${index}"]`);
        target?.classList.add('bg-base-300');
        target?.scrollIntoView({ block: 'nearest' });
    }
}

// ---------------------------------------------------------------------------
// Song header
// ---------------------------------------------------------------------------

/**
 * Render the song name, collection badge(s), and copyright into their
 * respective DOM nodes.
 *
 * Pass `null` for `songData` to clear all nodes.
 *
 * @param {object}  nodes
 * @param {Element} nodes.nameEl       - Element receiving the song title
 * @param {Element} nodes.numberEl     - Element receiving the collection badge(s)
 * @param {Element} [nodes.copyrightEl] - Element receiving the copyright string
 * @param {object|null} songData
 */
export function renderSongHeader({ nameEl, numberEl, copyrightEl }, songData) {
    if (!nameEl || !numberEl) return;

    if (!songData) {
        nameEl.textContent = '';
        numberEl.textContent = '';
        if (copyrightEl) copyrightEl.textContent = '';
        return;
    }

    nameEl.textContent = songData.name || '';

    if (copyrightEl) {
        copyrightEl.textContent = songData.copyright || '';
    }

    numberEl.replaceChildren();
    const collections = Array.isArray(songData.collections) ? songData.collections : [];
    collections.forEach((col, i) => {
        if (!col?.collectionId) return;
        if (i > 0) numberEl.appendChild(document.createTextNode('  '));
        const badge = document.createElement('span');
        badge.textContent = col.number != null
            ? `${String(col.collectionId).toUpperCase()} #${col.number}`
            : String(col.collectionId).toUpperCase();
        numberEl.appendChild(badge);
    });
}

// ---------------------------------------------------------------------------
// Verse list rendering
// ---------------------------------------------------------------------------

/**
 * Render the ordered verse list into a <ul> element.
 *
 * @param {object}   opts
 * @param {Element}  opts.listEl          - The <ul> to render into
 * @param {object}   opts.songData        - Song JSON object
 * @param {boolean}  opts.useArrangement  - Whether to honour the arrangement
 * @param {Function} opts.onVerseClick    - Called with (verseIndex) when a verse is clicked
 * @param {Function} [opts.sectionLabel]  - Optional: (type) => string for section type labels
 *
 * @returns {{ verses: Array }} the expanded verse array
 */
export function renderSongView({ listEl, songData, useArrangement, onVerseClick, sectionLabel }) {
    const labelFn = typeof sectionLabel === 'function'
        ? sectionLabel
        : (type) => SECTION_TYPE_LABELS[type] || 'Other';

    const verses = expandSongForProjection(songData, useArrangement);

    if (!listEl) return { verses };

    listEl.replaceChildren();

    verses.forEach((verse, i) => {
        const li = document.createElement('li');
        li.setAttribute('data-verse-index', String(i));
        li.id = `verse-${i}`;

        const label = document.createElement('p');
        label.className = 'mt-2 text-xs uppercase';
        const verseNum = verse.id.split('-').slice(-1)[0];
        const displayLabel = verse.label && verse.label !== verse.type
            ? verse.label
            : labelFn(verse.type || 'other');
        label.textContent = `#${verseNum} ${displayLabel}`;

        const text = document.createElement('div');
        appendTextWithLineBreaks(text, verse.text);

        li.appendChild(label);
        li.appendChild(text);
        li.classList.add(
            'bg-base-200', 'p-2', 'px-4', 'pb-3',
            'hover:bg-base-300', 'active:bg-base-300',
            'rounded-field', 'cursor-pointer',
        );

        li.addEventListener('click', () => {
            if (typeof onVerseClick === 'function') onVerseClick(i);
        });

        listEl.appendChild(li);
    });

    return { verses };
}

// ---------------------------------------------------------------------------
// Preview panel styling
// ---------------------------------------------------------------------------

/**
 * Apply display preferences to a preview container element.
 *
 * @param {object}   opts
 * @param {Element}  opts.previewEl       - The preview container
 * @param {Function} opts.backgroundImageUrl - (filename) => string URL for background images.
 *                                            Called only when `preferences.backgroundImage` is set.
 *                                            Wrappers supply their own URL scheme.
 * @param {object}   preferences
 */
export function applyPreviewPreferences({ previewEl, backgroundImageUrl }, preferences) {
    if (!previewEl || !preferences) return;

    previewEl.style.fontFamily = preferences.fontFamily;
    const previewWidth = previewEl.offsetWidth || 1280;
    previewEl.style.fontSize = `${preferences.fontSize * (previewWidth / 1280)}px`;
    previewEl.style.color = preferences.textColor;
    previewEl.style.backgroundColor = preferences.backgroundColor;
    previewEl.style.lineHeight = String(preferences.lineHeight);
    previewEl.style.paddingTop    = `${preferences.paddingTop}px`;
    previewEl.style.paddingBottom = `${preferences.paddingBottom}px`;
    previewEl.style.paddingLeft   = `${preferences.paddingLeft}px`;
    previewEl.style.paddingRight  = `${preferences.paddingRight}px`;

    if (preferences.backgroundImage && typeof backgroundImageUrl === 'function') {
        previewEl.style.backgroundImage    = `url('${backgroundImageUrl(preferences.backgroundImage)}')`;
        previewEl.style.backgroundSize     = 'cover';
        previewEl.style.backgroundPosition = 'center';
    } else {
        previewEl.style.backgroundImage    = '';
        previewEl.style.backgroundSize     = '';
        previewEl.style.backgroundPosition = '';
    }
}

// ---------------------------------------------------------------------------
// Library search filter
// ---------------------------------------------------------------------------

/**
 * Show or hide a single library list item based on the current search query.
 * Handles both song items (`data-library-kind="song"`) and folder items
 * recursively.
 *
 * For folder items the function saves the pre-search open/closed state to
 * `details.dataset.searchOriginalOpen` on the first active query so it can
 * be restored exactly when the search is cleared.
 *
 * @param {Element} item    - A <li> element in the library list
 * @param {string}  query   - Normalised search string (empty = no active search)
 * @returns {boolean}       - Whether the item is visible after filtering
 */
export function updateLibraryItemVisibility(item, query) {
    const searchActive = Boolean(query);
    const kind = item.dataset.libraryKind;

    if (kind === 'song') {
        const searchableText = item.dataset.librarySearchText || '';
        const matches = !searchActive || searchableText.includes(query);
        item.hidden = !matches;
        return matches;
    }

    // Folder item
    const details = item.querySelector(':scope > details');
    const childList = item.querySelector(':scope > details > ul');
    let hasVisibleChild = false;

    Array.from(childList?.children || []).forEach((child) => {
        if (child instanceof Element && child.tagName === 'LI') {
            if (updateLibraryItemVisibility(child, query)) {
                hasVisibleChild = true;
            }
        }
    });

    if (searchActive) {
        item.hidden = !hasVisibleChild;

        if (details && hasVisibleChild) {
            // Snapshot the original state only once (first keystroke).
            if (!Object.prototype.hasOwnProperty.call(details.dataset, 'searchOriginalOpen')) {
                details.dataset.searchOriginalOpen = details.open ? 'true' : 'false';
            }
            details.open = true;
        }
    } else {
        item.hidden = false;

        // Restore the pre-search open state when the query is cleared.
        if (details && Object.prototype.hasOwnProperty.call(details.dataset, 'searchOriginalOpen')) {
            details.open = details.dataset.searchOriginalOpen === 'true';
            delete details.dataset.searchOriginalOpen;
        }
    }

    return !searchActive || hasVisibleChild;
}

/**
 * Apply a search filter across all top-level library list items.
 *
 * Note: this function does not update any search icon UI — that is the
 * responsibility of the caller (each wrapper has its own icon element).
 *
 * @param {Element} libraryListContainer - The root <ul> of the library
 * @param {string}  query                - Normalised search string (empty = clear)
 */
export function applyLibrarySearchFilter(libraryListContainer, query) {
    if (!libraryListContainer) return;

    Array.from(libraryListContainer.children).forEach((item) => {
        if (item instanceof Element && item.tagName === 'LI') {
            updateLibraryItemVisibility(item, query);
        }
    });
}

// ---------------------------------------------------------------------------
// Library folder toggle — pin / unpin selected song around a collapsed folder
// ---------------------------------------------------------------------------

/**
 * Return any currently pinned song <li> to its original position inside its
 * folder's <ul>. Call this before loading a new song so the previous pinned
 * item is cleaned up.
 *
 * @param {Element} libraryListContainer - The root <ul> of the library list
 */
export function unpinActiveSong(libraryListContainer) {
    const pinnedLi = libraryListContainer?.querySelector('li[data-pinned-song="true"]');
    if (!pinnedLi) return;

    const collectionId = pinnedLi.dataset.pinnedCollectionId;
    const folderDetails = libraryListContainer.querySelector(
        `details[data-collection-id="${CSS.escape(collectionId)}"]`,
    );
    const ul = folderDetails?.querySelector(':scope > ul');

    if (ul) {
        const index = parseInt(pinnedLi.dataset.pinnedIndex, 10);
        const refNode = Number.isInteger(index) ? Array.from(ul.children)[index] ?? null : null;
        ul.insertBefore(pinnedLi, refNode);
    }

    pinnedLi.classList.remove('library-pinned-song');
    delete pinnedLi.dataset.pinnedSong;
    delete pinnedLi.dataset.pinnedIndex;
    delete pinnedLi.dataset.pinnedCollectionId;
}

/**
 * Handle a library folder opening or closing.
 *
 * When a folder is collapsed and the currently selected song lives inside it,
 * the song's <li> is physically moved out of the folder and inserted directly
 * after the folder's <li> in the parent list so it remains visible. When the
 * folder is re-opened the song is moved back to its original position.
 *
 * The <details> element must have a `data-collection-id` attribute that
 * uniquely identifies the collection (used to guard against mis-matched
 * re-insertion when multiple folders are present).
 *
 * @param {HTMLDetailsElement} details        - The folder <details> element
 * @param {boolean}            isNowOpen      - Whether the folder is now open
 * @param {string|null}        currentSongPath - The currently loaded song path
 */
export function handleFolderToggle(details, isNowOpen, currentSongPath) {
    if (!currentSongPath) return;

    const ul = details.querySelector(':scope > ul');
    if (!ul) return;

    const folderLi = details.parentElement;
    if (!folderLi) return;

    const parentUl = folderLi.parentElement;
    if (!parentUl) return;

    if (!isNowOpen) {
        // Folder just closed — surface the active song if it is inside.
        const activeLi = ul.querySelector(`li[data-song-path="${CSS.escape(currentSongPath)}"]`);
        if (!activeLi) return;

        activeLi.dataset.pinnedIndex = String(Array.from(ul.children).indexOf(activeLi));
        activeLi.dataset.pinnedSong = 'true';
        activeLi.dataset.pinnedCollectionId = details.dataset.collectionId ?? '';
        activeLi.classList.add('library-pinned-song');
        parentUl.insertBefore(activeLi, folderLi.nextSibling);
    } else {
        // Folder just opened — return the pinned song to its original position.
        const pinnedLi = parentUl.querySelector(':scope > li[data-pinned-song="true"]');
        if (!pinnedLi) return;
        if (pinnedLi.dataset.pinnedCollectionId !== (details.dataset.collectionId ?? '')) return;

        const index = parseInt(pinnedLi.dataset.pinnedIndex, 10);
        const refNode = Number.isInteger(index) ? Array.from(ul.children)[index] ?? null : null;
        ul.insertBefore(pinnedLi, refNode);

        pinnedLi.classList.remove('library-pinned-song');
        delete pinnedLi.dataset.pinnedSong;
        delete pinnedLi.dataset.pinnedIndex;
        delete pinnedLi.dataset.pinnedCollectionId;
    }
}

/**
 * Attach the folder-toggle behaviour to a library <details> element.
 *
 * Intercepts summary clicks so that `handleFolderToggle` can pin/unpin the
 * selected song whenever the folder opens or closes.
 *
 * @param {HTMLDetailsElement} details            - The folder <details> element
 * @param {HTMLElement}        summary            - The <summary> element inside details
 * @param {Function}           getCurrentSongPath - Zero-arg function returning the current song path
 */
export function enableFolderToggleFallback(details, summary, getCurrentSongPath) {
    if (!details || !summary) return;

    summary.addEventListener('click', (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest('input, button, textarea, select, a')) return;

        event.preventDefault();
        const willOpen = !details.open;
        details.open = willOpen;
        handleFolderToggle(details, willOpen, getCurrentSongPath());
    });

    summary.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
        }
    });
}
