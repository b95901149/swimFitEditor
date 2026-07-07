// Capture UI screenshots for docs/USAGE.md via headless Electron.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'images');
const DEMO_FIT = path.join(ROOT, 'fixtures', 'demo-swim.fit');
const EXAMPLE_FIT = path.join(ROOT, 'fixtures', '23505296923_ACTIVITY.fit');

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

async function openFit(win, filePath, displayName) {
  const buf = fs.readFileSync(filePath);
  win.webContents.send('open-file', { bytes: buf, name: displayName });
  await sleep(650);
}

async function scrollChartToLength(win, index) {
  await win.webContents.executeJavaScript(`
    (() => {
      const wrap = document.querySelector('.chartwrap');
      const bar = document.querySelector('#chart .bar[data-i="${index}"]');
      if (!wrap || !bar) return;
      const left = Math.max(0, bar.x.baseVal.value + wrap.offsetLeft - wrap.clientWidth * 0.35);
      wrap.scrollLeft = left;
    })()
  `);
  await sleep(200);
}

async function readStats(win) {
  return win.webContents.executeJavaScript(`
    (() => {
      const card = (label) => {
        const el = [...document.querySelectorAll('.card')].find(c => c.querySelector('.k')?.textContent === label);
        const v = el?.querySelector('.v')?.textContent ?? '';
        const d = el?.querySelector('.d')?.textContent ?? '';
        return { v, d };
      };
      return {
        lengths: card('Total Lengths'),
        distance: card('Total Distance'),
        pace: card('Avg. Pace'),
        file: document.getElementById('fname')?.textContent ?? '',
      };
    })()
  `);
}

async function runDemoFlow(win) {
  await shot(win, '01-welcome.png');

  await openFit(win, DEMO_FIT, 'demo-swim.fit');
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

async function runExampleFlow(win) {
  await win.webContents.executeJavaScript(`document.getElementById('resetBtn').click()`);
  await sleep(100);
  // reload page for clean state
  await win.loadFile(path.join(ROOT, 'index.html'));
  await sleep(300);

  await openFit(win, EXAMPLE_FIT, '23505296923_ACTIVITY.fit');
  const before = await readStats(win);
  console.log('example before', before);

  await win.webContents.executeJavaScript(`window.scrollTo(0, 0)`);
  await win.setContentSize(1280, 900);
  await shot(win, '07-example-before-merge.png');

  await scrollChartToLength(win, 13);
  await shot(win, '08-example-short-bars-before.png');

  await win.webContents.executeJavaScript(`window.scrollTo(0, 0)`);
  await sleep(150);
  await shot(win, '09-example-toolbar-before.png');

  await win.webContents.executeJavaScript(`document.getElementById('autoBtn').click()`);
  await sleep(500);
  const after = await readStats(win);
  console.log('example after', after);

  await win.webContents.executeJavaScript(`window.scrollTo(0, 0)`);
  await shot(win, '10-example-after-merge.png');

  await scrollChartToLength(win, 13);
  await shot(win, '11-example-short-bars-after.png');

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
  await win.setContentSize(1280, Math.min(1700, Math.max(900, tall)));
  await sleep(200);
  await shot(win, '12-example-merge-log.png');

  fs.writeFileSync(
    path.join(ROOT, 'fixtures', 'example-merge-stats.json'),
    JSON.stringify({ before, after, thresholdSec: 30 }, null, 2),
  );
}

async function run(win) {
  fs.mkdirSync(OUT, { recursive: true });
  await win.loadFile(path.join(ROOT, 'index.html'));
  await sleep(300);

  await runDemoFlow(win);
  if (fs.existsSync(EXAMPLE_FIT)) await runExampleFlow(win);
}

app.whenReady().then(async () => {
  if (!fs.existsSync(DEMO_FIT)) {
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
