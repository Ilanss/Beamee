const fs = require('fs');
const path = require('path');

const fileController = require('./fileController.js');
const songSchema = require('./songSchema.js');

const LEGACY_LIBRARY_INDEX_CANDIDATES = [
    path.join(__dirname, '..', '..', 'library.json'),
    path.join(__dirname, '..', 'json', 'library.json'),
];

const NON_SONG_FILES = new Set([
    'favorites.json',
    'config.json',
    'library.json',
]);

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const readLegacyCollections = () => {
    for (const candidate of LEGACY_LIBRARY_INDEX_CANDIDATES) {
        if (!fs.existsSync(candidate)) {
            continue;
        }

        const data = fileController.readFile(candidate);
        if (Array.isArray(data)) {
            return data;
        }
    }

    return [];
};

const buildLegacyCollectionMap = (legacyCollections) => {
    const map = new Map();

    legacyCollections.forEach((collection, index) => {
        if (!isObject(collection) || !Array.isArray(collection.songs)) {
            return;
        }

        const name = typeof collection.name === 'string' && collection.name.trim() ? collection.name.trim() : `Collection ${index + 1}`;
        const collectionId = songSchema.normalizeId(collection.collectionId || name, `collection-${index + 1}`);

        collection.songs.forEach((songId, songIndex) => {
            const normalizedSongId = typeof songId === 'string' && songId.trim() ? songId.trim() : '';

            if (!normalizedSongId) {
                return;
            }

            if (!map.has(normalizedSongId)) {
                map.set(normalizedSongId, []);
            }

            map.get(normalizedSongId).push({
                name,
                collectionId,
                number: songIndex + 1,
            });
        });
    });

    return map;
};

const walkJsonFiles = (directoryPath) => {
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
            files.push(...walkJsonFiles(fullPath));
            continue;
        }

        if (!entry.name.endsWith('.json') || NON_SONG_FILES.has(entry.name)) {
            continue;
        }

        files.push(fullPath);
    }

    return files;
};

const walkLibrarySongFiles = (directoryPath, basePath = directoryPath) => {
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
            files.push(...walkLibrarySongFiles(fullPath, basePath));
            continue;
        }

        if (!entry.name.endsWith('.json') || NON_SONG_FILES.has(entry.name)) {
            continue;
        }

        files.push({
            path: fullPath,
            relativePath: path.relative(basePath, fullPath).split(path.sep).join('/'),
        });
    }

    return files;
};

const createMigrationLogEntry = (filePath, status, details = {}) => ({
    timestamp: new Date().toISOString(),
    filePath,
    status,
    ...details,
});

const writeMigrationLog = (baseDir, entries) => {
    const logPath = path.join(baseDir, 'song-migration-log.json');
    fileController.writeFile(logPath, entries);
    return logPath;
};

const migrateLibrarySongs = (libraryRoot, baseDir) => {
    const legacyCollections = readLegacyCollections();
    const legacyCollectionMap = buildLegacyCollectionMap(legacyCollections);
    const songFiles = walkJsonFiles(libraryRoot);
    const idMap = new Map();
    const logEntries = [];

    songFiles.forEach((filePath) => {
        const rawSong = fileController.readFile(filePath);

        if (!isObject(rawSong)) {
            logEntries.push(createMigrationLogEntry(filePath, 'skipped', { reason: 'invalid-json' }));
            return;
        }

        const sourceName = path.basename(filePath, '.json');
        const legacyCollectionsForSong = legacyCollectionMap.get(rawSong.id) || legacyCollectionMap.get(sourceName) || [];
        const migratedSong = songSchema.migrateSongToV1(rawSong, {
            sourcePath: filePath,
            collections: rawSong.collections && rawSong.collections.length ? rawSong.collections : legacyCollectionsForSong,
        });
        const errors = songSchema.validateSong(migratedSong);

        if (errors.length > 0) {
            logEntries.push(createMigrationLogEntry(filePath, 'skipped', { reason: 'validation-failed', errors }));
            return;
        }

        if (typeof rawSong.id === 'string' && rawSong.id.trim() && rawSong.id.trim() !== migratedSong.id) {
            idMap.set(rawSong.id.trim(), migratedSong.id);
        }

        if (sourceName && sourceName !== migratedSong.id) {
            idMap.set(sourceName, migratedSong.id);
        }

        if (JSON.stringify(rawSong) !== JSON.stringify(migratedSong)) {
            fileController.writeFile(filePath, migratedSong);
            logEntries.push(createMigrationLogEntry(filePath, 'migrated', {
                oldId: typeof rawSong.id === 'string' ? rawSong.id : null,
                newId: migratedSong.id,
            }));
            return;
        }

        logEntries.push(createMigrationLogEntry(filePath, 'already-compliant', { id: migratedSong.id }));
    });

    const logPath = writeMigrationLog(baseDir, logEntries);

    return {
        idMap,
        logPath,
        entries: logEntries,
    };
};

