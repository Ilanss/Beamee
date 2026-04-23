const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, Menu, ipcMain, screen, dialog, shell, protocol, net } = require('electron');
const archiver = require('archiver');

const libraryController = require('./assets/js/libraryController.js');
const fileController = require('./assets/js/fileController.js');
const songSchema = require('./assets/js/songSchema.js');
const { DEFAULT_PREFERENCES, mergePreferences, normalizePreferences } = require('./assets/js/preferencesStore.js');

const isDev = !app.isPackaged;

// Register beamee-asset:// as a privileged scheme so it can be used in CSS
// background-image from renderer and projector contexts.
protocol.registerSchemesAsPrivileged([
    { scheme: 'beamee-asset', privileges: { secure: true, standard: true, supportFetchAPI: true } },
]);

let isProjectionOn = false;
let projectorWindow;
let mainWindow;
let appDataPaths;
let libraryState;
let currentSongPath = null;

let lastVerseCount;

const getAppDataPaths = () => {
    const baseDir = app.getPath('userData');

    return {
        baseDir,
        library: path.join(baseDir, 'library'),
        favorites: path.join(baseDir, 'favorites.json'),
        preferences: path.join(baseDir, 'preferences.json'),
    };
};

const ensureDirSync = (dir) => {
    fs.mkdirSync(dir, { recursive: true });
};

const bootstrapAppData = () => {
    const paths = getAppDataPaths();

    ensureDirSync(paths.baseDir);
    ensureDirSync(paths.library);

    if (!fs.existsSync(paths.favorites)) {
        fs.writeFileSync(paths.favorites, '[]');
    }

    if (!fs.existsSync(paths.preferences)) {
        fs.writeFileSync(paths.preferences, JSON.stringify(DEFAULT_PREFERENCES, null, 2));
    }

    return paths;
};

const readJsonFile = (filePath, fallback) => {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
        console.error(`Error reading JSON file: ${filePath}`, err);
        return fallback;
    }
};

const saveJsonFile = (filePath, data) => {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
};

const buildSongFileStem = (song) => {
    const parts = [];
    const collection = Array.isArray(song?.collections) ? song.collections[0] : null;
    const collectionName = typeof collection?.name === 'string' && collection.name.trim()
        ? collection.name.trim()
        : typeof collection?.collectionId === 'string' && collection.collectionId.trim()
            ? collection.collectionId.trim()
            : '';

    if (collectionName) {
        parts.push(songSchema.normalizeId(collectionName, 'collection'));
    }

    if (Number.isInteger(collection?.number) && collection.number > 0) {
        parts.push(String(collection.number));
    }

    const songName = typeof song?.name === 'string' && song.name.trim()
        ? song.name.trim()
        : typeof song?.id === 'string' && song.id.trim()
            ? song.id.trim()
            : 'song';

    parts.push(songSchema.normalizeId(songName, 'song'));

    return parts.filter(Boolean).join('-') || 'song';
};

const resolveUniqueSongPath = (directoryPath, song) => {
    const stem = buildSongFileStem(song);
    let candidate = path.join(directoryPath, `${stem}.json`);
    let suffix = 2;

    while (fs.existsSync(candidate)) {
        candidate = path.join(directoryPath, `${stem}-${suffix++}.json`);
    }

    return candidate;
};

const refreshLibraryState = () => {
    libraryState = null;
    ensureLibraryDataLoaded();
    return libraryState;
};

const notifyLibraryChanged = () => {
    for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send('library:changed');
    }
};

const getSongPathForId = (songId) => {
    return libraryState?.songPathById?.get(songId) || path.join(appDataPaths.library, `${songId}.json`);
};

const getCurrentSongPath = () => currentSongPath;

const isMac = process.platform === 'darwin';

const collectJsonFilesFromDirectory = (directoryPath, basePath = directoryPath) => {
    const files = [];

    if (!fs.existsSync(directoryPath)) {
        return files;
    }

    const entries = fs.readdirSync(directoryPath, { withFileTypes: true });

    for (const entry of entries) {
        if (entry.name.startsWith('.')) {
            continue;
        }

        const fullPath = path.join(directoryPath, entry.name);

        if (entry.isDirectory()) {
            files.push(...collectJsonFilesFromDirectory(fullPath, basePath));
            continue;
        }

        if (!entry.name.endsWith('.json')) {
            continue;
        }

        files.push(path.relative(basePath, fullPath).split(path.sep).join('/'));
    }

    return files;
};

