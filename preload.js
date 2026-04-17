// preload.js
const fs = require('fs');
const path = require('path');
const { contextBridge, ipcRenderer } = require('electron');
const Sortable = require('sortablejs');
const ipcListenerMap = new Map();

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
    on: (channel, func) => {
        const listener = (event, ...args) => func(...args);

        if (!ipcListenerMap.has(channel)) {
            ipcListenerMap.set(channel, new Map());
        }

        ipcListenerMap.get(channel).set(func, listener);
        ipcRenderer.on(channel, listener);
    },
    off: (channel, func) => {
        const listener = ipcListenerMap.get(channel)?.get(func);

        if (!listener) {
            return;
        }

        ipcRenderer.removeListener(channel, listener);
        ipcListenerMap.get(channel)?.delete(func);
    },
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
});

contextBridge.exposeInMainWorld('Sortable', {
    create: (element, options) => Sortable.create(element, options)
});

// contextBridge.exposeInMainWorld('Sortable', Sortable);
