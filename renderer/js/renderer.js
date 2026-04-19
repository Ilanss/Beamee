let rootElement = null;
let toggleProjectionButton = null;
let prevVerse = null;
let nextVerse = null;
let main = null;
let libraryListContainer = null;
let librarySearchInput = null;
let favoritesListContainer = null;
let favoritesListRoot = null;
let createPlaylistButton = null;
let librarySearchWrap = null;
let librarySearchIcon = null;
let previewContent = null;
let previewLyrics = null;
let mounted = false;
let currentSongPath;
let arrangementCheckbox = null;
let currentUseArrangement = true;

const cleanupTasks = [];

const on = (target, eventName, handler, options) => {
    target?.addEventListener(eventName, handler, options);

    cleanupTasks.push(() => {
        target?.removeEventListener(eventName, handler, options);
    });
};

const onIpc = (channel, handler) => {
    ipcRenderer.on(channel, handler);
    cleanupTasks.push(() => {
        ipcRenderer.off(channel, handler);
    });
};

const resetCleanup = () => {
    while (cleanupTasks.length) {
        const cleanup = cleanupTasks.pop();

        try {
            cleanup?.();
        } catch (error) {
            console.warn('Failed to clean up library view listener', error);
        }
    }
};

let currentVerseIndex;
let currentLyrics;
let favoritesSaveTimer;
let libraryClickDelegated = false;
let favoritesClickDelegated = false;
let favoritesContextMenuDelegated = false;
let librarySongContextMenuDelegated = false;
let favoritesSongContextMenuDelegated = false;
let currentPreferences;
let mountContext = null;

const librarySearchIconSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 30 30" fill="#6B7280">
        <path d="M13 3C7.489 3 3 7.489 3 13s4.489 10 10 10a9.95 9.95 0 0 0 6.322-2.264l5.971 5.971a1 1 0 1 0 1.414-1.414l-5.97-5.97A9.95 9.95 0 0 0 23 13c0-5.511-4.489-10-10-10m0 2c4.43 0 8 3.57 8 8s-3.57 8-8 8-8-3.57-8-8 3.57-8 8-8" />
    </svg>
`;

const librarySearchClearSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="#6B7280">
  <path fill-rule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25Zm-1.72 6.97a.75.75 0 1 0-1.06 1.06L10.94 12l-1.72 1.72a.75.75 0 1 0 1.06 1.06L12 13.06l1.72 1.72a.75.75 0 1 0 1.06-1.06L13.06 12l1.72-1.72a.75.75 0 1 0-1.06-1.06L12 10.94l-1.72-1.72Z" clip-rule="evenodd" />
</svg>
`;

function toggleProjection() {
    ipcRenderer.send('projection:toggle');
}

function normalizeSearchText(value) {
    return String(value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
}

function addSearchPart(parts, value) {
    if (typeof value === 'string' && value.trim()) {
        parts.push(value.trim());
    }
}

function appendTextWithLineBreaks(parent, value) {
    if (!parent) {
        return;
    }

    const text = String(value ?? '');
    const lines = text.split('\n');

    lines.forEach((line, index) => {
        if (index > 0) {
            parent.appendChild(document.createElement('br'));
        }

        parent.appendChild(document.createTextNode(line));
    });
}

function createIconSpan(svgMarkup) {
    const icon = document.createElement('span');
    icon.innerHTML = svgMarkup;
    return icon;
}

function setLibrarySearchIcon(isSearching) {
    if (!librarySearchIcon) {
        return;
    }

    librarySearchIcon.innerHTML = isSearching ? librarySearchClearSvg : librarySearchIconSvg;
    librarySearchIcon.style.cursor = isSearching ? 'pointer' : 'default';
    librarySearchIcon.title = isSearching ? 'Clear search' : '';
    librarySearchIcon.setAttribute('aria-label', isSearching ? 'Clear search' : 'Search');
}

function deriveCollectionPrefix(value) {
    if (typeof value !== 'string') {
        return '';
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return '';
    }

    return trimmed.replace(/(?:[-_\s]*\d+)$/, '');
}

function buildCollectionSearchAliases(collection) {
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
        if (typeof prefix !== 'string' || !prefix.trim()) {
            return;
        }

        const normalizedPrefix = prefix.trim();
        aliases.push(normalizedPrefix);

        if (number) {
            aliases.push(`${normalizedPrefix} ${number}`);
            aliases.push(`${normalizedPrefix}-${number}`);
            aliases.push(`${normalizedPrefix}${number}`);
        }
    });

    return aliases;
}

