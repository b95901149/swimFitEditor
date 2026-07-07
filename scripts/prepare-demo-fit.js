// Build a demo swim FIT with artificially split short lengths for docs/screenshots.
const fs = require('fs');
const path = require('path');
const FitCore = require('../fit_core.js');

const srcPath = path.join(__dirname, '..', 'fixtures', 'sample-swim.fit');
const outPath = path.join(__dirname, '..', 'fixtures', 'demo-swim.fit');

const buf = fs.readFileSync(srcPath);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const model = FitCore.buildModel(FitCore.parse(ab));

// Simulate watch mis-splitting: break a few normal lengths into short + remainder.
const splits = [
  [0, 9.5],
  [3, 11.0],
  [6, 8.0],
];
for (const [idx, firstS] of splits) {
  if (model.lengths[idx]) FitCore.splitLength(model, idx, firstS);
}

const out = FitCore.exportFit(model);
fs.writeFileSync(outPath, Buffer.from(out));
const s = FitCore.summary(model);
console.log(`Wrote ${outPath}: ${s.activeLengths} active lengths, ${s.distance} m`);