const expandImportSelection = (selectedPaths) => {
    const files = [];
    const seen = new Set();

    (Array.isArray(selectedPaths) ? selectedPaths : []).forEach((selectedPath) => {
        if (!selectedPath || seen.has(selectedPath)) {
            return;
        }

        seen.add(selectedPath);

        if (!fs.existsSync(selectedPath)) {
            return;
        }

        const stat = fs.statSync(selectedPath);

        if (stat.isDirectory()) {
            collectJsonFilesFromDirectory(selectedPath).forEach((relativePath) => {
                const absolutePath = path.join(selectedPath, relativePath);

                if (!seen.has(absolutePath)) {
                    seen.add(absolutePath);
                    files.push(absolutePath);
                }
            });
            return;
        }

        if (stat.isFile() && selectedPath.endsWith('.json')) {
            files.push(selectedPath);
        }
    });

    return files;
};

const exportSongJson = async (window, songPath) => {
    if (!songPath) {
        return { ok: false, error: 'No song is selected.' };
    }

    const song = fileController.readFile(songPath);

    if (!song || typeof song !== 'object') {
        return { ok: false, error: 'Selected song could not be read.' };
    }

    const defaultName = `${typeof song.name === 'string' && song.name.trim() ? song.name.trim() : path.basename(songPath, path.extname(songPath))}.json`;
    const { canceled, filePath } = await dialog.showSaveDialog(window, {
        defaultPath: defaultName,
        filters: [{ name: 'JSON', extensions: ['json'] }],
    });

    if (canceled || !filePath) {
        return { ok: true, canceled: true };
    }

    fileController.writeFile(filePath, song);
    return { ok: true, filePath };
};

const saveSongDraft = async (window, song, targetPath, isNew) => {
    const normalizedSong = songSchema.normalizeSong(song, {
        sourcePath: targetPath || undefined,
        fallbackId: song?.id || song?.name || 'song',
    });
    const errors = songSchema.validateSong(normalizedSong);

    if (errors.length > 0) {
        return { ok: false, error: errors.join('; ') };
    }

    const filePath = targetPath
        ? targetPath
        : resolveUniqueSongPath(appDataPaths.library, normalizedSong);

    ensureDirSync(path.dirname(filePath));

    if (isNew && normalizedSong.id === 'song' && typeof filePath === 'string') {
        normalizedSong.id = songSchema.normalizeId(path.basename(filePath, path.extname(filePath)), 'song');
    }

    const finalErrors = songSchema.validateSong(normalizedSong);

    if (finalErrors.length > 0) {
        return { ok: false, error: finalErrors.join('; ') };
    }

    saveJsonFile(filePath, normalizedSong);
    refreshLibraryState();
    notifyLibraryChanged();

    return { ok: true, filePath };
};