function setToggleProjectionIcon(isProjectionOn) {
    if (!toggleProjectionButton) {
        return;
    }

    if (isProjectionOn) {
        toggleProjectionButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="size-4"><rect width="10" height="10" x="3" y="3" rx="1.5" /></svg>';
        return;
    }

    toggleProjectionButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="size-4"><path d="M3 3.732a1.5 1.5 0 0 1 2.305-1.265l6.706 4.267a1.5 1.5 0 0 1 0 2.531l-6.706 4.268A1.5 1.5 0 0 1 3 12.267V3.732Z" /></svg>';
}

function applyPreviewPreferences(preferences) {
    if (!previewContent || !preferences) {
        return;
    }

    currentPreferences = preferences;
    currentUseArrangement = preferences.useArrangement !== false;

    if (arrangementCheckbox && arrangementCheckbox.checked !== currentUseArrangement) {
        arrangementCheckbox.checked = currentUseArrangement;
    }

    previewContent.style.fontFamily = preferences.fontFamily;
    const previewWidth = previewContent.offsetWidth || 1280;
    previewContent.style.fontSize = `${preferences.fontSize * (previewWidth / 1280)}px`;
    previewContent.style.color = preferences.textColor;
    previewContent.style.backgroundColor = preferences.backgroundColor;
    previewContent.style.lineHeight = String(preferences.lineHeight);
    previewContent.style.paddingTop = `${preferences.paddingTop}px`;
    previewContent.style.paddingBottom = `${preferences.paddingBottom}px`;
    previewContent.style.paddingLeft = `${preferences.paddingLeft}px`;
    previewContent.style.paddingRight = `${preferences.paddingRight}px`;

}

function renderSong(songData) {
    if (!main) {
        return;
    }

    const verses = expandSongForProjection(songData, currentUseArrangement);

    currentLyrics = verses;
    currentVerseIndex = undefined;

    main.replaceChildren();

    verses.forEach((verse, i) => {
        const li = document.createElement('li');
        const label = document.createElement('p');
        label.className = 'mt-2 text-xs uppercase';
        label.textContent = `#${i + 1} ${verse.label || verse.type}`;

        const text = document.createElement('div');
        appendTextWithLineBreaks(text, verse.text);

        li.appendChild(label);
        li.appendChild(text);
        li.setAttribute('id', `verse-${i}`);
        li.classList.add('bg-gray-100', 'rounded-md', 'p-2', 'px-4', 'pb-3', 'hover:bg-gray-200', 'active:bg-gray-300', 'dark:bg-slate-800', 'hover:dark:bg-slate-700');

        li.addEventListener('click', () => {
            currentVerseIndex = i;
            updateProjection();
        });

        main.appendChild(li);
    });

    ipcRenderer.send('song:loaded', verses.length);
}

const isMountCurrent = () => mounted && (!mountContext || typeof mountContext.isCurrent !== 'function' || mountContext.isCurrent());

