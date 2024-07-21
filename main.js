// main.js

// Modules to control application life and create native browser window
const path = require('path');
const os = require('os');
const fs = require('fs');
const { app, BrowserWindow, Menu, ipcMain, screen, globalShortcut } = require('electron')

const isDev = !app.isPackaged;

const songLibraryLocation = path.join(__dirname, "library");
const favoritesFile = path.join(__dirname, "favorites.json");
let isProjectionOn = false;
let projectorWindow;
let mainWindow;

let lastVerseCount;

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

    const menu = Menu.buildFromTemplate([
        {
          label: 'File',
          submenu: [
            {
              label: 'New Song',
              click: () => {
                mainWindow.webContents.send('show-add-song-view');
              },
              accelerator: 'CmdOrCtrl+N'
            },
            {
              label: 'New Folder',
              click: () => {
                mainWindow.webContents.send('show-add-folder-view');
              },
              accelerator: 'CmdOrCtrl+Shift+N'
            },
            { type: 'separator' },
            {
              label: 'Preferences',
              click: () => {
                createPreferencesWindow();
              },
              accelerator: 'CmdOrCtrl+,'
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
                    label: 'Previous verse',
                    click: () => { mainWindow.webContents.send('projection:prev'); },
                    accelerator: 'p'
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
                            projectorWindow.webContents.send('black-screen'); 
                        }
                        mainWindow.webContents.send('black-screen'); 
                    },
                    accelerator: 'b'
                }
            ]
        }
      ]);
    
      Menu.setApplicationMenu(menu);
    
    if (isDev) {
        mainWindow.webContents.openDevTools();
    }
    // and load the index.html of the app.
    mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));

    mainWindow.webContents.on('did-finish-load', () => {
        listFilesAndFolders(songLibraryLocation).then(files => {
            mainWindow.webContents.send('library:list', files);
        }).catch(err => {
            console.error('Error listing files and folders:', err);
        });

        let favorites = JSON.parse(fs.readFileSync(favoritesFile, 'utf8'));

        favorites.forEach(favorite => {
            favorite.songs = favorite.songs.map(songId => {
                let songPath = findSongPath(songId);
                return {
                    id: songId,
                    path: songPath,
                    name: getSongName(songPath)
                };
            });
        });
        // console.log(JSON.parse(fs.readFileSync(favoritesFile, 'utf8')));
        console.log(favorites[0]);
        mainWindow.webContents.send('favorites:list', favorites);
        // loadFavorites().then(favorites => {
        //     mainWindow.webContents.send('favorites:list', favorites);
        // }).catch(err => {
        //     console.error('Error loading favorites:', err);
        // });
    });

    // Open the DevTools.
    // mainWindow.webContents.openDevTools()
}

const getSongName = (songPath) => {
    const songData = JSON.parse(fs.readFileSync(songPath, 'utf-8'));
    return songData.name;
};

const findSongPath = (songId) => {
    let songPath = null;
    
    // Implement logic to find the song file path. 
    // For example, you can use fs.readdirSync to traverse directories if needed.
    
    function findInDir(dir, songId) {
        const files = fs.readdirSync(dir);
        for (let file of files) {
            let filePath = path.join(dir, file);
            let stat = fs.statSync(filePath);
            if (stat.isDirectory()) {
                let result = findInDir(filePath, songId);
                if (result) return result;
            } else if (path.basename(filePath, path.extname(filePath)) === songId) {
                return filePath;
            }
        }
        return null;
    }
    
    songPath = findInDir(songLibraryLocation, songId);
    return songPath;
};

const createProjectorWindow = () => {
    let externalDisplay = null;
    const displays = screen.getAllDisplays();

    // Look for a secondary display (if any)
    for (const display of displays) {
      if (display.bounds.x !== 0 || display.bounds.y !== 0) {
        externalDisplay = display;
        break;
      }
    }

    const windowOptions = {
        name: "Beamee Projection",
        fullscreen: true,
        width: isDev ? 1200 : 800,
        height: 600,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    };

    // If an external display is found, set the position to the secondary display
    if (externalDisplay) {
        windowOptions.x = externalDisplay.bounds.x;
        windowOptions.y = externalDisplay.bounds.y;
    }

    // Create the window with the specified options
    projectorWindow = new BrowserWindow(windowOptions);

    // and load the index.html of the app.
    projectorWindow.loadFile(path.join(__dirname, 'renderer/projector.html'));

    isProjectionOn = true;

    if (isDev) {
        projectorWindow.webContents.openDevTools();
    }

    projectorWindow.on('close', () => {
        isProjectionOn = false;
        mainWindow.webContents.send('projection:status', isProjectionOn);
    })

    projectorWindow.webContents.on('did-finish-load', () => {
        mainWindow.webContents.send('projection:status', isProjectionOn);
        setTimeout(
            () => {
                mainWindow.focus();
            }, 500
        )
    });
}

function createPreferencesWindow() {
    let prefWindow = new BrowserWindow({
      width: 400,
      height: 300,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js')
    }
});
  
    prefWindow.loadFile('renderer/preferences.html');
    if (isDev) {
        mainWindow.webContents.openDevTools();
    }
  
}
  
const preferencesFile = path.join(__dirname, 'preferences.json');

function loadPreferences() {
  if (fs.existsSync(preferencesFile)) {
    const preferences = JSON.parse(fs.readFileSync(preferencesFile, 'utf8'));
    return preferences;
  }
  return {
    fontFamily: 'Arial',
    fontSize: '24',
    textColor: '#FFFFFF',
    backgroundColor: '#000000',
  };
}

function registerShortcuts(verseCount) {
    for(let i = 0; i <= verseCount; i++) {
        globalShortcut.register(`CmdOrCtrl+${i}`, () => {
            mainWindow.webContents.send('verse:change', i - 1);
        });
    }

    lastVerseCount = verseCount;
}

function unregisterShortcuts(verseCount) {
    for(let i = 0; i <= verseCount; i++) {
        globalShortcut.unregister(`CmdOrCtrl+${i}`);
    }
}

// function loadFavorites() {
//     return new Promise((resolve, reject) => {
//         const favoritesList = JSON.parse(fs.readFileSync(favoritesFile, 'utf8'));
//     })
// }

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
                        const songData = JSON.parse(fs.readFileSync(fullPath, 'utf8'));

                        result.push({
                            name: file.name,
                            id: songData.id,
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

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.

ipcMain.on('projection:toggle', (e) => {
    if (!isProjectionOn) {
        createProjectorWindow();
        e.reply("projection:status", isProjectionOn);
    } else {
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
  
// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
    createMainWindow();

    if (!fs.existsSync(path.join(__dirname, "library"))) {
        fs.mkdirSync("library");
    }

    if (!fs.existsSync(path.join(__dirname, "favorites.json"))) {
        fs.writeFileSync(path.join(__dirname, 'favorites.json'), '{}');
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

function savePreferences(preferences) {
    fs.writeFileSync(preferencesFile, JSON.stringify(preferences, null, 2), 'utf8');
}
  
ipcMain.on('save-preferences', (event, preferences) => {
    savePreferences(preferences);
});
  
ipcMain.on('get-preferences', (event) => {
    const preferences = loadPreferences();
    event.returnValue = preferences;
});  

ipcMain.on('song:loaded', (event, verseCount) => {
    unregisterShortcuts(lastVerseCount);
    registerShortcuts(verseCount);
});