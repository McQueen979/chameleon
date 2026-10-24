'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('chameleon', {
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  listNotes: () => ipcRenderer.invoke('notes:list'),
  readNote: (rel) => ipcRenderer.invoke('notes:read', rel),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  showConfig: () => ipcRenderer.invoke('app:showConfig'),
  setStealth: (stealth) => ipcRenderer.invoke('app:setStealth', stealth),
  setPinned: (pinned) => ipcRenderer.invoke('app:setPinned', pinned),
  getBounds: () => ipcRenderer.invoke('window:getBounds'),
  setBounds: (bounds) => ipcRenderer.invoke('window:setBounds', bounds),
  setInteracting: (active) => ipcRenderer.invoke('app:interacting', active),
  toggleVisible: () => ipcRenderer.invoke('app:toggleVisible'),
  hide: () => ipcRenderer.invoke('app:hide'),
  quit: () => ipcRenderer.send('app:quit'),
  onOpened: (callback) => {
    ipcRenderer.on('opened', (_event, payload) => callback(payload));
  },
  onConfig: (callback) => {
    ipcRenderer.on('config:changed', (_event, payload) => callback(payload));
  },
});
