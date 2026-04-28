const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, Menu, ipcMain, screen, dialog, shell, protocol, net } = require('electron');
const archiver = require('archiver');
const { autoUpdater } = require('electron-updater');

const libraryController = require('./assets/js/libraryController.js');
const fileController = require('./assets/js/fileController.js');
const songSchema = require('./assets/js/songSchema.js');
const { DEFAULT_PREFERENCES, mergePreferences, normalizePreferences } = require('./assets/js/preferencesStore.js');
const { getTranslator } = require('./assets/js/mainTranslations.js');

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
let isManualUpdateCheck = false;

// --- Auto-updater configuration ---
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

// In dev mode electron-builder doesn't embed app-update.yml into resources,
// so point the updater at the dev-app-update.yml file in the project root.
if (isDev) {
    autoUpdater.forceDevUpdateConfig = true;
}

// Forward all updater events to the renderer so the settings UI can react.
const forwardUpdaterEvents = () => {
    autoUpdater.on('checking-for-update', () => {
        mainWindow?.webContents.send('updater:status', { event: 'checking' });
    });
    autoUpdater.on('update-not-available', () => {
        mainWindow?.webContents.send('updater:status', { event: 'not-available' });
        if (isManualUpdateCheck) {
            isManualUpdateCheck = false;
            dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'No update available',
                message: "You're up to date.",
                detail: `Beamee ${app.getVersion()} is the latest version.`,
                buttons: ['OK'],
            });
        }
    });
    autoUpdater.on('update-available', (info) => {
        mainWindow?.webContents.send('updater:status', { event: 'available', version: info.version });
    });
    autoUpdater.on('download-progress', (progress) => {
        mainWindow?.webContents.send('updater:status', { event: 'progress', percent: Math.floor(progress.percent) });
    });
    autoUpdater.on('update-downloaded', () => {
        mainWindow?.webContents.send('updater:status', { event: 'downloaded' });
        showRestartDialog();
    });
    autoUpdater.on('error', (err) => {
        mainWindow?.webContents.send('updater:status', { event: 'error', message: err?.message || 'Unknown error' });
    });
};

const showRestartDialog = async () => {
    const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update ready',
        message: 'Update downloaded.',
        detail: 'Restart Beamee now to apply the update?',
        buttons: ['Restart now', 'Later'],
        defaultId: 0,
        cancelId: 1,
    });
    if (response === 0) {
        autoUpdater.quitAndInstall();
    }
};

// Startup update check: fires once the main window is fully loaded.
// Attaches scoped once-listeners so they never interfere with manual checks.
const performStartupUpdateCheck = async () => {
    try {
        autoUpdater.once('update-available', async (info) => {
            const { response } = await dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'Update available',
                message: `Beamee ${info.version} is available.`,
                detail: 'Would you like to download and install it now?',
                buttons: ['Download & Install', 'Later'],
                defaultId: 0,
                cancelId: 1,
            });
            if (response === 0) {
                autoUpdater.downloadUpdate();
                autoUpdater.once('update-downloaded', () => {
                    showRestartDialog();
                });
            }
        });

        await autoUpdater.checkForUpdates();
    } catch (err) {
        console.error('Startup update check failed:', err);
    }
};
// --- End auto-updater configuration ---

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