const exportLibraryZip = async (window) => {
    ensureLibraryDataLoaded();

    const { canceled, filePath } = await dialog.showSaveDialog(window, {
        defaultPath: 'library.zip',
        filters: [{ name: 'Zip archive', extensions: ['zip'] }],
    });

    if (canceled || !filePath) {
        return { ok: true, canceled: true };
    }

    const songFiles = libraryController.walkLibrarySongFiles(appDataPaths.library);

    await new Promise((resolve, reject) => {
        const output = fs.createWriteStream(filePath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', resolve);
        output.on('error', reject);
        archive.on('error', reject);

        archive.pipe(output);

        songFiles.forEach((entry) => {
            archive.file(entry.path, { name: entry.relativePath });
        });

        archive.finalize();
    });

    return { ok: true, filePath, count: songFiles.length };
};

const createImportedSongCopyWithReservedIds = (song, sourcePath, reservedIds) => {
    const baseName = typeof song.name === 'string' && song.name.trim()
        ? song.name.trim()
        : path.basename(sourcePath, path.extname(sourcePath));
    const normalized = songSchema.normalizeId(baseName || 'song', 'song');
    let candidate = normalized;
    let counter = 1;

    while (reservedIds.has(candidate)) {
        candidate = `${normalized}-${counter++}`;
    }

    reservedIds.add(candidate);

    return {
        ...song,
        id: candidate,
    };
};

const promptImportConflict = async (window, song, existingPath) => {
    const result = await dialog.showMessageBox(window, {
        type: 'question',
        buttons: ['Overwrite All', 'Create Copies', 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        title: 'Song already exists',
        message: `A song with id "${song.id}" already exists.`,
        detail: `Existing file: ${existingPath}`,
        noLink: true,
    });

    if (result.response === 0) {
        return 'overwrite';
    }

    if (result.response === 1) {
        return 'copy';
    }

    return 'cancel';
};

const buildImportCandidate = (filePath, songPathById) => {
    const rawSong = fileController.readFile(filePath);

    if (!rawSong || typeof rawSong !== 'object' || Array.isArray(rawSong)) {
        return { ok: false, status: 'skipped', filePath, reason: 'invalid-json' };
    }

    const normalizedSong = songSchema.normalizeSong(rawSong, { sourcePath: filePath });
    const errors = songSchema.validateSong(normalizedSong);

    if (errors.length > 0) {
        return { ok: false, status: 'skipped', filePath, reason: 'validation-failed', errors };
    }

    const existingPath = songPathById.get(normalizedSong.id);
    return {
        ok: true,
        status: existingPath ? 'conflict' : 'ready',
        filePath,
        targetPath: existingPath || getSongPathForId(normalizedSong.id),
        songId: normalizedSong.id,
        existingPath,
        song: normalizedSong,
    };
};

const importSongsFromFiles = async (window, filePaths) => {
    ensureLibraryDataLoaded();

    const songPathById = new Map(libraryState?.songPathById || []);
    const results = [];
    const candidates = [];
    const seenIds = new Set();
    const firstCandidateById = new Map();
    let hasAnyConflict = false;

    for (const filePath of filePaths) {
        const candidate = buildImportCandidate(filePath, songPathById);

        if (!candidate.ok) {
            results.push(candidate);
            continue;
        }

        if (seenIds.has(candidate.songId)) {
            candidate.batchConflict = true;
            firstCandidateById.get(candidate.songId).batchConflict = true;
            hasAnyConflict = true;
        } else {
            seenIds.add(candidate.songId);
            firstCandidateById.set(candidate.songId, candidate);
            candidate.batchConflict = Boolean(candidate.existingPath);
            hasAnyConflict = hasAnyConflict || candidate.batchConflict;
        }

        candidates.push(candidate);
    }

    let conflictMode = 'overwrite';

    if (hasAnyConflict) {
        const conflictCount = candidates.filter((candidate) => candidate.batchConflict).length;
        const conflictDecision = await dialog.showMessageBox(window, {
            type: 'question',
            buttons: ['Overwrite All', 'Create Copies', 'Cancel'],
            defaultId: 0,
            cancelId: 2,
            title: 'Conflicting songs found',
            message: `${conflictCount} song(s) in this import already exist or conflict with another selected file.`,
            detail: 'Choose how to handle every conflict before any files are imported.',
            noLink: true,
        });

        if (conflictDecision.response === 2) {
            return {
                ok: true,
                canceled: true,
                results: results.concat(candidates.map((candidate) => ({
                    ok: false,
                    status: 'skipped',
                    filePath: candidate.filePath,
                    reason: 'cancelled',
                }))),
                summary: { total: filePaths.length, imported: 0, skipped: filePaths.length },
            };
        }

        conflictMode = conflictDecision.response === 1 ? 'copy' : 'overwrite';
    }

    const reservedIds = new Set(songPathById.keys());
    let importedCount = 0;

    for (const candidate of candidates) {
        if (!candidate.ok) {
            results.push(candidate);
            continue;
        }

        let nextSong = candidate.song;
        let targetPath = candidate.targetPath;

        if (candidate.batchConflict && conflictMode === 'copy') {
            nextSong = createImportedSongCopyWithReservedIds(candidate.song, candidate.filePath, reservedIds);
            targetPath = getSongPathForId(nextSong.id);
        } else {
            reservedIds.add(nextSong.id);
        }

        fileController.writeFile(targetPath, nextSong);
        songPathById.set(nextSong.id, targetPath);
        importedCount += 1;

        results.push({
            ok: true,
            status: candidate.batchConflict ? (conflictMode === 'copy' ? 'copied' : 'updated') : 'imported',
            filePath: candidate.filePath,
            targetPath,
            songId: nextSong.id,
        });
    }

    if (importedCount > 0) {
        refreshLibraryState();
        notifyLibraryChanged();
    }

    return {
        ok: true,
        results,
        summary: {
            total: results.length,
            imported: importedCount,
            skipped: results.length - importedCount,
        },
    };
};

const summarizeImportResults = (results) => {
    const imported = results.filter((result) => result.ok).length;
    const skipped = results.length - imported;
    const skippedDetails = results
        .filter((result) => !result.ok)
        .map((result) => {
            if (result.reason === 'validation-failed') {
                return `${path.basename(result.filePath)}: invalid song schema`;
            }

            if (result.reason === 'invalid-json') {
                return `${path.basename(result.filePath)}: invalid JSON`;
            }

            if (result.reason === 'cancelled') {
                return `${path.basename(result.filePath)}: cancelled`;
            }

            return `${path.basename(result.filePath)}: skipped`;
        });

    return {
        imported,
        skipped,
        details: skippedDetails,
    };
};

const ensureLibraryDataLoaded = () => {
    if (libraryState) {
        return;
    }

    libraryState = libraryController.buildLibraryState(appDataPaths.library);
};

const resolveFavoriteSongRef = (songRef) => {
    if (!libraryState) {
        return null;
    }

    const songId = typeof songRef === 'string'
        ? songRef
        : songRef && typeof songRef.id === 'string'
            ? songRef.id
            : '';

    if (!songId) {
        return null;
    }

    const song = libraryState.songsById.get(songId);

    if (!song) {
        return null;
    }

    return {
        id: song.id,
        path: song.path,
        name: song.name,
        displayName: typeof songRef === 'object' && songRef && typeof songRef.displayName === 'string'
            ? songRef.displayName
            : '',
    };
};

const loadFavorites = () => {
    const favorites = readJsonFile(appDataPaths.favorites, []);

    if (!Array.isArray(favorites)) {
        return [];
    }

    return favorites
        .map((favorite) => {
            const safeFavorite = favorite && typeof favorite === 'object' ? favorite : {};

            if (Array.isArray(safeFavorite.songs)) {
                return {
                    ...safeFavorite,
                    songs: safeFavorite.songs
                        .map(resolveFavoriteSongRef)
                        .filter(Boolean),
                };
            }

            if (typeof safeFavorite.id === 'string') {
                const song = resolveFavoriteSongRef(safeFavorite);

                return song ? { ...safeFavorite, ...song } : null;
            }

            return safeFavorite;
        })
        .filter(Boolean);
};

const saveFavorites = (favorites) => {
    if (!Array.isArray(favorites)) {
        return { ok: false, error: 'Favorites data was invalid.' };
    }

    try {
        saveJsonFile(appDataPaths.favorites, favorites);
        return { ok: true };
    } catch (error) {
        console.error('Error saving favorites:', error);
        return { ok: false, error: error?.message || 'Unknown error saving favorites.' };
    }
};

const showFavoritesContextMenu = (window) => {
    return new Promise((resolve) => {
        let resolved = false;

        const finish = (action) => {
            if (resolved) {
                return;
            }

            resolved = true;
            resolve(action);
        };

        const menu = Menu.buildFromTemplate([
            {
                label: 'Rename',
                click: () => finish('rename'),
            },
            {
                label: 'Delete',
                click: () => finish('delete'),
            },
        ]);

        menu.popup({
            window,
            callback: () => finish(null),
        });
    });
};

const showSongContextMenu = (window, songPath) => {
    return new Promise((resolve) => {
        let resolved = false;

        const finish = (action) => {
            if (resolved) {
                return;
            }

            resolved = true;
            resolve(action);
        };

        const menu = Menu.buildFromTemplate([
            {
                label: 'Export JSON',
                click: async () => {
                    try {
                        await exportSongJson(window, songPath);
                    } catch (error) {
                        console.error('Error exporting song', error);
                        await dialog.showMessageBox(window, {
                            type: 'error',
                            buttons: ['OK'],
                            title: 'Export failed',
                            message: error?.message || 'Unable to export song.',
                        });
                    } finally {
                        finish('export-json');
                    }
                },
            },
        ]);

        menu.popup({
            window,
            callback: () => finish(null),
        });
    });
};

const showFavoriteSongContextMenu = (window) => {
    return new Promise((resolve) => {
        let resolved = false;

        const finish = (action) => {
            if (resolved) {
                return;
            }

            resolved = true;
            resolve(action);
        };

        const menu = Menu.buildFromTemplate([
            {
                label: 'Delete from Favorites',
                click: () => finish('delete'),
            },
        ]);

        menu.popup({
            window,
            callback: () => finish(null),
        });
    });
};

const showImportDialog = async (window, properties) => {
    return dialog.showOpenDialog(window, {
        properties,
        filters: [{ name: 'JSON', extensions: ['json'] }],
    });
};

const handleImportSelection = async (window, selectedPaths) => {
    try {
        const importPaths = expandImportSelection(selectedPaths);

        if (importPaths.length === 0) {
            await dialog.showMessageBox(window, {
                type: 'info',
                buttons: ['OK'],
                title: 'Import complete',
                message: 'No JSON song files were found in the selected location(s).',
            });

            return { ok: true, imported: 0, results: [], summary: { total: 0, imported: 0, skipped: 0 } };
        }

        const importResult = await importSongsFromFiles(window, importPaths);
        const summary = summarizeImportResults(importResult.results);

        await dialog.showMessageBox(window, {
            type: 'info',
            buttons: ['OK'],
            title: 'Import complete',
            message: `Imported ${summary.imported} of ${importResult.summary.total} file(s).`,
            detail: summary.details.length > 0 ? summary.details.join('\n') : undefined,
        });

        return importResult;
    } catch (error) {
        console.error('Error importing songs', error);
        await dialog.showMessageBox(window, {
            type: 'error',
            buttons: ['OK'],
            title: 'Import failed',
            message: error?.message || 'Unable to import songs.',
        });

        return { ok: false, error: error?.message || 'Unable to import songs.' };
    }
};

const handleImportSongs = async (window) => {
    try {
        const result = await showImportDialog(window, isMac
            ? ['openFile', 'openDirectory', 'multiSelections']
            : ['openFile', 'multiSelections']);

        if (result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) {
            return { ok: true, canceled: true };
        }

        return handleImportSelection(window, result.filePaths);
    } catch (error) {
        console.error('Error importing songs', error);
        await dialog.showMessageBox(window, {
            type: 'error',
            buttons: ['OK'],
            title: 'Import failed',
            message: error?.message || 'Unable to import songs.',
        });

        return { ok: false, error: error?.message || 'Unable to import songs.' };
    }
};

const handleImportSongFolder = async (window) => {
    try {
        const result = await showImportDialog(window, ['openDirectory', 'multiSelections']);

        if (result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) {
            return { ok: true, canceled: true };
        }

        return handleImportSelection(window, result.filePaths);
    } catch (error) {
        console.error('Error importing song folders', error);
        await dialog.showMessageBox(window, {
            type: 'error',
            buttons: ['OK'],
            title: 'Import failed',
            message: error?.message || 'Unable to import song folders.',
        });

        return { ok: false, error: error?.message || 'Unable to import song folders.' };
    }
};

const handleExportCurrentSong = async (window) => {
    try {
        const result = await exportSongJson(window, getCurrentSongPath());

        if (!result.ok && !result.canceled) {
            await dialog.showMessageBox(window, {
                type: 'error',
                buttons: ['OK'],
                title: 'Export failed',
                message: result.error || 'Unable to export song.',
            });
        }

        return result;
    } catch (error) {
        console.error('Error exporting song', error);
        await dialog.showMessageBox(window, {
            type: 'error',
            buttons: ['OK'],
            title: 'Export failed',
            message: error?.message || 'Unable to export song.',
        });

        return { ok: false, error: error?.message || 'Unable to export song.' };
    }
};

const handleExportLibraryZip = async (window) => {
    try {
        const result = await exportLibraryZip(window);

        if (!result.ok && !result.canceled) {
            await dialog.showMessageBox(window, {
                type: 'error',
                buttons: ['OK'],
                title: 'Export failed',
                message: result.error || 'Unable to export library.',
            });
        }

        return result;
    } catch (error) {
        console.error('Error exporting library', error);
        await dialog.showMessageBox(window, {
            type: 'error',
            buttons: ['OK'],
            title: 'Export failed',
            message: error?.message || 'Unable to export library.',
        });

        return { ok: false, error: error?.message || 'Unable to export library.' };
    }
};

const createMainWindow = () => {
    mainWindow = new BrowserWindow({
        width: isDev ? 1600 : 800,
        height: 600,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            preload: path.join(__dirname, 'preload.js')
        }
    })

    setApplicationMenuForVerseCount();

    if (isDev) {
        mainWindow.webContents.openDevTools();
    }
    mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));

    mainWindow.webContents.on('did-finish-load', () => {
        ensureLibraryDataLoaded();
    });

}

