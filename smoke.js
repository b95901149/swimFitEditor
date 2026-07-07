// Headless smoke test: loads the real index.html in a hidden Electron window
// with the real preload, then checks the renderer wired up correctly and that
// a simulated file-open drives the UI. Prints JSON and exits. No visible window.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: true,
    },
  });
  await win.loadFile('index.html');

  const fitPath = process.argv[2];
  const checks = {};
  checks.fitCore = await win.webContents.executeJavaScript('typeof FitCore');
  checks.electronAPI = await win.webContents.executeJavaScript('typeof window.electronAPI');
  checks.appHiddenInitially = await win.webContents.executeJavaScript(
    "document.getElementById('app').classList.contains('hidden')");

  if (fitPath && fs.existsSync(fitPath)) {
    const buf = fs.readFileSync(fitPath);
    win.webContents.send('open-file', { bytes: buf, name: path.basename(fitPath) });
    await new Promise(r => setTimeout(r, 600));
    checks.afterOpen = await win.webContents.executeJavaScript(JSON.stringify ? `(() => {
      const bars = document.querySelectorAll('#chart .bar').length;
      const appVisible = !document.getElementById('app').classList.contains('hidden');
      const total = [...document.querySelectorAll('.card')].find(c => c.querySelector('.k').textContent === 'Total Lengths');
      return JSON.stringify({ appVisible, bars, totalLengths: total ? total.querySelector('.v').textContent : null });
    })()` : 'null');
  }

  console.log('SMOKE_RESULT ' + JSON.stringify(checks));
  app.quit();
}).catch(e => { console.error('SMOKE_ERROR', e); app.exit(1); });