const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const normalizeFileName = (value, fallback = 'song') => {
    const name = String(value ?? '').trim();

    if (!name) {
        return fallback;
    }

    return name.replace(/[<>:"|?*\\/]+/g, '-');
};

const getSongCollectionForExport = (song, sourceCollectionId = '', sourceCollectionName = '') => {
    if (!song || !Array.isArray(song.collections) || song.collections.length === 0) {
        return null;
    }

    const collectionId = typeof sourceCollectionId === 'string' ? sourceCollectionId.trim() : '';
    const collectionName = typeof sourceCollectionName === 'string' ? sourceCollectionName.trim() : '';

    if (collectionId) {
        const match = song.collections.find((collection) => collection?.collectionId === collectionId);

        if (match) {
            return match;
        }
    }

    if (collectionName) {
        const match = song.collections.find((collection) => typeof collection?.name === 'string' && collection.name.trim() === collectionName);

        if (match) {
            return match;
        }
    }

    return song.collections.find((collection) => collection && typeof collection.collectionId === 'string') || null;
};

const formatCollectionHeader = (collection) => {
    if (!collection) {
        return '';
    }

    const name = typeof collection.name === 'string' && collection.name.trim()
        ? collection.name.trim()
        : typeof collection.collectionId === 'string' && collection.collectionId.trim()
            ? collection.collectionId.trim()
            : 'Collection';

    const number = Number.isInteger(collection.number) && collection.number > 0
        ? ` #${collection.number}`
        : '';

    return `${name}${number}`;
};

const getPdfSectionLabel = (sectionType, t) => {
    const key = `sectionType.${typeof sectionType === 'string' && sectionType.trim() ? sectionType.trim() : 'other'}`;
    return t(key);
};

const expandSongForPdf = (songData, useArrangement = true, t = (key) => key) => {
    if (!songData || !Array.isArray(songData.sections)) {
        return [];
    }

    const sectionsById = new Map(
        songData.sections
            .filter((section) => section && typeof section.id === 'string')
            .map((section) => [section.id, section])
    );

    if (!useArrangement || !Array.isArray(songData.arrangement) || songData.arrangement.length === 0) {
        const counts = new Map();

        return songData.sections
            .filter((section) => section && typeof section.id === 'string')
            .map((section) => ({
                heading: (() => {
                    const customTitle = typeof section.title === 'string' && section.title.trim() ? section.title.trim() : '';

                    if (customTitle) {
                        return customTitle;
                    }

                    const typeKey = typeof section.type === 'string' && section.type.trim() ? section.type.trim() : 'other';
                    const nextCount = (counts.get(typeKey) || 0) + 1;
                    counts.set(typeKey, nextCount);
                    return `${getPdfSectionLabel(typeKey, t)} ${nextCount}`;
                })(),
                text: Array.isArray(section.lines) ? section.lines.join('\n') : '',
            }));
    }

    const counts = new Map();

    return songData.arrangement
        .map((step) => {
            const section = sectionsById.get(step?.sectionId);

            if (!section) {
                return null;
            }

            const customTitle = typeof section.title === 'string' && section.title.trim() ? section.title.trim() : '';
            const typeKey = typeof section.type === 'string' && section.type.trim() ? section.type.trim() : 'other';

            let heading = customTitle;

            if (!heading) {
                const nextCount = (counts.get(typeKey) || 0) + 1;
                counts.set(typeKey, nextCount);
                heading = `${getPdfSectionLabel(typeKey, t)} ${nextCount}`;
            }

            return {
                heading,
                text: Array.isArray(section.lines) ? section.lines.join('\n') : '',
            };
        })
        .filter(Boolean);
};

const buildSongPdfHtml = (song, collection, blocks, lang = 'en') => {
    const header = formatCollectionHeader(collection);
    const body = Array.isArray(blocks) ? blocks.map((block) => `
            <section class="section">
              <h2>${escapeHtml(block.heading)}</h2>
              <div class="lyrics">${escapeHtml(block.text)}</div>
            </section>`).join('') : '';

    return `<!doctype html>
<html lang="${escapeHtml(lang || 'en')}">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(song?.name || 'Song')}</title>
    <style>
      @page {
        size: A4;
        margin: 18mm;
      }

      :root {
        color-scheme: light;
      }

      html, body {
        margin: 0;
        padding: 0;
        background: #ffffff;
        color: #111111;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 12pt;
        line-height: 1.45;
      }

      body {
        padding: 0;
      }

      .page {
        width: 100%;
      }

      .header {
        margin-bottom: 16px;
        padding-bottom: 12px;
        border-bottom: 1px solid #d0d0d0;
      }

      h1, h2, p {
        margin: 0;
      }

      h1 {
        font-size: 20pt;
        line-height: 1.2;
        margin-bottom: 4px;
      }

      .collection {
        font-size: 11pt;
        color: #555555;
      }

      .section {
        margin: 0 0 14px;
        break-inside: avoid;
        page-break-inside: avoid;
      }

      .section h2 {
        font-size: 12pt;
        margin-bottom: 4px;
      }

      .lyrics {
        white-space: pre-wrap;
      }
    </style>
  </head>
  <body>
    <main class="page">
      <header class="header">
        <h1>${escapeHtml(song?.name || 'Song')}</h1>
        ${header ? `<p class="collection">${escapeHtml(header)}</p>` : ''}
      </header>
      ${body}
    </main>
  </body>
</html>`;
};

const exportSongPdf = async (window, songPath, { collectionId = '', collectionName = '' } = {}) => {
    if (!songPath) {
        return { ok: false, error: 'No song is selected.' };
    }

    const song = fileController.readFile(songPath);

    if (!song || typeof song !== 'object') {
        return { ok: false, error: 'Selected song could not be read.' };
    }

    const t = getTranslator(getAppLanguage());
    const { response, checkboxChecked } = await dialog.showMessageBox(window, {
        type: 'question',
        buttons: [t('dialog.exportPdf.export'), t('dialog.exportPdf.cancel')],
        defaultId: 0,
        cancelId: 1,
        title: t('dialog.exportPdf.title'),
        message: t('dialog.exportPdf.message'),
        checkboxLabel: t('dialog.exportPdf.useArrangement'),
        checkboxChecked: true,
        noLink: true,
    });

    if (response !== 0) {
        return { ok: true, canceled: true };
    }

    const useArrangement = Boolean(checkboxChecked);
    const normalizedSong = songSchema.normalizeSong(song, { sourcePath: songPath });
    const collection = getSongCollectionForExport(normalizedSong, collectionId, collectionName);
    const defaultName = `${normalizeFileName(normalizedSong.name || path.basename(songPath, path.extname(songPath)), 'song')}.pdf`;
    const { canceled, filePath } = await dialog.showSaveDialog(window, {
        defaultPath: defaultName,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });

    if (canceled || !filePath) {
        return { ok: true, canceled: true };
    }

    const lang = getAppLanguage();
    const tPdf = getTranslator(lang);
    const blocks = expandSongForPdf(normalizedSong, useArrangement, tPdf);
    const html = buildSongPdfHtml(normalizedSong, collection, blocks, lang);
    const pdfWindow = new BrowserWindow({
        show: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
        },
    });

    try {
        await pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
        const pdfBuffer = await pdfWindow.webContents.printToPDF({
            printBackground: true,
            preferCSSPageSize: true,
        });

        fs.writeFileSync(filePath, pdfBuffer);
        return { ok: true, filePath };
    } finally {
        if (!pdfWindow.isDestroyed()) {
            pdfWindow.destroy();
        }
    }
};

const isMac = process.platform === 'darwin';
const windowIcon = process.platform === 'win32'
    ? path.join(__dirname, 'renderer', 'img', 'beamee-icon.ico')
    : undefined;

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

    return exportSongFilesZip(window, filePath, songFiles);
};