const navigateMainWindow = (routeName) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }

    const route = routeName === 'settings' ? 'settings' : 'library';
    mainWindow.webContents.executeJavaScript(`window.location.hash = ${JSON.stringify(`#${route}`)}`);
};

const createProjectorWindow = () => {
    let externalDisplay = null;
    const displays = screen.getAllDisplays();

    for (const display of displays) {
      if (display.bounds.x !== 0 || display.bounds.y !== 0) {
        externalDisplay = display;
        break;
      }
    }

    const windowOptions = {
        fullscreen: true,
        width: isDev ? 1200 : 800,
        height: 600,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            preload: path.join(__dirname, 'preload.js')
        }
    };

    if (externalDisplay) {
        windowOptions.x = externalDisplay.bounds.x;
        windowOptions.y = externalDisplay.bounds.y;
    }

    projectorWindow = new BrowserWindow(windowOptions);

    projectorWindow.loadFile(path.join(__dirname, 'renderer/projector.html'));

    isProjectionOn = true;

    if (isDev) {
        projectorWindow.webContents.openDevTools();
    }

    projectorWindow.on('close', () => {
        isProjectionOn = false;
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('projection:status', isProjectionOn);
        }
        projectorWindow = null;
    });

    projectorWindow.webContents.on('did-finish-load', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('projection:status', isProjectionOn);
            mainWindow.focus();
        }
    });
}

