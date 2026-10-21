// 只開放修圖需要的檔案操作給畫面端
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('lab', {
  openFiles: () => ipcRenderer.invoke('open-files'),
  openFolder: () => ipcRenderer.invoke('open-folder'),
  listFolder: (dir) => ipcRenderer.invoke('list-folder', dir),
  readFile: (p) => ipcRenderer.invoke('read-file', p),
  sidecarRead: (p) => ipcRenderer.invoke('sidecar-read', p),
  sidecarWrite: (p, data) => ipcRenderer.invoke('sidecar-write', p, data),
  chooseDir: (def) => ipcRenderer.invoke('choose-dir', def),
  exportSave: (dir, base, ext, bytes) => ipcRenderer.invoke('export-save', dir, base, ext, bytes),
  reveal: (p) => ipcRenderer.invoke('reveal', p),
  stylesRead: () => ipcRenderer.invoke('styles-read'),
  stylesWrite: (list) => ipcRenderer.invoke('styles-write', list),
  pathForFile: (file) => webUtils.getPathForFile(file),
  log: (msg) => ipcRenderer.send('log', String(msg)),
});