const normalizeArchiveFolderName = (value) => {
    const name = String(value ?? '').trim();

    if (!name) {
        return 'collection';
    }

    return name.replace(/[<>:"|?*\\/]+/g, '-');
};

const exportSongFilesZip = async (window, filePath, songFiles, topLevelFolderName = null) => {
    const entries = Array.isArray(songFiles) ? songFiles : [];

    await new Promise((resolve, reject) => {
        const output = fs.createWriteStream(filePath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', resolve);
        output.on('error', reject);
        archive.on('error', reject);

        archive.pipe(output);

        entries.forEach((entry) => {
            const archivePath = topLevelFolderName
                ? path.posix.join(topLevelFolderName, entry.relativePath)
                : entry.relativePath;

            archive.file(entry.path, { name: archivePath });
        });

        archive.finalize();
    });

    return { ok: true, filePath, count: entries.length };
};

const exportCollectionZip = async (window, collectionId, collectionName) => {
    ensureLibraryDataLoaded();

    const songFiles = Array.from(libraryState?.songsById?.values() || [])
        .filter((song) => Array.isArray(song?.collections) && song.collections.some((collection) => collection?.collectionId === collectionId))
        .map((song) => ({
            path: song.path,
            relativePath: path.relative(appDataPaths.library, song.path).split(path.sep).join('/'),
        }))
        .filter((entry) => entry.path && entry.relativePath && !entry.relativePath.startsWith('..'));

    if (songFiles.length === 0) {
        return { ok: false, error: 'No songs were found for that collection.' };
    }

    const defaultFolderName = normalizeArchiveFolderName(collectionName || collectionId || 'collection');
    const { canceled, filePath } = await dialog.showSaveDialog(window, {
        defaultPath: `${defaultFolderName}.zip`,
        filters: [{ name: 'Zip archive', extensions: ['zip'] }],
    });

    if (canceled || !filePath) {
        return { ok: true, canceled: true };
    }

    return exportSongFilesZip(window, filePath, songFiles, defaultFolderName);
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

const favoriteContainsSongId = (favorites, songId) => {
    const walk = (items) => {
        for (const item of Array.isArray(items) ? items : []) {
            if (!item || typeof item !== 'object') {
                continue;
            }

            if (item.id === songId) {
                return true;
            }

            if (Array.isArray(item.songs) && walk(item.songs)) {
                return true;
            }
        }

        return false;
    };

    return walk(favorites);
};

const addSongToFavorites = (songPath) => {
    ensureLibraryDataLoaded();

    const song = fileController.readFile(songPath);

    if (!song || typeof song !== 'object' || typeof song.id !== 'string') {
        return { ok: false, error: 'Selected song could not be read.' };
    }

    const favorites = loadFavorites();

    const nextFavorites = [
        {
            id: song.id,
            path: songPath,
            name: song.name,
        },
        ...favorites,
    ];

    const result = saveFavorites(nextFavorites);

    if (result.ok) {
        notifyLibraryChanged();
    }

    return {
        ok: result.ok,
        added: result.ok,
        error: result.error,
    };
};

const pruneFavoritesForDeletedSongs = (favorites, deletedSongIds) => {
    const pruneItem = (item) => {
        if (!item || typeof item !== 'object') {
            return null;
        }

        if (Array.isArray(item.songs)) {
            return {
                ...item,
                songs: item.songs.map(pruneItem).filter(Boolean),
            };
        }

        if (typeof item.id === 'string' && deletedSongIds.has(item.id)) {
            return null;
        }

        return item;
    };

    return Array.isArray(favorites) ? favorites.map(pruneItem).filter(Boolean) : [];
};

const persistFavoritesAfterSongDeletion = (deletedSongIds) => {
    const favorites = loadFavorites();
    const cleanedFavorites = pruneFavoritesForDeletedSongs(favorites, deletedSongIds);
    const result = saveFavorites(cleanedFavorites);

    return {
        ok: result.ok,
        error: result.error,
        favorites: cleanedFavorites,
    };
};

const deleteSongFile = (songPath) => {
    if (!songPath || !fs.existsSync(songPath)) {
        return false;
    }

    fs.unlinkSync(songPath);
    return true;
};

const removeCollectionFromSong = (song, collectionId) => {
    const collections = Array.isArray(song.collections) ? song.collections : [];
    const nextCollections = collections.filter((collection) => collection?.collectionId !== collectionId);

    return {
        ...song,
        collections: nextCollections,
    };
};

const deleteSongByPath = (songPath) => {
    ensureLibraryDataLoaded();

    const song = fileController.readFile(songPath);

    if (!song || typeof song !== 'object' || typeof song.id !== 'string') {
        return { ok: false, error: 'Selected song could not be read.' };
    }

    deleteSongFile(songPath);
    const favoritesResult = persistFavoritesAfterSongDeletion(new Set([song.id]));
    refreshLibraryState();
    notifyLibraryChanged();

    return favoritesResult.ok
        ? { ok: true }
        : { ok: false, error: favoritesResult.error || 'Unable to update favorites.' };
};

const deleteCollectionById = (collectionId) => {
    ensureLibraryDataLoaded();

    const songsInCollection = Array.from(libraryState?.songsById?.values() || []).filter((song) => (
        Array.isArray(song?.collections)
        && song.collections.some((collection) => collection?.collectionId === collectionId)
    ));

    if (songsInCollection.length === 0) {
        return { ok: false, error: 'Selected collection could not be found.' };
    }

    const deletedSongIds = new Set();

    songsInCollection.forEach((song) => {
        const nextCollections = Array.isArray(song.collections)
            ? song.collections.filter((collection) => collection?.collectionId !== collectionId)
            : [];

        if (nextCollections.length === 0) {
            deleteSongFile(song.path);
            deletedSongIds.add(song.id);
            return;
        }

        fileController.writeFile(song.path, removeCollectionFromSong(song, collectionId));
    });

    const favoritesResult = deletedSongIds.size > 0
        ? persistFavoritesAfterSongDeletion(deletedSongIds)
        : { ok: true };

    refreshLibraryState();
    notifyLibraryChanged();

    return {
        ok: favoritesResult.ok,
        error: favoritesResult.error,
        deletedCount: deletedSongIds.size,
        updatedCount: songsInCollection.length - deletedSongIds.size,
    };
};

const showFavoritesContextMenu = (window) => {
    const t = getTranslator(getAppLanguage());
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
                label: t('contextMenu.rename'),
                click: () => finish('rename'),
            },
            {
                label: t('contextMenu.delete'),
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
    const t = getTranslator(getAppLanguage());
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
                label: t('contextMenu.addToFavorites'),
                click: () => finish('add-favorite'),
            },
            {
                label: t('contextMenu.exportJson'),
                click: () => finish('export-json'),
            },
            {
                label: t('contextMenu.exportPdf'),
                click: () => finish('export-pdf'),
            },
            {
                label: t('contextMenu.deleteSong'),
                click: () => finish('delete'),
            },
        ]);

        menu.popup({
            window,
            callback: () => finish(null),
        });
    });
};

