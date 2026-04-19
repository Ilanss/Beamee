const fs = require('fs');
const path = require('path');

const fileController = require('./fileController.js');
const songSchema = require('./songSchema.js');

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

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

        if (!entry.name.endsWith('.json')) {
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

        if (!entry.name.endsWith('.json')) {
            continue;
        }

        files.push({
            path: fullPath,
            relativePath: path.relative(basePath, fullPath).split(path.sep).join('/'),
        });
    }

    return files;
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

        if (songsById.has(rawSong.id)) {
            console.warn(`Duplicate song id skipped while building library state: ${rawSong.id} (${filePath})`);
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

module.exports = {
    buildLibraryState,
    walkLibrarySongFiles,
};
