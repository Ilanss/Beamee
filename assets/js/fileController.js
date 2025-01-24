const fs = require('fs');
const path = require('path');

const configPath = './assets/json';

const readFile = (filePath) => {
    try {
        const data = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(data);
    } catch (err) {
        console.error(`Error reading file: ${filePath}`, err);
        return null;
    }
};

const writeFile = (filePath, content) => {
    try {
        fs.writeFileSync(filePath, JSON.stringify(content, null, 2));
        console.log(`File written successfully: ${filePath}`);
    } catch (err) {
        console.error(`Error writing file: ${filePath}`, err);
    }
};

const songNaming = (name) => {
    // TODO normalize name for file naming
    // TODO check if available with getSongFromFilename
    // TODO If not add an identifier to it and check again (use while loop)
    // TODO rename file
    // TODO search and rename every instances of the name in library.json and favorites.json
}

const getSongFromFilename = (filename) => {
    // TODO search file in library adding the .json format
    // TODO if found return the data, if not return null
}

const getConfig = () => {
    return readFile(configPath);
}

module.exports = {
    songNaming,
    getSongFromFilename,
    readFile,
    writeFile,
    getConfig
};