const path = require('path');
const fileController = require('./fileController.js');

const resolveJsonPath = (library) => {
    const config = fileController.getConfig() || {};
    const jsonRoot = path.resolve(__dirname, '..', '..', config.jsonPath || './assets/json');
    const fileName = library === 'library' ? 'library.json' : 'favorites.json';

    return path.join(jsonRoot, fileName);
};

const readLibrary = (library) => {
    const data = fileController.readFile(resolveJsonPath(library));
    return Array.isArray(data) ? data : [];
};

const writeLibrary = (library, data) => {
    fileController.writeFile(resolveJsonPath(library), data);
};

const clampIndex = (index, length) => {
    const numericIndex = Number.isFinite(index) ? index : 0;
    return Math.max(0, Math.min(numericIndex, length));
};

/**
 * 
 * @param {String} name 
 * @param {String} directory 
 * @param {Int} position 
 * @param {String} library 
 */
const addSongTo = (name, directory, position, library = "favourites") => {
    const data = readLibrary(library);
    const folder = data.find((entry) => entry.name === directory);

    if (!folder) {
        return false;
    }

    folder.songs = Array.isArray(folder.songs) ? folder.songs : [];

    if (folder.songs.includes(name)) {
        return false;
    }

    folder.songs.splice(clampIndex(position, folder.songs.length), 0, name);
    writeLibrary(library, data);
    return true;
}

/**
 * 
 * @param {String} name 
 * @param {String} directory 
 * @param {String} library 
 */
const removeSongFrom = (name, directory, library = "favourites") => {
    const data = readLibrary(library);
    const folder = data.find((entry) => entry.name === directory);

    if (!folder || !Array.isArray(folder.songs)) {
        return false;
    }

    const index = folder.songs.indexOf(name);
    if (index === -1) {
        return false;
    }

    folder.songs.splice(index, 1);
    writeLibrary(library, data);
    return true;
}

/**
 * 
 * @param {String} name 
 * @param {String} library 
 * @param {Int} position 
 */
const addFolderTo = (name, library = "favourites", position = 0) => {
    const data = readLibrary(library);

    if (data.some((entry) => entry.name === name)) {
        return false;
    }

    data.splice(clampIndex(position, data.length), 0, { name, songs: [] });
    writeLibrary(library, data);
    return true;
}

/**
 * 
 * @param {String} name 
 * @param {String} library 
 */
const removeFolderFrom = (name, library = "favourites") => {
    const data = readLibrary(library);
    const index = data.findIndex((entry) => entry.name === name);

    if (index === -1) {
        return false;
    }

    data.splice(index, 1);
    writeLibrary(library, data);
    return true;
}

/**
 * 
 * @param {String} name 
 * @param {Int} newPosition 
 * @param {String} library 
 */
const moveSongPosition = (name, newPosition, library = "favourites") => {
    const data = readLibrary(library);
    const index = data.findIndex((entry) => entry.name === name);

    if (index === -1) {
        return false;
    }

    const [item] = data.splice(index, 1);
    data.splice(clampIndex(newPosition, data.length), 0, item);
    writeLibrary(library, data);
    return true;
}

const getLibrary = (library = "favourites") => {
    return readLibrary(library);
}

module.exports = {
    addSongTo,
    removeSongFrom,
    addFolderTo,
    removeFolderFrom,
    moveSongPosition,
    getLibrary,
};