const loadPreferences = () => {
    return normalizePreferences(readJsonFile(appDataPaths.preferences, DEFAULT_PREFERENCES));
};

const savePreferences = (preferences) => {
    const currentPreferences = loadPreferences();
    const nextPreferences = mergePreferences(currentPreferences, preferences);

    fs.writeFileSync(appDataPaths.preferences, JSON.stringify(nextPreferences, null, 2), 'utf8');

    for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send('preferences:changed', nextPreferences);
    }

    return nextPreferences;
};

// Returns the file path for a given background image filename stored in userData.
const getBackgroundImagePath = (filename) => {
    if (!filename || typeof filename !== 'string') {
        return null;
    }
    // Only allow simple filenames (no path separators) to prevent traversal.
    const base = path.basename(filename);
    return path.join(appDataPaths.baseDir, base);
};

// Removes any existing background image file whose name starts with 'background-image.'
// from userData, except for the one we are about to write (excludeFilename).
const cleanOldBackgroundImages = (excludeFilename = null) => {
    try {
        const entries = fs.readdirSync(appDataPaths.baseDir);
        for (const entry of entries) {
            if (!entry.startsWith('background-image.')) {
                continue;
            }
            if (excludeFilename && entry === excludeFilename) {
                continue;
            }
            try {
                fs.unlinkSync(path.join(appDataPaths.baseDir, entry));
            } catch (err) {
                console.warn(`Failed to delete old background image: ${entry}`, err);
            }
        }
    } catch (err) {
        console.warn('Failed to clean old background images', err);
    }
};

