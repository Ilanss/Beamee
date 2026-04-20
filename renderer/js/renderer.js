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
let previewBox = null;
let editorBox = null;
let editorArrangementRoot = null;
let songNameNode = null;
let songNumberNode = null;
let editSongButton = null;
let editorControlsRoot = null;
let mounted = false;
let currentSongPath;
let currentSongData = null;
let currentSongDraft = null;
let currentSongDraftIsNew = false;
let currentSongDraftSourcePath = null;
let currentCollectionSelection = '';
let arrangementCheckbox = null;
let currentUseArrangement = true;
let editorSortable = null;
let arrangementSortable = null;
let isSongEditing = false;
let songEditorDirty = false;

const SECTION_TYPES = [
    'verse',
    'chorus',
    'pre-chorus',
    'bridge',
    'intro',
    'outro',
    'tag',
    'other',
];

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

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

function cloneSong(value) {
    return JSON.parse(JSON.stringify(value || {}));
}

function createBlankSongDraft() {
    return {
        schemaVersion: 1,
        id: 'song',
        name: '',
        authors: [],
        collections: [],
        sections: [],
        arrangement: [],
    };
}

function normalizeDraftCollectionId(value) {
    return String(value ?? '')
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function generateCollectionIdFromName(name) {
    const letters = String(name ?? '')
        .trim()
        .split(/\s+/)
        .map((word) => word[0] || '')
        .join('');

    return normalizeDraftCollectionId(letters || name || 'collection');
}

function getSectionText(section) {
    return Array.isArray(section?.lines) ? section.lines.join('\n') : '';
}

function setSectionText(section, value) {
    const lines = String(value ?? '').split('\n');
    section.lines = lines;
}

function ensureDraftShape(draft) {
    const nextDraft = cloneSong(draft || createBlankSongDraft());

    nextDraft.schemaVersion = 1;
    nextDraft.name = typeof nextDraft.name === 'string' ? nextDraft.name : '';
    nextDraft.authors = Array.isArray(nextDraft.authors) ? nextDraft.authors.filter((author) => typeof author === 'string') : [];
    nextDraft.collections = Array.isArray(nextDraft.collections) ? nextDraft.collections : [];
    nextDraft.sections = Array.isArray(nextDraft.sections) ? nextDraft.sections : [];
    nextDraft.arrangement = Array.isArray(nextDraft.arrangement) ? nextDraft.arrangement : [];

    nextDraft.sections = nextDraft.sections.map((section, index) => {
        const nextSection = isPlainObject(section) ? { ...section } : {};

        nextSection.id = normalizeDraftCollectionId(nextSection.id || nextSection.title || nextSection.type || `section-${index + 1}`) || `section-${index + 1}`;
        nextSection.type = SECTION_TYPES.includes(nextSection.type) ? nextSection.type : 'other';
        nextSection.title = typeof nextSection.title === 'string' && nextSection.title.trim() ? nextSection.title.trim() : '';
        nextSection.lines = Array.isArray(nextSection.lines)
            ? nextSection.lines.map((line) => (typeof line === 'string' ? line : ''))
            : [];

        return nextSection;
    });

    const sectionIds = new Set(nextDraft.sections.map((section) => section.id));
    nextDraft.arrangement = nextDraft.arrangement
        .map((item) => {
            if (!isPlainObject(item) || typeof item.sectionId !== 'string') {
                return null;
            }

            const sectionId = item.sectionId.trim();
            if (!sectionId || !sectionIds.has(sectionId)) {
                return null;
            }

            return {
                sectionId,
                label: typeof item.label === 'string' && item.label.trim() ? item.label.trim() : undefined,
            };
        })
        .filter(Boolean);

    if (nextDraft.arrangement.length === 0) {
        nextDraft.arrangement = nextDraft.sections.map((section) => ({ sectionId: section.id }));
    }

    return nextDraft;
}

function updateDraftSectionIds(draft) {
    const usedIds = new Set();

    draft.sections = draft.sections.map((section, index) => {
        const existingId = typeof section.id === 'string' ? section.id.trim() : '';
        const baseId = normalizeDraftCollectionId(existingId || section.title || section.type || `section-${index + 1}`) || `section-${index + 1}`;
        let candidate = existingId || baseId;
        let suffix = 2;

        while (usedIds.has(candidate)) {
            candidate = `${baseId}-${suffix++}`;
        }

        usedIds.add(candidate);

        return {
            ...section,
            id: candidate,
            type: SECTION_TYPES.includes(section.type) ? section.type : 'other',
            title: typeof section.title === 'string' ? section.title : '',
            lines: Array.isArray(section.lines) ? section.lines : [],
        };
    });

    const sectionIds = new Set(draft.sections.map((section) => section.id));
    draft.arrangement = draft.arrangement.filter((item) => item && sectionIds.has(item.sectionId));

    if (draft.arrangement.length === 0) {
        draft.arrangement = draft.sections.map((section) => ({ sectionId: section.id }));
    }
}

function getDraftCollectionIndex(draft) {
    if (!draft?.collections?.length) {
        return -1;
    }

    if (currentCollectionSelection === 'new') {
        return -1;
    }

    const index = Number.parseInt(currentCollectionSelection, 10);
    return Number.isInteger(index) ? index : 0;
}

function getSelectedCollectionDraft(draft) {
    const index = getDraftCollectionIndex(draft);

    if (index >= 0 && draft.collections[index]) {
        return draft.collections[index];
    }

    return null;
}

function ensureCollectionDraft(draft) {
    if (!draft.collections.length) {
        const nextCollection = {
            name: '',
            collectionId: '',
            reference: '',
            number: undefined,
        };

        draft.collections.push(nextCollection);
        currentCollectionSelection = '0';
        return nextCollection;
    }

    const selected = getSelectedCollectionDraft(draft);
    if (selected) {
        return selected;
    }

    return draft.collections[0];
}

function bindSelectAllShortcut(input) {
    if (!input) {
        return;
    }

    input.addEventListener('keydown', (event) => {
        if (!((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a')) {
            return;
        }

        event.preventDefault();
        input.select();
    });
}

function protectEditorControl(element) {
    if (!element) {
        return;
    }

    ['pointerdown', 'mousedown', 'click'].forEach((eventName) => {
        element.addEventListener(eventName, (event) => {
            event.stopPropagation();
        });
    });
}

function setEditMode(active) {
    isSongEditing = Boolean(active);

    if (previewBox) {
        previewBox.hidden = isSongEditing;
    }

    if (editorBox) {
        editorBox.hidden = !isSongEditing;
    }

    if (editSongButton) {
        editSongButton.hidden = isSongEditing;
    }
}

function updateEditSongButtonLabel() {
    if (!editSongButton) {
        return;
    }

    editSongButton.textContent = currentSongPath ? 'Edit' : 'New';
}

function markSongEditorDirty() {
    if (currentSongDraft) {
        songEditorDirty = true;
    }
}

function resetSongEditorDirty() {
    songEditorDirty = false;
}

async function promptSongSwitchDecision() {
    if (!songEditorDirty) {
        return 'discard';
    }

    const response = await ipcRenderer.invoke('editor:prompt-song-switch');

    if (response === 0) {
        return 'discard';
    }

    if (response === 1) {
        return 'save';
    }

    return 'cancel';
}

function closeSongEditor({ reloadPath = currentSongPath, reloadCurrentSong = true } = {}) {
    currentSongDraft = null;
    currentSongDraftIsNew = false;
    currentSongDraftSourcePath = null;
    currentCollectionSelection = '';
    resetSongEditorDirty();

    if (arrangementSortable) {
        arrangementSortable.destroy?.();
        arrangementSortable = null;
    }

    if (editorSortable) {
        editorSortable.destroy?.();
        editorSortable = null;
    }

    if (editorControlsRoot) {
        editorControlsRoot.remove();
        editorControlsRoot = null;
    }

    setEditMode(false);

    if (reloadPath) {
        loadSong(reloadPath);
        return;
    }

    if (reloadCurrentSong && currentSongPath) {
        loadSong(currentSongPath);
        return;
    }

    updateEditSongButtonLabel();
    ipcRenderer.send('song:selected', null);
    renderSongPlaceholder();
}

function isDirtySongEditor() {
    return Boolean(isSongEditing && songEditorDirty);
}

async function handleSongSwitch(nextAction) {
    if (!isDirtySongEditor()) {
        await nextAction?.();
        return;
    }

    const decision = await promptSongSwitchDecision();

    if (decision === 'cancel') {
        return;
    }

    if (decision === 'save') {
        await saveCurrentSongDraft({ reloadSavedSong: false });
    } else {
        closeSongEditor({ reloadPath: null, reloadCurrentSong: false });
    }

    await nextAction?.();
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

function renderSongView(songData) {
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

function renderSongHeader() {
    if (!songNameNode || !songNumberNode) {
        return;
    }

    if (currentSongDraft && isSongEditing) {
        const draft = currentSongDraft;
        const collection = ensureCollectionDraft(draft);

        songNameNode.replaceChildren();
        const titleInput = document.createElement('input');
        titleInput.type = 'text';
        titleInput.value = draft.name || '';
        titleInput.placeholder = 'Song title';
        titleInput.className = 'input input-bordered input-sm w-full max-w-md';
        titleInput.addEventListener('input', () => {
            draft.name = titleInput.value;
            markSongEditorDirty();
        });
        songNameNode.appendChild(titleInput);

        songNumberNode.replaceChildren();
        const collectionSpan = document.createElement('span');
        collectionSpan.className = 'mr-2';
        collectionSpan.textContent = `${collection.collectionId || 'collection'} #`;

        const numberInput = document.createElement('input');
        numberInput.type = 'text';
        numberInput.value = collection.number == null ? '' : String(collection.number);
        numberInput.placeholder = '#';
        numberInput.className = 'input input-ghost input-xs w-16 text-right';
        numberInput.addEventListener('input', () => {
            const parsed = Number.parseInt(numberInput.value, 10);
            collection.number = Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
            markSongEditorDirty();
        });

        songNumberNode.appendChild(collectionSpan);
        songNumberNode.appendChild(numberInput);
        return;
    }

    if (currentSongData) {
        songNameNode.textContent = currentSongData.name || '';
        const collection = currentSongData.collections?.[0];
        songNumberNode.textContent = collection?.number != null && collection?.collectionId
            ? `${String(collection.collectionId).toUpperCase()} #${collection.number}`
            : '';
        return;
    }

    songNameNode.textContent = '';
    songNumberNode.textContent = '';
}

function renderSongSectionsEditor() {
    if (!main || !currentSongDraft || !isSongEditing) {
        return;
    }

    const draft = currentSongDraft;
    updateDraftSectionIds(draft);

    main.replaceChildren();

    const addSectionButton = document.createElement('button');
    addSectionButton.type = 'button';
    addSectionButton.className = 'btn btn-sm btn-outline mb-2';
    addSectionButton.textContent = '+ Add section';
    addSectionButton.addEventListener('click', () => {
        draft.sections.push({
            id: `section-${draft.sections.length + 1}`,
            type: 'other',
            title: '',
            lines: [],
        });
        markSongEditorDirty();
        updateDraftSectionIds(draft);
        renderSongSectionsEditor();
        renderPreviewEditor();
    });

    const controlsLi = document.createElement('li');
    controlsLi.appendChild(addSectionButton);
    main.appendChild(controlsLi);

    draft.sections.forEach((section, index) => {
        const li = document.createElement('li');
        li.className = 'mb-3 rounded-md border border-base-300 p-3 bg-base-100';
        li.dataset.sectionId = section.id;

        const header = document.createElement('div');
        header.className = 'flex items-center gap-2 mb-2';

        const dragHandle = document.createElement('span');
        dragHandle.className = 'section-drag-handle cursor-grab select-none';
        dragHandle.textContent = '::';
        header.appendChild(dragHandle);

        const typeSelect = document.createElement('select');
        typeSelect.className = 'select select-bordered select-xs';
        SECTION_TYPES.forEach((type) => {
            const option = document.createElement('option');
            option.value = type;
            option.textContent = type;
            typeSelect.appendChild(option);
        });
        typeSelect.value = section.type || 'other';
        protectEditorControl(typeSelect);
        typeSelect.addEventListener('change', () => {
            section.type = typeSelect.value;
            markSongEditorDirty();
            renderPreviewEditor();
        });
        header.appendChild(typeSelect);

        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.className = 'btn btn-xs btn-ghost text-error ml-auto';
        removeButton.textContent = 'Remove';
        removeButton.addEventListener('click', () => {
            draft.sections.splice(index, 1);
            draft.arrangement = draft.arrangement.filter((item) => item.sectionId !== section.id);
            markSongEditorDirty();
            updateDraftSectionIds(draft);
            renderSongSectionsEditor();
            renderPreviewEditor();
        });
        header.appendChild(removeButton);

        const titleInput = document.createElement('input');
        titleInput.type = 'text';
        titleInput.placeholder = 'Section title';
        titleInput.value = section.title || '';
        titleInput.className = 'input input-bordered input-xs w-full mb-2';
        protectEditorControl(titleInput);
        titleInput.addEventListener('input', () => {
            section.title = titleInput.value;
            markSongEditorDirty();
            renderPreviewEditor();
        });

        const textArea = document.createElement('textarea');
        textArea.className = 'textarea textarea-bordered w-full min-h-32';
        textArea.value = getSectionText(section);
        protectEditorControl(textArea);
        textArea.addEventListener('input', () => {
            setSectionText(section, textArea.value);
            markSongEditorDirty();
            renderPreviewEditor();
        });

        li.appendChild(header);
        li.appendChild(titleInput);
        li.appendChild(textArea);
        main.appendChild(li);
    });

    if (!editorSortable) {
        editorSortable = Sortable.create(main, {
            draggable: 'li[data-section-id]',
            handle: '.section-drag-handle',
            animation: 150,
            filter: 'button, input, textarea, select',
            preventOnFilter: false,
            onEnd: () => {
                const orderedIds = Array.from(main.querySelectorAll('li[data-section-id]')).map((item) => item.dataset.sectionId);
                draft.sections = orderedIds.map((sectionId) => draft.sections.find((section) => section.id === sectionId)).filter(Boolean);
                updateDraftSectionIds(draft);
                renderPreviewEditor();
            },
        });
    }
}

function renderPreviewEditor() {
    if (!editorArrangementRoot || !currentSongDraft || !isSongEditing) {
        return;
    }

    if (arrangementSortable) {
        arrangementSortable.destroy?.();
        arrangementSortable = null;
    }

    editorArrangementRoot.replaceChildren();

    const title = document.createElement('p');
    title.className = 'text-xs uppercase mb-2';
    title.textContent = 'Arrangement maker';
    editorArrangementRoot.appendChild(title);

    const list = document.createElement('ul');
    list.className = 'space-y-2';

    currentSongDraft.arrangement.forEach((step, index) => {
        const item = document.createElement('li');
        item.className = 'flex items-center gap-2';
        item.dataset.arrangementIndex = String(index);

        const handle = document.createElement('span');
        handle.className = 'arrangement-drag-handle cursor-grab select-none';
        handle.textContent = '::';
        item.appendChild(handle);

        const select = document.createElement('select');
        select.className = 'select select-bordered select-xs flex-1';
        protectEditorControl(select);
        currentSongDraft.sections.forEach((section) => {
            const option = document.createElement('option');
            option.value = section.id;
            option.textContent = `${section.type || 'other'}${section.title ? ` - ${section.title}` : ''}`;
            select.appendChild(option);
        });
        select.value = step.sectionId;
        select.addEventListener('change', () => {
            step.sectionId = select.value;
            markSongEditorDirty();
        });
        item.appendChild(select);

        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.className = 'btn btn-xs btn-ghost text-error';
        removeButton.textContent = 'Remove';
        removeButton.addEventListener('click', () => {
            currentSongDraft.arrangement.splice(index, 1);
            markSongEditorDirty();
            renderPreviewEditor();
        });
        item.appendChild(removeButton);

        list.appendChild(item);
    });

    editorArrangementRoot.appendChild(list);

    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'btn btn-sm btn-outline mt-3';
    addButton.textContent = '+ Add arrangement item';
    addButton.addEventListener('click', () => {
        const firstSection = currentSongDraft.sections[0];
        if (firstSection) {
            currentSongDraft.arrangement.push({ sectionId: firstSection.id });
            markSongEditorDirty();
            renderPreviewEditor();
        }
    });

    editorArrangementRoot.appendChild(addButton);

    arrangementSortable = Sortable.create(list, {
        draggable: 'li',
        handle: '.arrangement-drag-handle',
        animation: 150,
        preventOnFilter: false,
        onEnd: () => {
            const orderedIndexes = Array.from(list.querySelectorAll('li[data-arrangement-index]')).map((item) => Number.parseInt(item.dataset.arrangementIndex, 10));
            currentSongDraft.arrangement = orderedIndexes.map((index) => currentSongDraft.arrangement[index]).filter(Boolean);
            renderPreviewEditor();
        },
    });
}

function renderCollectionEditor() {
    if (!editorBox || !currentSongDraft || !isSongEditing) {
        return;
    }

    if (editorControlsRoot) {
        editorControlsRoot.remove();
    }

    editorControlsRoot = document.createElement('div');
    editorControlsRoot.className = 'space-y-3 mt-3';

    const collectionRow = document.createElement('div');
    collectionRow.className = 'space-y-2';

    const selector = document.createElement('select');
    selector.className = 'select select-bordered select-sm w-full';
    currentSongDraft.collections.forEach((collection, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = `${collection.name || collection.collectionId || `Collection ${index + 1}`}`;
        selector.appendChild(option);
    });
    const newOption = document.createElement('option');
    newOption.value = 'new';
    newOption.textContent = 'new collection';
    selector.appendChild(newOption);
    selector.value = currentCollectionSelection || (currentSongDraft.collections.length ? '0' : 'new');
    protectEditorControl(selector);
    selector.addEventListener('change', () => {
        currentCollectionSelection = selector.value;
        renderCollectionEditor();
        renderSongHeader();
    });

    collectionRow.appendChild(selector);

    const selected = selector.value === 'new' ? null : currentSongDraft.collections[Number.parseInt(selector.value, 10)];
    const collection = selected || null;

    const nameInput = document.createElement('input');
    nameInput.className = 'input input-bordered input-sm w-full';
    nameInput.placeholder = 'Collection name';
    nameInput.value = collection?.name || '';
    protectEditorControl(nameInput);
    nameInput.addEventListener('input', () => {
        if (collection) {
            collection.name = nameInput.value;
            markSongEditorDirty();
            renderSongHeader();
        } else {
            const nextCollection = {
                name: nameInput.value,
                collectionId: '',
                reference: '',
                number: undefined,
            };
            currentSongDraft.collections.push(nextCollection);
            currentCollectionSelection = String(currentSongDraft.collections.length - 1);
            markSongEditorDirty();
            renderCollectionEditor();
            renderSongHeader();
        }
    });

    const idInput = document.createElement('input');
    idInput.className = 'input input-bordered input-sm w-full';
    idInput.placeholder = 'Collection id';
    idInput.value = collection?.collectionId || '';
    protectEditorControl(idInput);
    idInput.addEventListener('input', () => {
        if (collection) {
            collection.collectionId = idInput.value;
            markSongEditorDirty();
            renderSongHeader();
        }
    });

    const idHelper = document.createElement('p');
    idHelper.className = 'text-xs opacity-70';
    idHelper.textContent = 'Leave id empty to generate from the name.';

    const numberInput = document.createElement('input');
    numberInput.className = 'input input-bordered input-sm w-full';
    numberInput.placeholder = 'Collection number';
    numberInput.value = collection?.number == null ? '' : String(collection.number);
    protectEditorControl(numberInput);
    numberInput.addEventListener('input', () => {
        if (collection) {
            const parsed = Number.parseInt(numberInput.value, 10);
            collection.number = Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
            markSongEditorDirty();
            renderSongHeader();
        }
    });

    if (!collection && currentSongDraft.collections.length === 0) {
        currentCollectionSelection = 'new';
    }

    collectionRow.appendChild(nameInput);
    collectionRow.appendChild(idInput);
    collectionRow.appendChild(idHelper);
    collectionRow.appendChild(numberInput);

    const actions = document.createElement('div');
    actions.className = 'flex gap-2';

    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.className = 'btn btn-sm btn-primary';
    saveButton.textContent = 'Save';
    saveButton.addEventListener('click', () => {
        saveCurrentSongDraft().catch((error) => console.error('Failed to save song draft', error));
    });

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'btn btn-sm btn-ghost';
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', () => {
        cancelSongEdit();
    });

    actions.appendChild(saveButton);
    actions.appendChild(cancelButton);

    editorControlsRoot.appendChild(collectionRow);
    editorControlsRoot.appendChild(actions);
    editorBox.appendChild(editorControlsRoot);
}

function renderEditorMode() {
    if (!currentSongDraft) {
        return;
    }

    renderSongHeader();
    renderSongSectionsEditor();
    renderPreviewEditor();
    renderCollectionEditor();
}

function beginSongEdit(draft, isNew = false) {
    currentSongDraft = ensureDraftShape(draft);
    currentSongDraftIsNew = isNew;
    currentSongDraftSourcePath = isNew ? null : currentSongPath;
    currentCollectionSelection = '0';
    resetSongEditorDirty();

    setEditMode(true);

    renderEditorMode();
}

function openSongEditorForCurrentSong() {
    beginSongEdit(currentSongData ? cloneSong(currentSongData) : createBlankSongDraft(), Boolean(currentSongPath));
}

function openNewSongDraft() {
    currentSongData = null;
    currentSongPath = null;
    currentLyrics = [];
    currentVerseIndex = undefined;
    resetSongEditorDirty();
    ipcRenderer.send('song:selected', null);
    if (main) {
        main.replaceChildren();
    }

    beginSongEdit(createBlankSongDraft(), true);
}

function cancelSongEdit() {
    closeSongEditor({ reloadPath: currentSongPath });
}

function syncCurrentCollectionFromEditor(draft) {
    if (!draft.collections.length) {
        return;
    }

    let collection = getSelectedCollectionDraft(draft);

    if (!collection && currentCollectionSelection === 'new') {
        const nameInput = editorControlsRoot?.querySelector('input[placeholder="Collection name"]');
        const idInput = editorControlsRoot?.querySelector('input[placeholder="Collection id"]');
        const numberInput = editorControlsRoot?.querySelector('input[placeholder="Collection number"]');

        const name = typeof nameInput?.value === 'string' ? nameInput.value.trim() : '';
        const collectionId = typeof idInput?.value === 'string' && idInput.value.trim()
            ? idInput.value.trim()
            : generateCollectionIdFromName(name);

        collection = {
            name,
            collectionId,
            reference: '',
            number: undefined,
        };

        const parsed = Number.parseInt(numberInput?.value || '', 10);
        if (Number.isInteger(parsed) && parsed > 0) {
            collection.number = parsed;
        }

        draft.collections.push(collection);
        currentCollectionSelection = String(draft.collections.length - 1);
    }

    if (!collection) {
        return;
    }

    const nameInput = editorControlsRoot?.querySelector('input[placeholder="Collection name"]');
    const idInput = editorControlsRoot?.querySelector('input[placeholder="Collection id"]');
    const numberInput = editorControlsRoot?.querySelector('input[placeholder="Collection number"]');

    collection.name = typeof nameInput?.value === 'string' && nameInput.value.trim()
        ? nameInput.value.trim()
        : collection.name || draft.name || 'Collection 1';
    collection.collectionId = typeof idInput?.value === 'string' && idInput.value.trim()
        ? idInput.value.trim()
        : generateCollectionIdFromName(collection.name);

    const parsed = Number.parseInt(numberInput?.value || '', 10);
    collection.number = Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

async function saveCurrentSongDraft(options = {}) {
    if (!currentSongDraft) {
        return;
    }

    const draft = ensureDraftShape(currentSongDraft);
    syncCurrentCollectionFromEditor(draft);

    const titleInput = songNameNode?.querySelector('input');
    if (titleInput) {
        draft.name = titleInput.value.trim();
    }

    updateDraftSectionIds(draft);

    const payload = {
        ...draft,
        id: currentSongDraftIsNew
            ? (normalizeDraftCollectionId(draft.name || draft.id || 'song') || 'song')
            : (currentSongData?.id || draft.id || 'song'),
    };

    const result = await ipcRenderer.invoke('song:save', {
        song: payload,
        targetPath: currentSongDraftIsNew ? null : currentSongDraftSourcePath || currentSongPath,
        isNew: currentSongDraftIsNew,
    });

    if (!result?.ok) {
        window.alert(result?.error || 'Unable to save song.');
        return;
    }

    if (result.canceled) {
        return;
    }

    currentSongPath = result.filePath || currentSongPath;
    currentSongDraft = null;
    currentSongDraftIsNew = false;
    currentSongDraftSourcePath = null;
    currentCollectionSelection = '';
    resetSongEditorDirty();

    setEditMode(false);

    if (editorControlsRoot) {
        editorControlsRoot.remove();
        editorControlsRoot = null;
    }

    if (arrangementSortable) {
        arrangementSortable.destroy?.();
        arrangementSortable = null;
    }

    if (editorSortable) {
        editorSortable.destroy?.();
        editorSortable = null;
    }

    if (options.reloadSavedSong !== false) {
        loadSong(currentSongPath);

        if (previewLyrics) {
            previewLyrics.replaceChildren();
        }
    }

    const state = await ipcRenderer.invoke('library:state');
    if (state?.library) {
        createFileList(state.library, libraryListContainer);
    }
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
    songNameNode = rootElement.querySelector('#song-name');
    songNumberNode = rootElement.querySelector('#song-number');
    libraryListContainer = rootElement.querySelector('#library-list ul');
    librarySearchInput = rootElement.querySelector('#library-search');
    librarySearchWrap = rootElement.querySelector('#library-search-wrap');
    librarySearchIcon = librarySearchWrap?.querySelector('#search-icon') || null;
    favoritesListContainer = rootElement.querySelector('#favorites-list');
    favoritesListRoot = favoritesListContainer?.querySelector('ul');
    createPlaylistButton = rootElement.querySelector('#create-playlist');
    previewBox = rootElement.querySelector('#preview-box');
    editorBox = rootElement.querySelector('#editor-box');
    previewContent = rootElement.querySelector('#preview');
    editorArrangementRoot = editorBox?.querySelector('#editor-arrangement') || null;
    editorControlsRoot = null;
    previewLyrics = document.createElement('div');
    arrangementCheckbox = rootElement.querySelector('#arrangement');
    editSongButton = rootElement.querySelector('#edit-song-button');

    if (previewContent) {
        previewLyrics.id = 'preview-lyrics';
        previewContent.appendChild(previewLyrics);
    }

    updateEditSongButtonLabel();
    setEditMode(false);

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

        if (currentSongPath && previousUseArrangement !== currentUseArrangement && !isSongEditing) {
            renderCurrentSong();
            return;
        }

        if (isSongEditing) {
            renderPreviewEditor();
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

            if (currentSongPath && !isSongEditing) {
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

        if (currentSongPath && !isSongEditing) {
            renderCurrentSong();
            return;
        }

        if (isSongEditing) {
            renderPreviewEditor();
        }
    });

    on(editSongButton, 'click', () => {
        openSongEditorForCurrentSong();
    });

    on(rootElement.querySelector('#create-song'), 'click', (event) => {
        event.preventDefault();
        handleSongSwitch(async () => {
            openNewSongDraft();
        }).catch((error) => {
            console.warn('Failed to open new song draft', error);
        });
    });

    onIpc('song:new', () => {
        handleSongSwitch(async () => {
            openNewSongDraft();
        }).catch((error) => {
            console.warn('Failed to open new song draft', error);
        });
    });

    onIpc('song:edit', () => {
        openSongEditorForCurrentSong();
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

    bindSelectAllShortcut(librarySearchInput);

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
        } else {
            renderSongPlaceholder();
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
    previewBox = null;
    editorBox = null;
    editorArrangementRoot = null;
    songNameNode = null;
    songNumberNode = null;
    editSongButton = null;
    editorControlsRoot = null;
    libraryClickDelegated = false;
    favoritesClickDelegated = false;
    favoritesContextMenuDelegated = false;
    librarySongContextMenuDelegated = false;
    favoritesSongContextMenuDelegated = false;
    editorSortable = null;
    arrangementSortable = null;
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
    bindSelectAllShortcut(input);

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

        const nextSongPath = item.dataset.songPath;

        if (nextSongPath && nextSongPath === currentSongPath) {
            return;
        }

        handleSongSwitch(async () => {
            document.querySelectorAll('a.active').forEach((anchor) => {
                anchor.classList.remove('active');
            });

            item.querySelector('a')?.classList.add('active');
            loadSong(nextSongPath);
        }).catch((error) => {
            console.warn('Failed to switch songs', error);
        });
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
        setEditMode(false);
        resetSongEditorDirty();
        const songData = JSON.parse(window.fs.readFileSync(songPath, 'utf8'));

        currentSongPath = songPath;
        currentSongData = songData;
        currentSongDraft = null;
        currentSongDraftIsNew = false;
        currentSongDraftSourcePath = null;
        currentCollectionSelection = '';
        updateEditSongButtonLabel();
        ipcRenderer.send('song:selected', songPath);
        renderSongView(songData);
        renderSongHeader();

        if (previewLyrics) {
            previewLyrics.replaceChildren();
        }
    } catch (error) {
        console.error('Failed to load song', error);
        currentSongPath = null;
        currentSongData = null;
        currentSongDraft = null;
        updateEditSongButtonLabel();
        ipcRenderer.send('song:selected', null);
        ipcRenderer.send('song:loaded', 0);
        currentLyrics = [];
        currentVerseIndex = undefined;
        setEditMode(false);
        resetSongEditorDirty();
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

    if (songNameNode) {
        songNameNode.innerHTML = '';
    }

    if (songNumberNode) {
        songNumberNode.innerHTML = '';
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
