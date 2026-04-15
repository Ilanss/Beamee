let rootElement = null;
let toggleProjectionButton = null;
let prevVerse = null;
let nextVerse = null;
let main = null;
let libraryListContainer = null;
let favoritesListContainer = null;
let favoritesListRoot = null;
let createPlaylistButton = null;
let previewContent = null;
let previewLyrics = null;
let mounted = false;
let currentSongPath;

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
let currentPreferences;
let mountContext = null;

function toggleProjection() {
    ipcRenderer.send('projection:toggle');
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
    favoritesListContainer = rootElement.querySelector('#favorites-list');
    favoritesListRoot = favoritesListContainer?.querySelector('ul');
    createPlaylistButton = rootElement.querySelector('#create-playlist');
    previewContent = rootElement.querySelector('#preview');
    previewLyrics = document.createElement('div');

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
            previewLyrics.innerHTML = '';
        }
    });

    onIpc('preferences:changed', (preferences) => {
        applyPreviewPreferences(preferences);

        if (currentVerseIndex !== undefined) {
            updateProjection();
        }
    });

    onIpc('projection:next', () => {
        changeToNextVerse();
    });

    onIpc('projection:prev', () => {
        changeToPrevVerse();
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
            previewLyrics.innerHTML = '';
        }

        currentVerseIndex = undefined;
        ipcRenderer.send('black-screen');
    });

    if (favoritesListRoot) {
        ensureFavoritesSortable(favoritesListRoot, true);
    }

    if (libraryListContainer) {
        ensureLibrarySortable(libraryListContainer);
    }

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
        if (!isMountCurrent()) {
            return;
        }

        console.error('Failed to initialize library view', error);
    }
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
    favoritesListContainer = null;
    favoritesListRoot = null;
    createPlaylistButton = null;
    previewContent = null;
    previewLyrics = null;
    libraryClickDelegated = false;
    favoritesClickDelegated = false;
    favoritesContextMenuDelegated = false;
    mountContext = null;
}

function createFavoritesList(favorites) {
    if (!favoritesListRoot) {
        return;
    }

    const list = Array.isArray(favorites) ? favorites : [];
    favoritesListRoot.innerHTML = '';
    ensureFavoritesSortable(favoritesListRoot, true);
    bindSongClickDelegation();
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

    ensureLibrarySortable(container);
    container.innerHTML = '';

    (Array.isArray(files) ? files : []).forEach(file => {
        let li = document.createElement('li');
        let a = document.createElement('a');

        if (file.isDirectory) {
            const details = document.createElement('details');
            // details.setAttribute('open', '');

            const summary = document.createElement('summary');

            summary.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="h-4 w-4">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                </svg>
                ${file.name}
                `;

            const ul = document.createElement('ul');
            details.appendChild(summary);
            details.appendChild(ul);

            li.appendChild(details);

            // li.innerText = file.name;
            // let ul = document.createElement('ul');
            createFileList(file.children, ul);
            // li.setAttribute('class', 'directory p-2.5 mt-3 flex items-center rounded-md px-4 duration-300 cursor-pointer hover:bg-blue-600 text-white');
            // li.appendChild(ul);
            ensureLibrarySortable(ul);
        } else {
            const songData = JSON.parse(window.fs.readFileSync(file.path, 'utf8'));
            a.innerHTML = `  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="h-4 w-4">
                <path stroke-linecap="round" stroke-linejoin="round" d="m9 9 10.5-3m0 6.553v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 1 1-.99-3.467l2.31-.66a2.25 2.25 0 0 0 1.632-2.163Zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 1 1-.99-3.467l2.31-.66A2.25 2.25 0 0 0 9 15.553Z" />
                </svg>
                ${songData.name}`
            li.appendChild(a);
            li.dataset.favoriteKind = 'song';
            li.dataset.songId = songData.id;
            li.dataset.songPath = file.path;
            li.dataset.songName = songData.name;
            li.classList.add('draggable');
        }

        container.appendChild(li);
    });
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

    a.classList.add('flex', 'items-center', 'gap-2', 'min-w-0');
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

    summary.classList.add('flex', 'items-center', 'gap-2', 'min-w-0');
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
    const item = event.target.closest('li[data-song-path], li[data-favorite-kind="folder"]');

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
        .catch(() => {});
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
            put: ['library', 'favorites'],
        },
        animation: 150,
        draggable: 'li',
        onAdd: scheduleFavoritesSave,
        onUpdate: scheduleFavoritesSave,
        onRemove: scheduleFavoritesSave,
        onEnd: scheduleFavoritesSave,
        onMove: (evt) => {
            if (allowFolderMoves) {
                return true;
            }

            return evt.dragged?.dataset?.favoriteKind !== 'folder';
        }
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
        main.innerHTML = '';
        currentLyrics = expandSongForProjection(songData);
        currentVerseIndex = undefined;

        currentLyrics.forEach((verse, i) => {
            const li = document.createElement('li');
            const formattedText = verse.text.replace(/\\n/g, '<br>');

            li.innerHTML = `<p class="mt-2 text-xs uppercase">#${i + 1} ${verse.label || verse.type}</p>` + formattedText;
            li.setAttribute('id', `verse-${i}`);
            li.classList.add('bg-gray-100', 'rounded-md', 'p-2', 'px-4', 'pb-3', 'hover:bg-gray-200', 'active:bg-gray-300', 'dark:bg-slate-800', 'hover:dark:bg-slate-700');

            li.addEventListener('click', () => {
                currentVerseIndex = i;
                updateProjection();
            });

            main.appendChild(li);
        });

        document.querySelector('#song-name').innerText = songData.name;
        ipcRenderer.send('song:loaded', currentLyrics.length);
        if (previewLyrics) {
            previewLyrics.innerHTML = '';
        }
    } catch (error) {
        console.error('Failed to load song', error);
        currentSongPath = null;
        currentLyrics = [];
        currentVerseIndex = undefined;
        renderSongPlaceholder();
    }
}