export async function mount(root, context = {}) {
    if (mounted) {
        return;
    }

    mounted = true;
    mountContext = context;
    rootElement = root;
    toggleProjectionButton = rootElement.querySelector('#toggle-projection');
    prevVerse = rootElement.querySelector('#prev-verse');
    nextVerse = rootElement.querySelector('#next-verse');
    main = rootElement.querySelector('#verse-display ul');
    libraryListContainer = rootElement.querySelector('#library-list ul');
    librarySearchInput = rootElement.querySelector('#library-search');
    librarySearchWrap = rootElement.querySelector('#library-search-wrap');
    librarySearchIcon = librarySearchWrap?.querySelector('#search-icon') || null;
    favoritesListContainer = rootElement.querySelector('#favorites-list');
    favoritesListRoot = favoritesListContainer?.querySelector('ul');
    createPlaylistButton = rootElement.querySelector('#create-playlist');
    previewContent = rootElement.querySelector('#preview');
    previewLyrics = document.createElement('div');
    arrangementCheckbox = rootElement.querySelector('#arrangement');

    if (previewContent) {
        previewLyrics.id = 'preview-lyrics';
        previewContent.appendChild(previewLyrics);
    }

    onIpc('projection:status', (isProjectionOn) => {
        setToggleProjectionIcon(isProjectionOn);

        if (currentVerseIndex !== undefined) {
            updateProjection();
        }
    });

    onIpc('black-screen', () => {
        currentVerseIndex = undefined;
        if (previewLyrics) {
            previewLyrics.replaceChildren();
        }
    });

    onIpc('preferences:changed', (preferences) => {
        const previousUseArrangement = currentUseArrangement;
        applyPreviewPreferences(preferences);

        if (previousUseArrangement === currentUseArrangement && currentVerseIndex !== undefined) {
            updateProjection();
        }

        if (currentSongPath && previousUseArrangement !== currentUseArrangement) {
            renderCurrentSong();
        }
    });

    onIpc('library:changed', async () => {
        if (!isMountCurrent()) {
            return;
        }

        try {
            const state = await ipcRenderer.invoke('library:state');

            if (!isMountCurrent()) {
                return;
            }

            if (state?.library) {
                createFileList(state.library, libraryListContainer);
            }

            if (state?.favorites) {
                createFavoritesList(state.favorites);
            }

            if (currentSongPath) {
                loadSong(currentSongPath);
            }
        } catch (error) {
            console.warn('Failed to refresh library view', error);
        }
    });

    onIpc('projection:next', () => {
        changeToNextVerse();
    });

    onIpc('projection:prev', () => {
        changeToPrevVerse();
    });

    onIpc('projection:chorus', () => {
        changeToChorus();
    });

    onIpc('verse:change', (verse) => {
        currentVerseIndex = verse;
        updateProjection();
    });

    on(toggleProjectionButton, 'click', toggleProjection);

    on(nextVerse, 'click', () => {
        changeToNextVerse();
    });

    on(prevVerse, 'click', () => {
        changeToPrevVerse();
    });

    on(rootElement.querySelector('#black-screen'), 'click', () => {
        if (previewLyrics) {
            previewLyrics.replaceChildren();
        }

        currentVerseIndex = undefined;
        ipcRenderer.send('black-screen');
    });

    on(arrangementCheckbox, 'change', () => {
        const useArrangement = Boolean(arrangementCheckbox?.checked);

        currentUseArrangement = useArrangement;
        ipcRenderer.invoke('save-preferences', { useArrangement }).catch((error) => {
            console.error('Failed to save arrangement preference', error);
        });

        if (currentSongPath) {
            renderCurrentSong();
        }
    });

    if (favoritesListRoot) {
        ensureFavoritesSortable(favoritesListRoot, true);
    }

    if (libraryListContainer) {
        ensureLibrarySortable(libraryListContainer);
    }

    on(librarySearchInput, 'input', () => {
        applyLibrarySearchFilter();
        setLibrarySearchIcon(Boolean(librarySearchInput?.value));
    });

    on(librarySearchIcon, 'click', () => {
        if (!librarySearchInput || !librarySearchInput.value) {
            return;
        }

        librarySearchInput.value = '';
        librarySearchInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    try {
        const isProjectionOn = await ipcRenderer.invoke('projection:is-on');
        setToggleProjectionIcon(Boolean(isProjectionOn));
    } catch (error) {
        console.warn('Failed to load projection state', error);
    }

    try {
        const [preferences, state] = await Promise.all([
            ipcRenderer.invoke('get-preferences'),
            ipcRenderer.invoke('library:state'),
        ]);

        if (!isMountCurrent()) {
            return;
        }

        applyPreviewPreferences(preferences);
        setLibrarySearchIcon(Boolean(librarySearchInput?.value));

        if (state?.library) {
            createFileList(state.library, libraryListContainer);
        }

        if (state?.favorites) {
            createFavoritesList(state.favorites);
        }

        if (currentSongPath) {
            renderCurrentSong();
        }
    } catch (error) {
        if (!isMountCurrent()) {
            return;
        }

        console.error('Failed to initialize library view', error);
    }
}

function renderCurrentSong() {
    if (!currentSongPath) {
        return;
    }

    loadSong(currentSongPath);
}

export async function unmount() {
    resetCleanup();
    if (favoritesSaveTimer) {
        clearTimeout(favoritesSaveTimer);
        favoritesSaveTimer = null;
    }

    mounted = false;
    rootElement = null;
    toggleProjectionButton = null;
    prevVerse = null;
    nextVerse = null;
    main = null;
    libraryListContainer = null;
    librarySearchInput = null;
    librarySearchWrap = null;
    librarySearchIcon = null;
    favoritesListContainer = null;
    favoritesListRoot = null;
    createPlaylistButton = null;
    previewContent = null;
    previewLyrics = null;
    libraryClickDelegated = false;
    favoritesClickDelegated = false;
    favoritesContextMenuDelegated = false;
    librarySongContextMenuDelegated = false;
    favoritesSongContextMenuDelegated = false;
    mountContext = null;
}

function buildSongSearchText(songData, fileName) {
    const parts = [];

    addSearchPart(parts, songData?.name);
    addSearchPart(parts, songData?.id);

    if (typeof fileName === 'string' && fileName.trim()) {
        addSearchPart(parts, fileName.replace(/\.[^.]+$/, ''));
    }

    (Array.isArray(songData?.collections) ? songData.collections : []).forEach((collection) => {
        parts.push(...buildCollectionSearchAliases(collection));
    });

    return normalizeSearchText(
        parts
            .filter((part) => typeof part === 'string' && part.trim())
            .join(' '),
    );
}

function applyLibrarySearchFilter() {
    if (!libraryListContainer) {
        return;
    }

    const query = typeof librarySearchInput?.value === 'string'
        ? normalizeSearchText(librarySearchInput.value)
        : '';

    Array.from(libraryListContainer.children).forEach((item) => {
        if (item instanceof Element && item.tagName === 'LI') {
            updateLibraryItemVisibility(item, query);
        }
    });
}

function updateLibraryItemVisibility(item, query) {
    const searchActive = Boolean(query);
    const kind = item.dataset.libraryKind;

    if (kind === 'song') {
        const searchableText = item.dataset.librarySearchText || '';
        const matches = !searchActive || searchableText.includes(query);
        item.hidden = !matches;
        return matches;
    }

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
            if (!Object.prototype.hasOwnProperty.call(details.dataset, 'searchOriginalOpen')) {
                details.dataset.searchOriginalOpen = details.open ? 'true' : 'false';
            }

            details.open = true;
        }
    } else {
        item.hidden = false;

        if (details && Object.prototype.hasOwnProperty.call(details.dataset, 'searchOriginalOpen')) {
            details.open = details.dataset.searchOriginalOpen === 'true';
            delete details.dataset.searchOriginalOpen;
        }
    }

    return !searchActive || hasVisibleChild;
}

