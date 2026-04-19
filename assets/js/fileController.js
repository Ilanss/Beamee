const fs = require('fs');
const path = require('path');

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
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(content, null, 2));
        console.log(`File written successfully: ${filePath}`);
    } catch (err) {
        console.error(`Error writing file: ${filePath}`, err);
    }
};

module.exports = {
    readFile,
    writeFile,
};
