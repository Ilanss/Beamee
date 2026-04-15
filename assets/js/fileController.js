const fs = require('fs');
const path = require('path');
const songSchema = require('./songSchema.js');

const configPath = path.join(__dirname, '../json/config.json');

const resolveProjectPath = (relativePath) => path.resolve(__dirname, '..', '..', relativePath);

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

const songNaming = (name) => {
    const normalized = songSchema.normalizeId(name, 'song');

    let candidate = normalized;
    let counter = 1;

    while (getSongFromFilename(candidate)) {
        candidate = `${normalized}-${counter++}`;
    }

    return candidate;
}

const getSongFromFilename = (filename) => {
    const config = getConfig() || {};
    const libraryRoot = resolveProjectPath(config.libraryPath || './library');
    const targetFilename = filename.endsWith('.json') ? filename : `${filename}.json`;

    const findInDir = (dir) => {
        if (!fs.existsSync(dir)) {
            return null;
        }

        const files = fs.readdirSync(dir);

        for (const file of files) {
            const filePath = path.join(dir, file);
            const stat = fs.statSync(filePath);

            if (stat.isDirectory()) {
                const result = findInDir(filePath);
                if (result) {
                    return result;
                }
                continue;
            }

            if (file === targetFilename || path.basename(filePath, '.json') === filename) {
                const song = readFile(filePath);
                if (song && typeof song === 'object') {
                    return song;
                }
            }
        }

        return null;
    };

    return findInDir(libraryRoot);
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