function createFavoritesList(favorites) {
    if (!favoritesListRoot) {
        return;
    }

    const list = Array.isArray(favorites) ? favorites : [];
    favoritesListRoot.replaceChildren();
    ensureFavoritesSortable(favoritesListRoot, true);
    bindSongClickDelegation();
    bindLibrarySongContextMenu();
    bindFavoriteSongContextMenu();
    bindFavoriteContextMenu();
    bindCreatePlaylistButton();

    list.forEach(favorite => {
        const li = Array.isArray(favorite.songs)
            ? createFavoriteFolderItem(favorite)
            : createFavoriteSongItem(favorite);

        favoritesListRoot.appendChild(li);
    });
}

function createFileList(files, container) {
    if (!libraryClickDelegated) {
        bindSongClickDelegation();
    }

    bindLibrarySongContextMenu();

    ensureLibrarySortable(container);
    container.replaceChildren();

    (Array.isArray(files) ? files : []).forEach(file => {
        let li = document.createElement('li');
        let a = document.createElement('a');
        a.classList.add("flex");

        if (file.isDirectory) {
            const details = document.createElement('details');

            const summary = document.createElement('summary');
            const icon = createIconSpan(`
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="h-4 w-4">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                </svg>
            `);

            summary.appendChild(icon);
            summary.appendChild(document.createTextNode(file.name));

            const ul = document.createElement('ul');
            li.dataset.libraryKind = 'folder';
            details.appendChild(summary);
            details.appendChild(ul);

            li.appendChild(details);
            enableFolderToggleFallback(details, summary);

            createFileList(file.children, ul);
            ensureLibrarySortable(ul);
        } else {
            const songData = JSON.parse(window.fs.readFileSync(file.path, 'utf8'));
            li.dataset.libraryKind = 'song';
            li.dataset.librarySearchText = buildSongSearchText(songData, file.name);
            a.appendChild(createIconSpan(`
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="h-4 w-4">
                    <path stroke-linecap="round" stroke-linejoin="round" d="m9 9 10.5-3m0 6.553v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 1 1-.99-3.467l2.31-.66a2.25 2.25 0 0 0 1.632-2.163Zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 1 1-.99-3.467l2.31-.66A2.25 2.25 0 0 0 9 15.553Z" />
                </svg>
            `));

            //(songData.collections[0] != undefined) ? a.appendChild(document.createTextNode(songData.name + songData.collections[0].number)) : a.appendChild(document.createTextNode(songData.name));

            if (songData.collections[0] != undefined) {
                a.appendChild(Object.assign(document.createElement("span"), {
                    textContent: "#" + songData.collections[0].number,
                    classList: "text-gray-500"
                }));
            }

            a.appendChild(document.createTextNode(songData.name));

            li.appendChild(a);
            li.dataset.libraryKind = 'song';
            li.dataset.songId = songData.id;
            li.dataset.songPath = file.path;
            li.dataset.songName = songData.name;
            li.classList.add('draggable');
        }

        container.appendChild(li);
    });

    if (container === libraryListContainer) {
        applyLibrarySearchFilter();
    }
}

