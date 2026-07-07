// Electron main process for 游泳 FIT 趟數修正器.
// Loads the self-contained index.html and, when the app is launched via a
// .fit file association (double-click), reads that file and hands its bytes
// to the renderer.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

let win = null;
let pendingFile = null;

function fitArgFrom(argv) {
  for (const a of argv.slice(1)) {
    if (a && !a.startsWith('--') && /\.fit$/i.test(a) && fs.existsSync(a)) return a;
  }
  return null;
}

function sendFile(fp) {
  if (!fp || !win) return;
  try {
    const buf = fs.readFileSync(fp); // Node Buffer -> Uint8Array in renderer
    win.webContents.send('open-file', { bytes: buf, name: path.basename(fp) });
  } catch (e) { /* ignore unreadable file */ }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 900,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile('index.html');
  win.webContents.on('did-finish-load', () => {
    if (pendingFile) { sendFile(pendingFile); pendingFile = null; }
  });
  win.on('closed', () => { win = null; });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const fp = fitArgFrom(argv);
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
    if (fp) sendFile(fp);
  });
  app.whenReady().then(() => {
    pendingFile = fitArgFrom(process.argv);
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
