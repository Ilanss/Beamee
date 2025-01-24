const fileController = require('./assets/js/fileController.js');

/**
 * 
 * @param {String} name 
 * @param {String} directory 
 * @param {Int} position 
 * @param {String} library 
 */
const addSongTo = (name, directory, position, library = "favourites") => {
    // TODO Load favorites.json or library.json
    // TODO check for name existance in specified directory -> return if exist
    // TODO add name to the list at the position indicated
    // TODO write file
}

/**
 * 
 * @param {String} name 
 * @param {String} directory 
 * @param {String} library 
 */
const removeSongFrom = (name, directory, library = "favourites") => {
    // TODO Load favorites.json or library.json
    // TODO check for name existance in specified directory -> return if doesn't exist
    // TODO delete song in data
    // TODO write file
}

/**
 * 
 * @param {String} name 
 * @param {String} library 
 * @param {Int} position 
 */
const addFolderTo = (name, library = "favourites", position = 0) => {
    // TODO Load favorites.json or library.json
    // TODO check for name existance -> return if doesn't exist
    // TODO create folder at position
    // TODO write file
}

/**
 * 
 * @param {String} name 
 * @param {String} library 
 */
const removeFolderFrom = (name, library = "favourites") => {
    // TODO Load favorites.json or library.json
    // TODO check for name existance -> return if doesn't exist
    // TODO delete folder
    // TODO write file
}

/**
 * 
 * @param {String} name 
 * @param {Int} newPosition 
 * @param {String} library 
 */
const moveSongPosition = (name, newPosition, library = "favourites") => {
    // TODO Load favorites.json or library.json
    // TODO get song from name
    // TODO move position in the list
    // TODO write file
}

const getLibrary = () => {
    return fileController.readFile();
}

module.exports = {
    addSongTo,
    removeSongFrom,
    moveSongPosition,
};