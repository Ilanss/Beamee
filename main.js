// main.js

// Modules to control application life and create native browser window
const path = require('path'); // TODO after rework it should required only in file controller
// const os = require('os'); // TODO check if useful 
const fs = require('fs'); // TODO after rework it should required only in file controller
const { app, BrowserWindow, Menu, ipcMain, screen, globalShortcut } = require('electron');

// Controller imports
const libraryController = require('./assets/js/libraryController.js');
const { DEFAULT_PREFERENCES, mergePreferences, normalizePreferences } = require('./assets/js/preferencesStore.js');

const isDev = !app.isPackaged;

let isProjectionOn = false;
let projectorWindow;
let mainWindow;
let appDataPaths;
let migrationResult;
let libraryState;

let lastVerseCount;

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
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
};

const migrateLegacyData = (paths) => {
    const legacyLibraryPath = path.join(__dirname, 'library');
    const legacyFavoritesPath = path.join(__dirname, 'favorites.json');

    if (!fs.existsSync(paths.library) && fs.existsSync(legacyLibraryPath)) {
        fs.cpSync(legacyLibraryPath, paths.library, { recursive: true });
    }

    if (!fs.existsSync(paths.favorites) && fs.existsSync(legacyFavoritesPath)) {
        fs.copyFileSync(legacyFavoritesPath, paths.favorites);
    }

};

const bootstrapAppData = () => {
    const paths = getAppDataPaths();

    ensureDirSync(paths.baseDir);
    migrateLegacyData(paths);
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
        if (!fs.existsSync(filePath)) {
            return fallback;
        }

        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
        console.error(`Error reading JSON file: ${filePath}`, err);
        return fallback;
    }
};

const saveJsonFile = (filePath, data) => {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
};

const resolveSongRecord = (songId) => {
    if (!libraryState || !songId) {
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
    };
};

const ensureLibraryDataLoaded = () => {
    if (libraryState) {
        return;
    }

    migrationResult = libraryController.migrateLibrarySongs(appDataPaths.library, appDataPaths.baseDir);
    libraryState = libraryController.buildLibraryState(appDataPaths.library);
};

const loadFavorites = () => {
    const favorites = readJsonFile(appDataPaths.favorites, []);

    if (!Array.isArray(favorites)) {
        return [];
    }

    const migration = libraryController.migrateFavoritesIds(favorites, migrationResult?.idMap || new Map());

    if (migration.changed) {
        saveJsonFile(appDataPaths.favorites, migration.favorites);
    }

    return migration.favorites
        .map((favorite) => {
            const safeFavorite = favorite && typeof favorite === 'object' ? favorite : {};

            if (Array.isArray(safeFavorite.songs)) {
                return {
                    ...safeFavorite,
                    songs: safeFavorite.songs
                        .map((songRef) => {
                            const songId = typeof songRef === 'string' ? songRef : songRef?.id;
                            const song = resolveSongRecord(songId);

                            if (!song) {
                                return null;
                            }

                            return {
                                ...song,
                                displayName: typeof songRef === 'object' && songRef && typeof songRef.displayName === 'string'
                                    ? songRef.displayName
                                    : '',
                            };
                        })
                        .filter(Boolean)
                };
            }

            if (!safeFavorite.id) {
                return null;
            }

            const song = resolveSongRecord(safeFavorite.id);

            if (!song) {
                return null;
            }

            return {
                ...safeFavorite,
                ...song,
                displayName: typeof safeFavorite.displayName === 'string' ? safeFavorite.displayName : '',
            };
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

const showFavoritesContextMenu = (window) => {
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
                label: 'Rename',
                click: () => finish('rename'),
            },
            {
                label: 'Delete',
                click: () => finish('delete'),
            },
        ]);

        menu.popup({
            window,
            callback: () => finish(null),
        });
    });
};

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
                navigateMainWindow('settings');
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
                    label: 'Next verse',
                    click: () => { mainWindow.webContents.send('projection:next'); },
                    visible: false,
                    acceleratorWorksWhenHidden: true,
                    accelerator: 'Right'
                },
                {
                    label: 'Previous verse',
                    click: () => { mainWindow.webContents.send('projection:prev'); },
                    accelerator: 'p'
                },
                {
                    label: 'Previous verse',
                    visible: false,
                    acceleratorWorksWhenHidden: true,
                    click: () => { mainWindow.webContents.send('projection:prev'); },
                    accelerator: 'Left'
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
                            projectorWindow?.webContents.send('black-screen');
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
        ensureLibraryDataLoaded();
    });

    // Open the DevTools.
    // mainWindow.webContents.openDevTools()

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
        projectorWindow = null;
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

function loadPreferences() {
  return normalizePreferences(readJsonFile(appDataPaths.preferences, DEFAULT_PREFERENCES));
}

function savePreferences(preferences) {
    const currentPreferences = loadPreferences();
    const nextPreferences = mergePreferences(currentPreferences, preferences);

    fs.writeFileSync(appDataPaths.preferences, JSON.stringify(nextPreferences, null, 2), 'utf8');

    for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send('preferences:changed', nextPreferences);
    }

    return nextPreferences;
}

function restoreDefaultPreferences() {
    return savePreferences(DEFAULT_PREFERENCES);
}

function registerShortcuts(verseCount) {
    const count = Number.isFinite(verseCount) ? verseCount : 0;

    for (let i = 1; i <= count; i++) {
        globalShortcut.register(`${i}`, () => {
            mainWindow.webContents.send('verse:change', i - 1);
        });
    }

    lastVerseCount = verseCount;
}

function unregisterShortcuts(verseCount) {
    const count = Number.isFinite(verseCount) ? verseCount : 0;

    for (let i = 1; i <= count; i++) {
        globalShortcut.unregister(`${i}`);
    }
}

// function loadFavorites() {
//     return new Promise((resolve, reject) => {
//         const favoritesList = JSON.parse(fs.readFileSync(favoritesFile, 'utf8'));
//     })
// }

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

ipcMain.handle('favorites:context-menu', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);

    if (!window) {
        return null;
    }

    return showFavoritesContextMenu(window);
});

ipcMain.handle('favorites:update', (event, favorites) => {
    return saveFavorites(favorites);
});
  
// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
    appDataPaths = bootstrapAppData();
    createMainWindow();

    app.on('activate', () => {
        // On macOS it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('save-preferences', (event, preferences) => {
    try {
        return savePreferences(preferences);
    } catch (error) {
        console.error('Error saving preferences', error);
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

ipcMain.handle('get-preferences', () => {
    return loadPreferences();
});

ipcMain.handle('library:state', () => {
    ensureLibraryDataLoaded();

    return {
        library: libraryState?.tree || [],
        favorites: loadFavorites(),
    };
});

ipcMain.handle('projection:is-on', () => {
    return isProjectionOn;
});

ipcMain.on('song:loaded', (event, verseCount) => {
    unregisterShortcuts(lastVerseCount);
    registerShortcuts(verseCount);
});