const setBackgroundImage = (sourcePath, ext) => {
    if (!sourcePath || !ext) {
        throw new Error('Invalid source path or extension');
    }

    // Normalise extension: strip leading dot, lowercase, allow only safe chars.
    const safeExt = String(ext).toLowerCase().replace(/^\./, '').replace(/[^a-z0-9]/g, '');
    if (!safeExt) {
        throw new Error('Invalid image extension');
    }

    const filename = `background-image.${safeExt}`;
    const destPath = path.join(appDataPaths.baseDir, filename);

    // Copy source file to userData, then clean up old differently-named files.
    fs.copyFileSync(sourcePath, destPath);
    cleanOldBackgroundImages(filename);

    return savePreferences({ backgroundImage: filename });
};

const removeBackgroundImage = () => {
    cleanOldBackgroundImages(null);
    return savePreferences({ backgroundImage: null });
};

const restoreDefaultPreferences = () => {
    // Also remove the background image file when restoring defaults.
    cleanOldBackgroundImages(null);
    return savePreferences(DEFAULT_PREFERENCES);
};

const createApplicationMenuTemplate = (verseCount = 0) => {
    const count = Number.isFinite(verseCount) ? Math.min(verseCount, 9) : 0;
    const verseItems = Array.from({ length: count }, (_, index) => {
        const verseNumber = index + 1;

        return {
            label: `Verse ${verseNumber}`,
            click: () => {
                mainWindow.webContents.send('verse:change', index);
            },
            accelerator: `CmdOrCtrl+${verseNumber}`,
        };
    });

    return [
        {
          label: 'File',
          submenu: [
            ...(isMac ? [{
              label: 'Import Songs...',
              click: () => {
                handleImportSongs(mainWindow).catch((error) => {
                    console.error('Error importing songs', error);
                });
              },
            }] : [
              {
                label: 'Import Songs...',
                click: () => {
                  handleImportSongs(mainWindow).catch((error) => {
                      console.error('Error importing songs', error);
                  });
                },
              },
              {
                label: 'Import Song Folder...',
                click: () => {
                  handleImportSongFolder(mainWindow).catch((error) => {
                      console.error('Error importing song folders', error);
                  });
                },
              },
            ]),
            {
              label: 'New Song...',
              click: () => {
                mainWindow.webContents.send('song:new');
              },
              accelerator: 'CmdOrCtrl+N',
            },
            {
              label: 'Export Current Song JSON',
              click: () => {
                handleExportCurrentSong(mainWindow).catch((error) => {
                    console.error('Error exporting song', error);
                });
              },
            },
            {
              label: 'Export Library as Zip',
              click: () => {
                handleExportLibraryZip(mainWindow).catch((error) => {
                    console.error('Error exporting library', error);
                });
              },
            },
            { type: 'separator' },
            {
              label: 'Preferences',
              click: () => {
                navigateMainWindow('settings');
              },
              accelerator: 'CmdOrCtrl+,',
            },
            { type: 'separator' },
            {
              label: 'Quit',
              click: () => { app.quit(); },
              accelerator: 'CmdOrCtrl+Q'
            }
          ]
        },
        {
          label: 'Edit',
          submenu: [
            {
              label: 'Edit song...',
              accelerator: 'CmdOrCtrl+E',
              click: () => {
                mainWindow.webContents.send('song:edit');
              },
            },
            { type: 'separator' },
            { role: 'undo' },
            { role: 'redo' },
            { type: 'separator' },
            { role: 'cut' },
            { role: 'copy' },
            { role: 'paste' }
          ]
        },
        {
            label: 'Controls',
            submenu: [
                { 
                    label: 'Start/stop projection',
                    click: () => {     
                        if (!isProjectionOn) {
                            createProjectorWindow();
                        } else {
                            projectorWindow.close();
                        }
                    },
                    accelerator: 'CmdOrCtrl+P'
                },
                {
                    label: 'Next verse',
                    click: () => { mainWindow.webContents.send('projection:next'); },
                    accelerator: 'n'
                },
                {
                    label: 'Next verse',
                    click: () => { mainWindow.webContents.send('projection:next'); },
                    visible: false,
                    acceleratorWorksWhenHidden: true,
                    accelerator: 'Right'
                },
                {
                    label: 'Previous verse',
                    click: () => { mainWindow.webContents.send('projection:prev'); },
                    accelerator: 'p'
                },
                {
                    label: 'Previous verse',
                    visible: false,
                    acceleratorWorksWhenHidden: true,
                    click: () => { mainWindow.webContents.send('projection:prev'); },
                    accelerator: 'Left'
                },
                {
                    label: 'Chorus',
                    click: () => { mainWindow.webContents.send('projection:chorus'); },
                    accelerator: 'r'
                },
                {
                    label: 'Black screen',
                    click: () => { 
                        if (isProjectionOn) {
                            projectorWindow?.webContents.send('black-screen');
                        }
                        mainWindow.webContents.send('black-screen'); 
                    },
                    accelerator: 'b'
                },
                ...(verseItems.length ? [{ type: 'separator' }, ...verseItems] : []),
            ]
        }
    ];
}

