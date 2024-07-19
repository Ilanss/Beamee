// main.js

// Modules to control application life and create native browser window
const path = require('path');
const os = require('os');
const fs = require('fs');
const { app, BrowserWindow, Menu, ipcMain } = require('electron')

const isDev = process.env.NODE_ENV !== 'production';

const songLibraryLocation = path.join(__dirname, "library");
const favoriteLibraryLocation = path.join(__dirname, "favorite");
let isProjectionOn = false;
let projectorWindow;
let mainWindow;

const createMainWindow = () => {
    // Create the browser window.
    mainWindow = new BrowserWindow({
        name: "Beamee",
        width: isDev ? 1600 : 800,
        height: 600,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    })

    if (isDev) {
        mainWindow.webContents.openDevTools();
    }
    // and load the index.html of the app.
    mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));

    mainWindow.webContents.on('did-finish-load', () => {
        console.log('Main window content fully loaded.');
        listFilesAndFolders(songLibraryLocation).then(files => {
            console.log('Sending library:list event with files:', files);
            mainWindow.webContents.send('library:list', files);
        }).catch(err => {
            console.error('Error listing files and folders:', err);
        });
    });

    // Open the DevTools.
    // mainWindow.webContents.openDevTools()
}

const createProjectorWindow = () => {
    projectorWindow = new BrowserWindow({
        name: "Beamee Projection",
        width: 800,
        height: 600,
        /*         webPreferences: {
                  preload: path.join(__dirname, 'preload.js')
                }
         */
    })

    // and load the index.html of the app.
    projectorWindow.loadFile(path.join(__dirname, 'renderer/projection.html'));
    isProjectionOn = true;

    projectorWindow.on('close', () => {
        isProjectionOn = false;
        mainWindow.webContents.send('projection:status', isProjectionOn);
    })
}

function listFilesAndFolders(directoryPath) {
    return new Promise((resolve, reject) => {
        fs.readdir(directoryPath, { withFileTypes: true }, async (err, files) => {
            if (err) {
                reject(err);
            } else {
                const result = [];
                for (const file of files) {
                    if (file.name.startsWith('.')) {
                        // Exclude hidden files
                        continue;
                    }
                    const fullPath = path.join(directoryPath, file.name);
                    if (file.isDirectory()) {
                        try {
                            const subFilesAndFolders = await listFilesAndFolders(fullPath);
                            result.push({
                                name: file.name,
                                path: fullPath,
                                isFile: false,
                                isDirectory: true,
                                children: subFilesAndFolders
                            });
                        } catch (subErr) {
                            reject(subErr);
                        }
                    } else {
                        result.push({
                            name: file.name,
                            path: fullPath,
                            isFile: true,
                            isDirectory: false,
                            children: []
                        });
                    }
                }
                resolve(result);
            }
        });
    });
}

const loadSongLibrary = () => {
    // fs.readdirSync(songLibrary).forEach(file => {
    //     console.log(file.isDirectory());
    //     console.log(file);
    // })
    fs.readdirSync(songLibraryLocation, { withFileTypes: true }).filter(item => item.isDirectory()).map(file => console.log(file.name));
}


// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.

ipcMain.on('projection:toggle', (e) => {
    console.log(projectorWindow);
    if (!isProjectionOn) {
        createProjectorWindow();
        e.reply("projection:status", isProjectionOn);
    } else {
        projectorWindow.close();
    }
    
})

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
    createMainWindow();

    if (!fs.existsSync(path.join(__dirname, "library"))) {
        fs.mkdirSync("library");
    }

    if (!fs.existsSync(path.join(__dirname, "favorites"))) {
        fs.mkdirSync("favorites");
    }

    app.on('activate', () => {
        // On macOS it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
})