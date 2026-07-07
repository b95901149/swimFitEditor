// Pack browser-only release zip into release/.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const version = require(path.join(ROOT, 'package.json')).version;
const releaseDir = path.join(ROOT, 'release');
const staging = path.join(releaseDir, '.browser-staging');
const zipName = `SwimFitEditor-${version}-browser.zip`;
const zipPath = path.join(releaseDir, zipName);

fs.mkdirSync(releaseDir, { recursive: true });
if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(staging, { recursive: true });

fs.copyFileSync(path.join(ROOT, 'index.html'), path.join(staging, 'index.html'));
fs.copyFileSync(
  path.join(__dirname, 'browser-release', '使用方式.txt'),
  path.join(staging, '使用方式.txt'),
);
fs.copyFileSync(
  path.join(__dirname, 'browser-release', '開啟.bat'),
  path.join(staging, '開啟.bat'),
);

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

const ps =
  process.env.ComSpec && process.platform === 'win32'
    ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : 'powershell';

execFileSync(
  ps,
  [
    '-NoProfile',
    '-Command',
    `Compress-Archive -Path '${staging.replace(/'/g, "''")}\\*' -DestinationPath '${zipPath.replace(/'/g, "''")}' -CompressionLevel Optimal`,
  ],
  { stdio: 'inherit' },
);

fs.rmSync(staging, { recursive: true, force: true });
const kb = (fs.statSync(zipPath).size / 1024).toFixed(1);
console.log(`Wrote ${zipPath} (${kb} KB)`);