const setApplicationMenuForVerseCount = (verseCount = 0) => {
    Menu.setApplicationMenu(Menu.buildFromTemplate(createApplicationMenuTemplate(verseCount)));
};

const registerShortcuts = (verseCount) => {
    lastVerseCount = verseCount;
    setApplicationMenuForVerseCount(verseCount);
};

const unregisterShortcuts = (verseCount) => {
    lastVerseCount = verseCount;
    setApplicationMenuForVerseCount(0);
};

ipcMain.on('projection:toggle', () => {
    if (!isProjectionOn) {
        // Status is sent to all windows by the did-finish-load handler once the projector is ready.
        createProjectorWindow();
    } else {
        // Status is sent to all windows by the close handler once the projector closes.
        projectorWindow.close();
    }
})

ipcMain.on('display-lyrics', (event, lyrics) => {
    if (isProjectionOn) {
      projectorWindow.webContents.send('display-lyrics', lyrics);
    }
  });

ipcMain.on('black-screen', () => {
    if (isProjectionOn) {
      projectorWindow.webContents.send('black-screen');
    }
  });

ipcMain.handle('favorites:context-menu', async (event, item) => {
    const window = BrowserWindow.fromWebContents(event.sender);

    if (!window) {
        return null;
    }

    if (item?.kind === 'song') {
        return showFavoriteSongContextMenu(window);
    }

    return showFavoritesContextMenu(window);
});