const showCollectionContextMenu = (window) => {
    const t = getTranslator(getAppLanguage());
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
                label: t('contextMenu.exportCollectionZip'),
                click: () => finish('export-zip'),
            },
            {
                label: t('contextMenu.deleteCollection'),
                click: () => finish('delete'),
            },
        ]);

        menu.popup({
            window,
            callback: () => finish(null),
        });
    });
};

const showFavoriteSongContextMenu = (window) => {
    const t = getTranslator(getAppLanguage());
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
                label: t('contextMenu.deleteFromFavorites'),
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

const handleExportCurrentSongPdf = async (window) => {
    try {
        const result = await exportSongPdf(window, getCurrentSongPath());

        if (!result.ok && !result.canceled) {
            await dialog.showMessageBox(window, {
                type: 'error',
                buttons: ['OK'],
                title: 'Export failed',
                message: result.error || 'Unable to export song as PDF.',
            });
        }

        return result;
    } catch (error) {
        console.error('Error exporting song as PDF', error);
        await dialog.showMessageBox(window, {
            type: 'error',
            buttons: ['OK'],
            title: 'Export failed',
            message: error?.message || 'Unable to export song as PDF.',
        });

        return { ok: false, error: error?.message || 'Unable to export song as PDF.' };
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
        icon: windowIcon,
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
        performStartupUpdateCheck();
    });

    mainWindow.on('close', () => {
        if (process.platform !== 'darwin') {
            app.quit();
        }
    });

    // Attach persistent renderer-forwarding listeners once per window lifecycle.
    forwardUpdaterEvents();
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
        icon: windowIcon,
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

/**
 * Resolve the active UI language from preferences + OS locale.
 * Returns 'en' or 'fr' (never 'system').
 */
const getAppLanguage = () => {
    try {
        const prefs = loadPreferences();
        const lang = prefs.language;
        if (lang && lang !== 'system') {
            return lang;
        }
        // 'system': derive from OS locale primary tag
        const tag = app.getLocale().split(/[-_]/)[0].toLowerCase();
        return tag === 'fr' ? 'fr' : 'en';
    } catch (_) {
        return 'en';
    }
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
    const t = getTranslator(getAppLanguage());
    const count = Number.isFinite(verseCount) ? Math.min(verseCount, 9) : 0;
    const verseItems = Array.from({ length: count }, (_, index) => {
        const verseNumber = index + 1;

        return {
            label: t('menu.verse', { n: verseNumber }),
            click: () => {
                mainWindow.webContents.send('verse:change', index);
            },
            accelerator: `CmdOrCtrl+${verseNumber}`,
        };
    });

    return [
        {
          label: t('menu.file'),
          submenu: [
            ...(isMac ? [{
              label: t('menu.importSongs'),
              click: () => {
                handleImportSongs(mainWindow).catch((error) => {
                    console.error('Error importing songs', error);
                });
              },
            }] : [
              {
                label: t('menu.importSongs'),
                click: () => {
                  handleImportSongs(mainWindow).catch((error) => {
                      console.error('Error importing songs', error);
                  });
                },
              },
              {
                label: t('menu.importSongFolder'),
                click: () => {
                  handleImportSongFolder(mainWindow).catch((error) => {
                      console.error('Error importing song folders', error);
                  });
                },
              },
            ]),
            {
              label: t('menu.newSong'),
              click: () => {
                mainWindow.webContents.send('song:new');
              },
              accelerator: 'CmdOrCtrl+N',
            },
            {
              label: t('menu.exportSongJson'),
              click: () => {
                handleExportCurrentSong(mainWindow).catch((error) => {
                    console.error('Error exporting song', error);
                });
              },
            },
            {
              label: t('menu.exportSongPdf'),
              click: () => {
                handleExportCurrentSongPdf(mainWindow).catch((error) => {
                    console.error('Error exporting song as PDF', error);
                });
              },
            },
            {
              label: t('menu.exportLibraryZip'),
              click: () => {
                handleExportLibraryZip(mainWindow).catch((error) => {
                    console.error('Error exporting library', error);
                });
              },
            },
            { type: 'separator' },
            {
              label: t('menu.checkForUpdate'),
              click: async () => {
                // Navigate to the General tab if settings is already open.
                mainWindow.webContents.send('updater:trigger-check');
                try {
                    isManualUpdateCheck = true;
                    await autoUpdater.checkForUpdates();
                } catch (err) {
                    isManualUpdateCheck = false;
                    dialog.showMessageBox(mainWindow, {
                        type: 'error',
                        title: 'Update check failed',
                        message: 'Could not check for updates.',
                        detail: err?.message || 'Unknown error',
                        buttons: ['OK'],
                    });
                }
              },
            },
            {
              label: t('menu.preferences'),
              click: () => {
                navigateMainWindow('settings');
              },
              accelerator: 'CmdOrCtrl+,',
            },
            { type: 'separator' },
            {
              label: t('menu.quit'),
              click: () => { app.quit(); },
              accelerator: 'CmdOrCtrl+Q'
            }
          ]
        },
        {
          label: t('menu.edit'),
          submenu: [
            {
              label: t('menu.editSong'),
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
            label: t('menu.controls'),
            submenu: [
                { 
                    label: t('menu.toggleProjection'),
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
                    label: 'Stop projection',
                    visible: false,
                    acceleratorWorksWhenHidden: true,
                    click: () => {
                        if (isProjectionOn) {
                            projectorWindow.close();
                        }
                    },
                    accelerator: 'Escape'
                },
                {
                    label: t('menu.nextVerse'),
                    click: () => { mainWindow.webContents.send('projection:next'); },
                    accelerator: 'n'
                },
                {
                    label: t('menu.nextVerse'),
                    click: () => { mainWindow.webContents.send('projection:next'); },
                    visible: false,
                    acceleratorWorksWhenHidden: true,
                    accelerator: 'Right'
                },
                {
                    label: t('menu.prevVerse'),
                    click: () => { mainWindow.webContents.send('projection:prev'); },
                    accelerator: 'p'
                },
                {
                    label: t('menu.prevVerse'),
                    visible: false,
                    acceleratorWorksWhenHidden: true,
                    click: () => { mainWindow.webContents.send('projection:prev'); },
                    accelerator: 'Left'
                },
                {
                    label: t('menu.chorus'),
                    click: () => { mainWindow.webContents.send('projection:chorus'); },
                    accelerator: 'r'
                },
                {
                    label: t('menu.blackScreen'),
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

ipcMain.handle('library:context-menu', async (event, item = {}) => {
    const window = BrowserWindow.fromWebContents(event.sender);

    if (!window || !item?.kind) {
        return null;
    }

    if (item.kind === 'song' && typeof item.songPath === 'string') {
        const action = await showSongContextMenu(window, item.songPath);

        if (action === 'export-json') {
            try {
                await exportSongJson(window, item.songPath);
            } catch (error) {
                console.error('Error exporting song', error);
                await dialog.showMessageBox(window, {
                    type: 'error',
                    buttons: ['OK'],
                    title: 'Export failed',
                    message: error?.message || 'Unable to export song.',
                });
            }
        }

        if (action === 'export-pdf') {
            try {
                await exportSongPdf(window, item.songPath, {
                    collectionId: item.collectionId,
                    collectionName: item.collectionName,
                });
            } catch (error) {
                console.error('Error exporting song as PDF', error);
                await dialog.showMessageBox(window, {
                    type: 'error',
                    buttons: ['OK'],
                    title: 'Export failed',
                    message: error?.message || 'Unable to export song as PDF.',
                });
            }
        }

        if (action === 'add-favorite') {
            const result = addSongToFavorites(item.songPath);

            if (!result.ok) {
                await dialog.showMessageBox(window, {
                    type: 'error',
                    buttons: ['OK'],
                    title: 'Add to favorites failed',
                    message: result.error || 'Unable to add song to favorites.',
                });
            }

            return result;
        }

        if (action === 'delete') {
            const t = getTranslator(getAppLanguage());
            const song = fileController.readFile(item.songPath);
            const songName = typeof song?.name === 'string' && song.name.trim() ? song.name.trim() : path.basename(item.songPath, path.extname(item.songPath));
            const { response } = await dialog.showMessageBox(window, {
                type: 'question',
                buttons: [t('dialog.deleteSong.confirm'), t('dialog.deleteSong.cancel')],
                defaultId: 1,
                cancelId: 1,
                title: t('dialog.deleteSong.title'),
                message: t('dialog.deleteSong.message', { name: songName }),
                detail: t('dialog.deleteSong.detail'),
                noLink: true,
            });

            if (response === 0) {
                const result = deleteSongByPath(item.songPath);

                if (!result.ok) {
                    await dialog.showMessageBox(window, {
                        type: 'error',
                        buttons: [t('dialog.ok')],
                        title: t('dialog.deleteSong.failTitle'),
                        message: result.error || t('dialog.deleteSong.failMessage'),
                    });
                }

                return result;
            }
        }

        return action;
    }

    if (item.kind === 'folder' && typeof item.collectionId === 'string') {
        ensureLibraryDataLoaded();
        const action = await showCollectionContextMenu(window);

        if (action === 'export-zip') {
            const result = await exportCollectionZip(window, item.collectionId, item.collectionName);

            if (!result.ok && !result.canceled) {
                await dialog.showMessageBox(window, {
                    type: 'error',
                    buttons: ['OK'],
                    title: 'Export failed',
                    message: result.error || 'Unable to export collection.',
                });
            }

            return result;
        }

        if (action === 'delete') {
            const t = getTranslator(getAppLanguage());
            const songsInCollection = Array.from(libraryState?.songsById?.values() || []).filter((song) => (
                Array.isArray(song?.collections)
                && song.collections.some((collection) => collection?.collectionId === item.collectionId)
            ));

            const removableCount = songsInCollection.filter((song) => (
                Array.isArray(song.collections)
                && song.collections.filter((collection) => collection?.collectionId !== item.collectionId).length === 0
            )).length;
            const retainedCount = songsInCollection.length - removableCount;

            const { response } = await dialog.showMessageBox(window, {
                type: 'question',
                buttons: [t('dialog.deleteCollection.confirm'), t('dialog.deleteCollection.cancel')],
                defaultId: 1,
                cancelId: 1,
                title: t('dialog.deleteCollection.title'),
                message: t('dialog.deleteCollection.message', { name: item.collectionName || item.collectionId }),
                detail: removableCount > 0
                    ? t('dialog.deleteCollection.detailWithCount', { removable: removableCount, retained: retainedCount })
                    : t('dialog.deleteCollection.detailNoCount'),
                noLink: true,
            });

            if (response === 0) {
                const result = deleteCollectionById(item.collectionId);

                if (!result.ok) {
                    await dialog.showMessageBox(window, {
                        type: 'error',
                        buttons: [t('dialog.ok')],
                        title: 'Delete failed',
                        message: result.error || 'Unable to delete collection.',
                    });
                }

                return result;
            }
        }

        return action;
    }

    return null;
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
        const result = savePreferences(preferences);
        // Rebuild the native menu so language-sensitive labels update immediately.
        setApplicationMenuForVerseCount(lastVerseCount ?? 0);
        return result;
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

ipcMain.handle('restore-projection-defaults', () => {
    try {
        // Clean up background image file, then restore only projection keys.
        // theme and useArrangement are left untouched.
        cleanOldBackgroundImages(null);
        const {
            fontFamily, fontSize, textColor, backgroundColor, backgroundImage,
            lineHeight, paddingTop, paddingBottom, paddingLeft, paddingRight,
        } = DEFAULT_PREFERENCES;
        return savePreferences({
            fontFamily, fontSize, textColor, backgroundColor, backgroundImage,
            lineHeight, paddingTop, paddingBottom, paddingLeft, paddingRight,
        });
    } catch (error) {
        console.error('Error restoring projection defaults', error);
        throw error;
    }
});

ipcMain.handle('get-preferences', () => {
    return { ...loadPreferences(), osLocale: app.getLocale() };
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
    const t = getTranslator(getAppLanguage());
    const result = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: [
            t('dialog.unsavedChanges.discard'),
            t('dialog.unsavedChanges.save'),
            t('dialog.unsavedChanges.cancel'),
        ],
        defaultId: 1,
        cancelId: 2,
        title: t('dialog.unsavedChanges.title'),
        message: t('dialog.unsavedChanges.message'),
        detail: t('dialog.unsavedChanges.detail'),
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

ipcMain.handle('app:get-version', () => app.getVersion());

ipcMain.handle('updater:check', async () => {
    try {
        isManualUpdateCheck = true;
        await autoUpdater.checkForUpdates();
    } catch (err) {
        isManualUpdateCheck = false;
        mainWindow?.webContents.send('updater:status', { event: 'error', message: err?.message || 'Unknown error' });
    }
});

ipcMain.handle('updater:download', () => {
    autoUpdater.downloadUpdate();
});

ipcMain.handle('updater:install', () => {
    autoUpdater.quitAndInstall();
});