function renderSongPlaceholder() {
    if (!main || !rootElement) {
        return;
    }

    main.innerHTML = `
        <div class="text-center pt-16 text-lg font-bold">
          <p></p><i class="bi bi-arrow-left pr-3"></i>Select a song</p>
        </div>
    `;

    const songName = rootElement.querySelector('#song-name');
    if (songName) {
        songName.innerText = '';
    }

    if (previewLyrics) {
        previewLyrics.innerHTML = '';
    }
}

function expandSongForProjection(songData) {
    if (songData && Array.isArray(songData.sections) && Array.isArray(songData.arrangement)) {
        const sectionsById = new Map(
            songData.sections
                .filter((section) => section && typeof section.id === 'string')
                .map((section) => [section.id, section])
        );

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

    return [];
}

// function displayLyrics(sections) {
//     currentLyrics = sections;
//     currentVerseIndex = 0;
//     const lyricsContent = document.getElementById('lyrics-content');
//     lyricsContent.innerHTML = sections.map((section, index) => 
//       `<p data-index="${index}" class="${section.type}">${section.lines.join('<br>')}</p>`
//     ).join('');
//     document.querySelectorAll('#lyrics-content p').forEach(p => {
//       p.addEventListener('click', () => {
//         currentVerseIndex = parseInt(p.getAttribute('data-index'));
//         updateProjection();
//       });
//     });
//     updateProjection();
// }

function updateProjection() {
    if (!Array.isArray(currentLyrics) || currentVerseIndex === undefined || !currentLyrics[currentVerseIndex]) {
        if (previewLyrics) {
            previewLyrics.innerHTML = '';
        }
        return;
    }

    let formattedText = currentLyrics[currentVerseIndex].text.replace(/\\n/g, '<br>');
    if (previewLyrics) {
        previewLyrics.innerHTML = `<p>${formattedText}</p>`;
    }

    if (currentPreferences) {
        applyPreviewPreferences(currentPreferences);
    }

    ipcRenderer.send('display-lyrics', formattedText);
}

function changeToPrevVerse() {
    if(currentVerseIndex !== undefined && currentVerseIndex > 0) {
        currentVerseIndex--;
        updateProjection();
    }
}

function changeToNextVerse() {
    if(currentVerseIndex !== undefined && Array.isArray(currentLyrics) && currentVerseIndex < currentLyrics.length - 1) {
        currentVerseIndex++;
        updateProjection();
    }
}