const buildLibraryState = (libraryRoot) => {
    const songFiles = walkJsonFiles(libraryRoot);
    const songsById = new Map();
    const songPathById = new Map();
    const collectionMap = new Map();
    const rootSongs = [];

    songFiles.forEach((filePath) => {
        const rawSong = fileController.readFile(filePath);

        if (!isObject(rawSong)) {
            return;
        }

        const errors = songSchema.validateSong(rawSong);
        if (errors.length > 0) {
            return;
        }

        songsById.set(rawSong.id, {
            ...rawSong,
            path: filePath,
        });
        songPathById.set(rawSong.id, filePath);

        if (!rawSong.collections.length) {
            rootSongs.push({
                name: `${rawSong.name}.json`,
                id: rawSong.id,
                path: filePath,
                isFile: true,
                isDirectory: false,
                children: [],
            });
            return;
        }

        rawSong.collections.forEach((collection) => {
            const key = collection.collectionId;

            if (!collectionMap.has(key)) {
                collectionMap.set(key, {
                    name: collection.name,
                    collectionId: collection.collectionId,
                    isFile: false,
                    isDirectory: true,
                    children: [],
                });
            }

            collectionMap.get(key).children.push({
                name: `${rawSong.name}.json`,
                id: rawSong.id,
                path: filePath,
                isFile: true,
                isDirectory: false,
                children: [],
                collectionNumber: collection.number,
            });
        });
    });

    const tree = [
        ...rootSongs.sort((a, b) => a.name.localeCompare(b.name)),
        ...Array.from(collectionMap.values())
            .map((collection) => ({
                ...collection,
                children: collection.children.sort((a, b) => {
                    if (Number.isInteger(a.collectionNumber) && Number.isInteger(b.collectionNumber) && a.collectionNumber !== b.collectionNumber) {
                        return a.collectionNumber - b.collectionNumber;
                    }

                    if (Number.isInteger(a.collectionNumber)) {
                        return -1;
                    }

                    if (Number.isInteger(b.collectionNumber)) {
                        return 1;
                    }

                    return a.name.localeCompare(b.name);
                }),
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
    ];

    return {
        tree,
        songsById,
        songPathById,
    };
};

const migrateFavoritesIds = (favorites, idMap) => {
    if (!Array.isArray(favorites) || !(idMap instanceof Map) || idMap.size === 0) {
        return { favorites, changed: false };
    }

    let changed = false;

    const rewriteSongId = (songId) => {
        const currentId = typeof songId === 'string' ? songId : '';
        const replacement = idMap.get(currentId);

        if (replacement && replacement !== currentId) {
            changed = true;
            return replacement;
        }

        return currentId;
    };

    const rewriteSongRef = (songRef) => {
        if (typeof songRef === 'string') {
            return rewriteSongId(songRef);
        }

        if (!isObject(songRef) || typeof songRef.id !== 'string') {
            return songRef;
        }

        const updatedId = rewriteSongId(songRef.id);

        if (!updatedId) {
            return null;
        }

        return {
            ...songRef,
            id: updatedId,
        };
    };

    const migrated = favorites.map((favorite) => {
        if (!isObject(favorite)) {
            return favorite;
        }

        if (Array.isArray(favorite.songs)) {
            return {
                ...favorite,
                songs: favorite.songs.map(rewriteSongRef).filter(Boolean),
            };
        }

        if (typeof favorite.id === 'string') {
            const updatedId = rewriteSongId(favorite.id);
            return updatedId ? { ...favorite, id: updatedId } : favorite;
        }

        return favorite;
    });

    return { favorites: migrated, changed };
};

module.exports = {
    migrateLibrarySongs,
    buildLibraryState,
    migrateFavoritesIds,
    walkLibrarySongFiles,
};