function createFavoriteSongItem(song) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    const icon = document.createElement('span');
    const label = document.createElement('span');
    const songName = typeof song?.displayName === 'string' && song.displayName.trim()
        ? song.displayName.trim()
        : song.name;

    li.dataset.favoriteKind = 'song';
    li.dataset.songId = song.id;
    li.dataset.songPath = song.path;
    li.dataset.songName = song.name;
    li.dataset.favoriteDisplayName = typeof song?.displayName === 'string' ? song.displayName : '';
    li.classList.add('draggable');

    icon.innerHTML = `  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="h-4 w-4">
    <path stroke-linecap="round" stroke-linejoin="round" d="m9 9 10.5-3m0 6.553v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 1 1-.99-3.467l2.31-.66a2.25 2.25 0 0 0 1.632-2.163Zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 1 1-.99-3.467l2.31-.66A2.25 2.25 0 0 0 9 15.553Z" />
    </svg>`;
    label.classList.add('truncate', 'favorite-item-name');
    label.textContent = songName;

    a.appendChild(icon);
    a.appendChild(label);
    li.appendChild(a);
    return li;
}

function createFavoriteFolderItem(favorite, options = {}) {
    const li = document.createElement('li');
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    const icon = document.createElement('span');
    const label = document.createElement('span');
    const ul = document.createElement('ul');
    const isEditing = Boolean(options.editing);
    const folderName = typeof favorite?.name === 'string' ? favorite.name : '';

    li.dataset.favoriteKind = 'folder';
    li.dataset.favoriteName = folderName;

    icon.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="h-4 w-4">
                <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
            </svg>`;
    label.classList.add('truncate', 'favorite-item-name');
    label.textContent = folderName;

    summary.appendChild(icon);
    summary.appendChild(label);
    details.appendChild(summary);
    details.appendChild(ul);
    li.appendChild(details);

    enableFavoriteFolderDropOpen(details, summary);
    enableFolderToggleFallback(details, summary);
    if (isEditing) {
        details.open = true;
        setTimeout(() => {
            beginInlineEdit(label, folderName, {
                placeholder: 'Folder name',
                onCommit: (value) => {
                    li.dataset.favoriteName = value;
                    details.open = true;
                    scheduleFavoritesSave();
                },
                onCancel: () => {
                    li.remove();
                    scheduleFavoritesSave();
                },
                onEmpty: () => {
                    li.remove();
                    scheduleFavoritesSave();
                },
            });
        }, 0);
    }

    ensureFavoritesSortable(ul, false);

    (Array.isArray(favorite.songs) ? favorite.songs : []).forEach(song => {
        ul.appendChild(createFavoriteSongItem(song));
    });

    return li;
}

function bindFavoriteContextMenu() {
    if (!favoritesListRoot || favoritesContextMenuDelegated) {
        return;
    }

    favoritesListRoot.addEventListener('contextmenu', handleFavoriteContextMenu);
    favoritesContextMenuDelegated = true;
}

function bindLibrarySongContextMenu() {
    if (!libraryListContainer || librarySongContextMenuDelegated) {
        return;
    }

    libraryListContainer.addEventListener('contextmenu', handleSongContextMenu);
    librarySongContextMenuDelegated = true;
}

function bindFavoriteSongContextMenu() {
    if (!favoritesListRoot || favoritesSongContextMenuDelegated) {
        return;
    }

    favoritesListRoot.addEventListener('contextmenu', handleFavoriteSongContextMenu);
    favoritesSongContextMenuDelegated = true;
}

function bindCreatePlaylistButton() {
    if (!createPlaylistButton || createPlaylistButton.dataset.createFolderBound === 'true') {
        return;
    }

    createPlaylistButton.dataset.createFolderBound = 'true';
    createPlaylistButton.addEventListener('click', () => {
        if (!favoritesListRoot) {
            return;
        }

        const existingEditor = favoritesListRoot.querySelector('input[data-inline-editor="true"]');
        if (existingEditor) {
            existingEditor.focus();
            return;
        }

        const folder = createFavoriteFolderItem({ name: '', songs: [] }, { editing: true });
        favoritesListRoot.insertBefore(folder, favoritesListRoot.firstElementChild);
    });
}

function handleFavoriteContextMenu(event) {
    const item = event.target.closest('li[data-favorite-kind="folder"]');

    if (!item || !favoritesListRoot?.contains(item)) {
        return;
    }

    event.preventDefault();

    ipcRenderer.invoke('favorites:context-menu', {
        kind: item.dataset.favoriteKind,
    })
        .then((action) => {
            if (action === 'rename') {
                startFavoriteRename(item);
            }

            if (action === 'delete') {
                deleteFavoriteItem(item);
            }
        })
        .catch(() => { });
}

function handleFavoriteSongContextMenu(event) {
    const item = event.target.closest('li[data-favorite-kind="song"]');

    if (!item || !favoritesListRoot?.contains(item)) {
        return;
    }

    event.preventDefault();

    ipcRenderer.invoke('favorites:context-menu', {
        kind: item.dataset.favoriteKind,
    })
        .then((action) => {
            if (action === 'delete') {
                deleteFavoriteItem(item);
            }
        })
        .catch(() => { });
}

function handleSongContextMenu(event) {
    const item = event.target.closest('li[data-song-path]');

    if (!item || !(libraryListContainer?.contains(item) || favoritesListRoot?.contains(item))) {
        return;
    }

    event.preventDefault();

    ipcRenderer.invoke('song:context-menu', item.dataset.songPath)
        .catch(() => { });
}

function startFavoriteRename(item) {
    if (item.dataset.favoriteKind === 'folder') {
        const label = item.querySelector('summary .favorite-item-name');
        const currentName = item.dataset.favoriteName || label?.textContent?.trim() || '';

        if (label) {
            beginInlineEdit(label, currentName, {
                placeholder: 'Folder name',
                onCommit: (value) => {
                    item.dataset.favoriteName = value;
                    scheduleFavoritesSave();
                },
            });
        }

        return;
    }

    if (item.dataset.favoriteKind === 'song') {
        const label = item.querySelector('a .favorite-item-name');
        const currentName = item.dataset.favoriteDisplayName || item.dataset.songName || label?.textContent?.trim() || '';

        if (label) {
            beginInlineEdit(label, currentName, {
                placeholder: 'Song name',
                onCommit: (value) => {
                    item.dataset.favoriteDisplayName = value;
                    scheduleFavoritesSave();
                },
                onEmpty: () => {
                    item.dataset.favoriteDisplayName = '';
                    label.textContent = item.dataset.songName || '';
                    scheduleFavoritesSave();
                },
            });
        }
    }
}

function deleteFavoriteItem(item) {
    if (!window.confirm('Delete this favorite?')) {
        return;
    }

    item.remove();
    scheduleFavoritesSave();
}

function beginInlineEdit(labelNode, initialValue, options = {}) {
    const parent = labelNode?.parentElement;

    if (!parent) {
        return;
    }

    const input = document.createElement('input');
    const originalValue = typeof initialValue === 'string' ? initialValue : '';
    let finished = false;

    input.type = 'text';
    input.value = originalValue;
    input.placeholder = options.placeholder || '';
    input.className = 'input input-ghost input-xs w-full min-w-0';
    input.dataset.inlineEditor = 'true';

    const restoreLabel = (value) => {
        labelNode.textContent = value;
        parent.replaceChild(labelNode, input);
    };

    const finish = (commit) => {
        if (finished) {
            return;
        }

        finished = true;

        const value = input.value.trim();

        if (commit && value) {
            restoreLabel(value);
            options.onCommit?.(value, input);
            return;
        }

        if (commit && !value && typeof options.onEmpty === 'function') {
            parent.replaceChild(labelNode, input);
            labelNode.textContent = originalValue;
            options.onEmpty(input);
            return;
        }

        restoreLabel(originalValue);
        options.onCancel?.(input);
    };

    parent.replaceChild(input, labelNode);
    input.focus();
    input.select();

    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            finish(true);
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            finish(false);
        }
    });

    input.addEventListener('mousedown', (event) => {
        event.stopPropagation();
    });

    input.addEventListener('click', (event) => {
        event.stopPropagation();
    });

    input.addEventListener('blur', () => {
        finish(true);
    });
}

function bindSongClickDelegation() {
    if (libraryClickDelegated || favoritesClickDelegated) {
        return;
    }

    const handleSongClick = (event) => {
        const item = event.target.closest('li[data-song-path]');

        if (!item) {
            return;
        }

        document.querySelectorAll('a.active').forEach((anchor) => {
            anchor.classList.remove('active');
        });

        item.querySelector('a')?.classList.add('active');
        loadSong(item.dataset.songPath);
    };

    libraryListContainer?.addEventListener('click', handleSongClick);
    favoritesListRoot?.addEventListener('click', handleSongClick);
    libraryClickDelegated = true;
    favoritesClickDelegated = true;
}

function ensureFavoritesSortable(listElement, allowFolderMoves) {
    if (!listElement || listElement.dataset.sortableReady === 'true') {
        return;
    }

    listElement.dataset.sortableReady = 'true';

    Sortable.create(listElement, {
        group: {
            name: 'favorites',
            pull: true,
            put: (to, from, dragged) => {
                if (allowFolderMoves) {
                    return true;
                }

                return dragged?.dataset?.favoriteKind !== 'folder';
            },
        },
        animation: 150,
        draggable: 'li',
        onAdd: scheduleFavoritesSave,
        onUpdate: scheduleFavoritesSave,
        onRemove: scheduleFavoritesSave,
        onEnd: scheduleFavoritesSave,
    });
}

function ensureLibrarySortable(listElement) {
    if (!listElement || listElement.dataset.sortableReady === 'true') {
        return;
    }

    listElement.dataset.sortableReady = 'true';

    Sortable.create(listElement, {
        sort: false,
        draggable: '.draggable',
        group: {
            name: 'library',
            pull: 'clone',
            put: false,
        },
        animation: 150,
    });
}

function enableFavoriteFolderDropOpen(details, summary) {
    if (!details || !summary) {
        return;
    }

    const openFolder = (event) => {
        if (event?.type === 'dragover') {
            event.preventDefault();
        }

        details.open = true;
    };

    summary.addEventListener('dragenter', openFolder);
    summary.addEventListener('dragover', openFolder);
}

function enableFolderToggleFallback(details, summary) {
    if (!details || !summary) {
        return;
    }

    summary.addEventListener('click', (event) => {
        const target = event.target instanceof Element ? event.target : null;

        if (target?.closest('input, button, textarea, select, a')) {
            return;
        }

        event.preventDefault();
        details.open = !details.open;
    });

    summary.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
        }
    });
}

function scheduleFavoritesSave() {
    if (favoritesSaveTimer) {
        clearTimeout(favoritesSaveTimer);
    }

    favoritesSaveTimer = setTimeout(() => {
        favoritesSaveTimer = null;

        if (!favoritesListRoot) {
            return;
        }

        ipcRenderer.invoke('favorites:update', serializeFavorites(favoritesListRoot))
            .then((result) => {
                if (!result?.ok) {
                    window.alert(result?.error || 'Unable to save favorites.');
                }
            })
            .catch((error) => {
                window.alert(error?.message || 'Unable to save favorites.');
            });
    }, 0);
}

function serializeFavorites(rootList) {
    return Array.from(rootList.children)
        .map((item) => {
            if (item.dataset.favoriteKind === 'folder' || item.querySelector('details')) {
                const folderName = item.dataset.favoriteName || item.querySelector('summary')?.textContent?.trim() || '';
                const songList = item.querySelector('details ul');

                return {
                    name: folderName,
                    songs: Array.from(songList?.children || [])
                        .map((songItem) => {
                            const songId = songItem.dataset.songId;

                            if (!songId) {
                                return null;
                            }

                            const displayName = songItem.dataset.favoriteDisplayName;

                            if (displayName) {
                                return {
                                    id: songId,
                                    displayName,
                                };
                            }

                            return songId;
                        })
                        .filter(Boolean),
                };
            }

            const songId = item.dataset.songId;

            if (!songId) {
                return null;
            }

            return {
                id: songId,
                ...(item.dataset.favoriteDisplayName ? { displayName: item.dataset.favoriteDisplayName } : {}),
            };
        })
        .filter(Boolean);
}

function loadSong(songPath) {
    if (!songPath) {
        return;
    }

    try {
        const songData = JSON.parse(window.fs.readFileSync(songPath, 'utf8'));

        currentSongPath = songPath;
        ipcRenderer.send('song:selected', songPath);
        renderSong(songData);

        document.querySelector('#song-name').innerText = songData.name;

        if (songData.collections[0] != undefined) {
            document.querySelector('#song-number').innerText = songData.collections[0].collectionId.toUpperCase() + " #" + songData.collections[0].number;
        }

        if (previewLyrics) {
            previewLyrics.replaceChildren();
        }
    } catch (error) {
        console.error('Failed to load song', error);
        currentSongPath = null;
        ipcRenderer.send('song:selected', null);
        ipcRenderer.send('song:loaded', 0);
        currentLyrics = [];
        currentVerseIndex = undefined;
        renderSongPlaceholder();
    }
}

function renderSongPlaceholder() {
    if (!main || !rootElement) {
        return;
    }

    main.replaceChildren();

    const placeholder = document.createElement('div');
    placeholder.className = 'text-center pt-16 text-lg font-bold';

    const paragraph = document.createElement('p');
    const icon = document.createElement('i');
    icon.className = 'bi bi-arrow-left pr-3';
    paragraph.appendChild(icon);
    paragraph.appendChild(document.createTextNode('Select a song'));

    placeholder.appendChild(paragraph);
    main.appendChild(placeholder);

    const songName = rootElement.querySelector('#song-name');
    if (songName) {
        songName.innerText = '';
    }

    const songNumber = rootElement.querySelector('#song-number');
    if (songNumber) {
        songNumber.innerText = '';
    }

    if (previewLyrics) {
        previewLyrics.replaceChildren();
    }
}

function expandSongForProjection(songData, useArrangement = true) {
    if (!songData || !Array.isArray(songData.sections)) {
        return [];
    }

    const sectionsById = new Map(
        songData.sections
            .filter((section) => section && typeof section.id === 'string')
            .map((section) => [section.id, section])
    );

    if (!useArrangement || !Array.isArray(songData.arrangement) || songData.arrangement.length === 0) {
        return songData.sections
            .filter((section) => section && typeof section.id === 'string')
            .map((section) => ({
                id: section.id,
                type: section.type || 'other',
                label: section.title || section.type || 'other',
                text: Array.isArray(section.lines) ? section.lines.join('\n') : '',
            }));
    }

    return songData.arrangement
        .map((step) => {
            const section = sectionsById.get(step?.sectionId);

            if (!section) {
                return null;
            }

            return {
                id: section.id,
                type: section.type || 'other',
                label: step.label || section.title || section.type || 'other',
                text: Array.isArray(section.lines) ? section.lines.join('\n') : '',
            };
        })
        .filter(Boolean);
}
function updateProjection() {
    if (!Array.isArray(currentLyrics) || currentVerseIndex === undefined || !currentLyrics[currentVerseIndex]) {
        if (previewLyrics) {
            previewLyrics.replaceChildren();
        }
        return;
    }

    const verseText = currentLyrics[currentVerseIndex].text;

    if (previewLyrics) {
        previewLyrics.replaceChildren();
        const paragraph = document.createElement('p');
        appendTextWithLineBreaks(paragraph, verseText);
        previewLyrics.appendChild(paragraph);
    }

    if (currentPreferences) {
        applyPreviewPreferences(currentPreferences);
    }

    ipcRenderer.send('display-lyrics', verseText);
}

function changeToPrevVerse() {
    if (currentVerseIndex !== undefined && currentVerseIndex > 0) {
        currentVerseIndex--;
        updateProjection();
    }
}

function changeToNextVerse() {
    if (currentVerseIndex !== undefined && Array.isArray(currentLyrics) && currentVerseIndex < currentLyrics.length - 1) {
        currentVerseIndex++;
        updateProjection();
    }
}

function changeToChorus() {
    if (!Array.isArray(currentLyrics)) {
        return;
    }

    const chorusIndex = currentLyrics.findIndex((verse) => verse?.type === 'chorus');

    if (chorusIndex === -1) {
        return;
    }

    currentVerseIndex = chorusIndex;
    updateProjection();
}
