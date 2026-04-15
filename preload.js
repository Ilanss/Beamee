// preload.js
const os = require('os');
const fs = require('fs');
const path = require('path');
const { contextBridge, ipcRenderer } = require('electron');
const Sortable = require('sortablejs');

contextBridge.exposeInMainWorld('os', {
    homedir: () => os.homedir(),
});

contextBridge.exposeInMainWorld('path', {
    join: (...args) => path.join(...args),
});

contextBridge.exposeInMainWorld('fs', {
    readdirSync: (dir) => fs.readdirSync(dir),
    readFileSync: (file, encoding) => fs.readFileSync(file, encoding),
    writeFileSync: (file, data) => fs.writeFileSync(file, data),
    mkdirSync: (dir) => fs.mkdirSync(dir),
    existsSync: (file) => fs.existsSync(file),
    lstatSync: (file) => fs.lstatSync(file)
});

contextBridge.exposeInMainWorld('ipcRenderer', {
    send: (channel, data) => ipcRenderer.send(channel, data),
    on: (channel, func) => ipcRenderer.on(channel, (event, ...args) => func(...args)),
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    sendSync: (channel, data) => ipcRenderer.sendSync(channel, data),
});

contextBridge.exposeInMainWorld('Sortable', {
    create: (element, options) => Sortable.create(element, options)
});

// contextBridge.exposeInMainWorld('Sortable', Sortable);
