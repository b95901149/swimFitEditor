// Capture UI screenshots for docs/USAGE.md via headless Electron.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'images');
const FIT = path.join(ROOT, 'fixtures', 'demo-swim.fit');

app.disableHardwareAcceleration();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function shot(win, name) {
  await sleep(350);
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, name), img.toPNG());
  console.log('saved', name);
}

async function run(win) {
  fs.mkdirSync(OUT, { recursive: true });
  await win.loadFile(path.join(ROOT, 'index.html'));
  await sleep(300);

  await shot(win, '01-welcome.png');

  const buf = fs.readFileSync(FIT);
  win.webContents.send('open-file', { bytes: buf, name: 'demo-swim.fit' });
  await sleep(600);
  await shot(win, '02-loaded.png');

  await win.webContents.executeJavaScript(`
    (() => {
      const bars = document.querySelectorAll('#chart .bar');
      [0, 1].forEach((i) => {
        if (bars[i]) bars[i].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
    })()
  `);
  await sleep(250);
  await shot(win, '03-selected.png');

  await win.webContents.executeJavaScript(`document.getElementById('autoBtn').click()`);
  await sleep(450);
  await shot(win, '04-after-auto-merge.png');

  await win.webContents.executeJavaScript(`
    (() => {
      const d = document.querySelector('details.table');
      if (d) d.open = true;
    })()
  `);
  await sleep(200);
  await win.webContents.executeJavaScript(`window.scrollTo(0, document.body.scrollHeight)`);
  await sleep(250);
  const tall = await win.webContents.executeJavaScript(`document.body.scrollHeight`);
  await win.setContentSize(1280, Math.min(1600, Math.max(900, tall)));
  await sleep(200);
  await shot(win, '05-detail-table.png');

  await win.webContents.executeJavaScript(`window.scrollTo(0, 0)`);
  await win.setContentSize(1280, 900);
  await sleep(150);
  await shot(win, '06-summary.png');
}

app.whenReady().then(async () => {
  if (!fs.existsSync(FIT)) {
    console.error('Missing demo FIT. Run: node scripts/prepare-demo-fit.js');
    app.exit(1);
    return;
  }
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    show: false,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: true,
    },
  });
  try {
    await run(win);
    console.log('SCREENSHOTS_OK');
  } catch (e) {
    console.error('SCREENSHOTS_ERROR', e);
    app.exitCode = 1;
  } finally {
    app.quit();
  }
}).catch((e) => {
  console.error('SCREENSHOTS_ERROR', e);
  app.exit(1);
});
