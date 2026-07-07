// Preload: expose a minimal, sandboxed API so the renderer can receive a
// file opened via the .fit association without full Node access.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onOpenFile: (cb) => ipcRenderer.on('open-file', (_e, data) => cb(data.bytes, data.name)),
});
