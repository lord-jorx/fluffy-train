const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  saveKey: (key) => ipcRenderer.invoke('save-key', key),
  loadKey: () => ipcRenderer.invoke('load-key'),
  isElectron: true
});