ipcMain.handle('song:context-menu', async (event, songPath) => {
    const window = BrowserWindow.fromWebContents(event.sender);

    if (!window || !songPath) {
        return null;
    }

    return showSongContextMenu(window, songPath);
});

ipcMain.handle('favorites:update', (event, favorites) => {
    return saveFavorites(favorites);
});
  
app.whenReady().then(() => {
    appDataPaths = bootstrapAppData();

    // Serve files from userData under the beamee-asset:// scheme.
    // This lets the renderer and projector load the background image securely
    // without exposing arbitrary file:// paths.
    protocol.handle('beamee-asset', (request) => {
        const url = new URL(request.url);
        // url.hostname is the filename; url.pathname is '/' for simple names.
        const filename = decodeURIComponent(url.hostname + url.pathname).replace(/^\//, '');
        const filePath = path.join(appDataPaths.baseDir, path.basename(filename));
        return net.fetch(`file://${filePath}`);
    });

    createMainWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    })
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('save-preferences', (event, preferences) => {
    try {
        return savePreferences(preferences);
    } catch (error) {
        console.error('Error saving preferences', error);
        throw error;
    }
});

ipcMain.handle('preferences:pick-background-image', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const { canceled, filePaths } = await dialog.showOpenDialog(window, {
        title: 'Choose background image',
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] }],
    });

    if (canceled || !filePaths.length) {
        return null;
    }

    const sourcePath = filePaths[0];
    const ext = path.extname(sourcePath).replace(/^\./, '') || 'jpg';

    try {
        return setBackgroundImage(sourcePath, ext);
    } catch (error) {
        console.error('Error setting background image', error);
        throw error;
    }
});

ipcMain.handle('preferences:set-background-image', (event, { sourcePath, ext } = {}) => {
    try {
        return setBackgroundImage(sourcePath, ext);
    } catch (error) {
        console.error('Error setting background image', error);
        throw error;
    }
});

ipcMain.handle('preferences:remove-background-image', () => {
    try {
        return removeBackgroundImage();
    } catch (error) {
        console.error('Error removing background image', error);
        throw error;
    }
});

ipcMain.handle('restore-preferences', () => {
    try {
        return restoreDefaultPreferences();
    } catch (error) {
        console.error('Error restoring preferences', error);
        throw error;
    }
});

ipcMain.handle('get-preferences', () => {
    return loadPreferences();
});

ipcMain.handle('library:state', () => {
    ensureLibraryDataLoaded();

    return {
        library: libraryState?.tree || [],
        favorites: loadFavorites(),
    };
});

ipcMain.handle('song:save', async (event, payload = {}) => {
    try {
        return await saveSongDraft(BrowserWindow.fromWebContents(event.sender) || mainWindow, payload.song, payload.targetPath, Boolean(payload.isNew));
    } catch (error) {
        console.error('Error saving song draft', error);
        return { ok: false, error: error?.message || 'Unable to save song.' };
    }
});

ipcMain.handle('editor:prompt-song-switch', async () => {
    const result = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: ['Discard', 'Save', 'Cancel'],
        defaultId: 1,
        cancelId: 2,
        title: 'Unsaved changes',
        message: 'This song has unsaved changes.',
        detail: 'Do you want to discard them, save them, or stay in the editor?',
        noLink: true,
    });

    return result.response;
});

ipcMain.handle('projection:is-on', () => {
    return isProjectionOn;
});

ipcMain.on('song:selected', (event, songPath) => {
    currentSongPath = typeof songPath === 'string' && songPath.trim() ? songPath : null;
});

ipcMain.on('song:loaded', (event, verseCount) => {
    unregisterShortcuts(lastVerseCount);
    registerShortcuts(verseCount);
});

ipcMain.handle('open-external-url', (event, url) => {
    shell.openExternal(url);
});
