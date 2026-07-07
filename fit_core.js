/*
 * fit_core.js — DOM-free FIT swim-file engine.
 *
 * Parses a Garmin .fit swim activity, exposes an editable list of pool
 * "lengths" (25m/50m etc. laps), supports merge / split / auto-merge, and
 * re-encodes a byte-faithful .fit that only touches the fields it must
 * (every unrelated vendor byte is preserved). Works in the browser (attaches
 * to window.FitCore) and in Node (module.exports).
 *
 * FIT field numbers below were verified empirically against fitparse's decoded
 * values for this file family, not assumed.
 */
(function (root) {
  'use strict';

  // ---- base type table: FIT base_type -> byte size + DataView accessors ----
  const BASE_TYPE = {
    0x00: { size: 1, get: 'getUint8', set: 'setUint8', invalid: 0xFF },       // enum
    0x01: { size: 1, get: 'getInt8', set: 'setInt8', invalid: 0x7F },         // sint8
    0x02: { size: 1, get: 'getUint8', set: 'setUint8', invalid: 0xFF },       // uint8
    0x83: { size: 2, get: 'getInt16', set: 'setInt16', invalid: 0x7FFF },     // sint16
    0x84: { size: 2, get: 'getUint16', set: 'setUint16', invalid: 0xFFFF },   // uint16
    0x85: { size: 4, get: 'getInt32', set: 'setInt32', invalid: 0x7FFFFFFF }, // sint32
    0x86: { size: 4, get: 'getUint32', set: 'setUint32', invalid: 0xFFFFFFFF },// uint32
    0x07: { size: 1, get: null, set: null, invalid: 0x00 },                   // string
    0x88: { size: 2, get: 'getInt16', set: 'setInt16', invalid: 0x7FFF },     // float16-ish (rare)
    0x89: { size: 4, get: 'getInt32', set: 'setInt32', invalid: 0x7FFFFFFF },
    0x8A: { size: 8, get: null, set: null, invalid: 0 },
    0x0B: { size: 1, get: 'getUint8', set: 'setUint8', invalid: 0x00 },       // uint8z
    0x0C: { size: 4, get: 'getUint32', set: 'setUint32', invalid: 0x00 },     // uint32z
    0x0D: { size: 1, get: 'getUint8', set: 'setUint8', invalid: 0xFF },       // byte
    0x8E: { size: 8, get: null, set: null, invalid: 0 },
    0x8F: { size: 8, get: null, set: null, invalid: 0 },
    0x90: { size: 4, get: 'getFloat32', set: 'setFloat32', invalid: 0xFFFFFFFF },
    0x91: { size: 8, get: 'getFloat64', set: 'setFloat64', invalid: 0 },
  };

  // ---- global message numbers ----
  const MESG_SESSION = 18;
  const MESG_LAP = 19;
  const MESG_LENGTH = 101;

  // ---- length message field numbers ----
  const L_MESSAGE_INDEX = 254;
  const L_TIMESTAMP = 253;
  const L_START_TIME = 2;
  const L_TOTAL_ELAPSED_TIME = 3; // uint32, scale 1000 (s)
  const L_TOTAL_TIMER_TIME = 4;   // uint32, scale 1000 (s)
  const L_TOTAL_STROKES = 5;      // uint16
  const L_AVG_SPEED = 6;          // uint16, scale 1000 (m/s)
  const L_SWIM_STROKE = 7;        // enum
  const L_AVG_SWIM_CADENCE = 9;   // uint8 (strokes/min)
  const L_TOTAL_CALORIES = 11;    // uint16
  const L_LENGTH_TYPE = 12;       // enum: 0=idle/rest, 1=active

  // ---- lap message field numbers ----
  const LAP_TOTAL_DISTANCE = 9;      // uint32, scale 100 (m)
  const LAP_TOTAL_CYCLES = 10;       // uint32 (total strokes)
  const LAP_NUM_LENGTHS = 32;        // uint16
  const LAP_NUM_ACTIVE_LENGTHS = 40; // uint16
  const LAP_FIRST_LENGTH_INDEX = 35; // uint16

  // ---- session message field numbers ----
  const SES_TOTAL_DISTANCE = 9;      // uint32, scale 100 (m)
  const SES_TOTAL_CYCLES = 10;       // uint32 (total strokes)
  const SES_START_TIME = 2;          // uint32 (FIT timestamp)
  const SES_TOTAL_TIMER_TIME = 8;    // uint32, scale 1000 (s)
  const SES_TOTAL_CALORIES = 11;     // uint16 (kcal)
  const SES_AVG_HEART_RATE = 16;     // uint8 (bpm)
  const SES_POOL_LENGTH = 44;        // uint16, scale 100 (m)
  const SES_NUM_ACTIVE_LENGTHS = 47; // uint16

  const SWIM_STROKE_NAMES = {
    0: 'freestyle', 1: 'backstroke', 2: 'breaststroke', 3: 'butterfly',
    4: 'drill', 5: 'mixed', 6: 'im', 255: '—',
  };

  // ---------------------------------------------------------------------------
  // CRC-16 (FIT spec)
  // ---------------------------------------------------------------------------
  const CRC_TABLE = [
    0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401,
    0xA001, 0x6C00, 0x7800, 0xB401, 0x5000, 0x9C01, 0x8801, 0x4400,
  ];
  function crc16(bytes, start, end) {
    let crc = 0;
    for (let i = start; i < end; i++) {
      let tmp = CRC_TABLE[crc & 0xF];
      crc = (crc >> 4) & 0x0FFF;
      crc = crc ^ tmp ^ CRC_TABLE[bytes[i] & 0xF];
      tmp = CRC_TABLE[crc & 0xF];
      crc = (crc >> 4) & 0x0FFF;
      crc = crc ^ tmp ^ CRC_TABLE[(bytes[i] >> 4) & 0xF];
    }
    return crc & 0xFFFF;
  }

  // ---------------------------------------------------------------------------
  // Parse
  // ---------------------------------------------------------------------------
  function parse(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const dv = new DataView(arrayBuffer);
    const headerSize = bytes[0];
    const dataSize = dv.getUint32(4, true);
    const magic = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (magic !== '.FIT') throw new Error('不是有效的 FIT 檔 (magic=' + magic + ')');
    const dataStart = headerSize;
    const dataEnd = headerSize + dataSize;

    const localDefs = {};
    const records = [];
    let pos = dataStart;
    while (pos < dataEnd) {
      const recStart = pos;
      const headerByte = bytes[pos];
      let isDef, localType;
      if (headerByte & 0x80) { // compressed timestamp header
        isDef = false;
        localType = (headerByte >> 5) & 0x03;
        pos += 1;
      } else {
        isDef = !!(headerByte & 0x40);
        localType = headerByte & 0x0F;
        pos += 1;
      }

      if (isDef) {
        const arch = bytes[pos + 1];
        const little = arch === 0;
        const globalNum = little ? dv.getUint16(pos + 2, true) : dv.getUint16(pos + 2, false);
        const numFields = bytes[pos + 4];
        let fpos = pos + 5;
        const fields = [];
        for (let i = 0; i < numFields; i++) {
          fields.push({ defNum: bytes[fpos], size: bytes[fpos + 1], baseType: bytes[fpos + 2] });
          fpos += 3;
        }
        const devFields = [];
        if (headerByte & 0x20) {
          const numDev = bytes[fpos];
          fpos += 1;
          for (let i = 0; i < numDev; i++) {
            devFields.push({ defNum: bytes[fpos], size: bytes[fpos + 1] });
            fpos += 3;
          }
        }
        const def = { globalNum, little, fields, devFields };
        localDefs[localType] = def;
        pos = fpos;
        records.push({ isDefinition: true, localType, rawStart: recStart, rawEnd: pos, def, globalNum });
      } else {
        const def = localDefs[localType];
        if (!def) throw new Error('資料訊息缺少對應的定義 (local ' + localType + ')');
        const headerLen = pos - recStart;
        const fieldOffsets = {}; // defNum -> {offset, size, baseType} (relative to record start)
        let fpos = pos;
        for (const f of def.fields) {
          if (!(f.defNum in fieldOffsets)) {
            fieldOffsets[f.defNum] = { offset: fpos - recStart, size: f.size, baseType: f.baseType };
          }
          fpos += f.size;
        }
        for (const f of def.devFields) fpos += f.size;
        pos = fpos;
        records.push({
          isDefinition: false, localType, rawStart: recStart, rawEnd: pos,
          def, globalNum: def.globalNum, headerLen, fieldOffsets,
        });
      }
    }

    return { bytes, dv, headerSize, dataStart, dataEnd, records };
  }

  // Read a numeric field from the original buffer. Returns null if absent/unreadable.
  function readField(parsed, rec, defNum) {
    const fo = rec.fieldOffsets[defNum];
    if (!fo) return null;
    const bt = BASE_TYPE[fo.baseType];
    if (!bt || !bt.get) return null;
    if (fo.size !== bt.size) return null; // arrays not handled for our fields
    const abs = rec.rawStart + fo.offset;
    return parsed.dv[bt.get](abs, rec.def.little);
  }

  // Write a numeric field into a target DataView (record-local coordinates).
  function writeField(targetDV, rec, defNum, value) {
    const fo = rec.fieldOffsets[defNum];
    if (!fo) return false;
    const bt = BASE_TYPE[fo.baseType];
    if (!bt || !bt.set) return false;
    targetDV[bt.set](fo.offset, value, rec.def.little);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Build editable model
  // ---------------------------------------------------------------------------
  function buildModel(parsed) {
    const lengthRecs = parsed.records.filter(r => !r.isDefinition && r.globalNum === MESG_LENGTH);
    const lapRecs = parsed.records.filter(r => !r.isDefinition && r.globalNum === MESG_LAP);
    const lapRec = lapRecs[0] || null;
    const sesRec = parsed.records.find(r => !r.isDefinition && r.globalNum === MESG_SESSION) || null;

    let poolLenM = 25.0;
    let sessionInfo = { startTime: null, avgHr: null, calories: null, totalTimerMs: null };
    if (sesRec) {
      const raw = readField(parsed, sesRec, SES_POOL_LENGTH);
      if (raw != null && raw !== BASE_TYPE[0x84].invalid) poolLenM = raw / 100.0;
      const hr = readField(parsed, sesRec, SES_AVG_HEART_RATE);
      const cal = readField(parsed, sesRec, SES_TOTAL_CALORIES);
      const st = readField(parsed, sesRec, SES_START_TIME);
      const tt = readField(parsed, sesRec, SES_TOTAL_TIMER_TIME);
      sessionInfo = {
        startTime: (st != null && st !== 0xFFFFFFFF) ? st : null,
        avgHr: (hr != null && hr !== 0xFF) ? hr : null,
        calories: (cal != null && cal !== 0xFFFF) ? cal : null,
        totalTimerMs: (tt != null && tt !== 0xFFFFFFFF) ? tt : null,
      };
    }

    // lap boundaries: the message_index at which each lap begins
    const lapStartIdx = new Set();
    for (const lr of lapRecs) {
      const fi = readField(parsed, lr, LAP_FIRST_LENGTH_INDEX);
      if (fi != null && fi !== 0xFFFF) lapStartIdx.add(fi);
    }

    let uid = 0;
    const lengths = lengthRecs.map((rec) => {
      const lengthType = readField(parsed, rec, L_LENGTH_TYPE);
      const stroke = readField(parsed, rec, L_SWIM_STROKE);
      const cal = readField(parsed, rec, L_TOTAL_CALORIES);
      const mi = readField(parsed, rec, L_MESSAGE_INDEX);
      return {
        id: uid++,
        recRef: rec,                 // template record for re-encoding
        active: lengthType === 1 || lengthType == null,
        swimStroke: stroke,
        elapsedMs: readField(parsed, rec, L_TOTAL_ELAPSED_TIME),
        timerMs: readField(parsed, rec, L_TOTAL_TIMER_TIME),
        strokes: readField(parsed, rec, L_TOTAL_STROKES),
        calories: (cal != null && cal !== 0xFFFF) ? cal : null,
        startTime: readField(parsed, rec, L_START_TIME),
        timestamp: readField(parsed, rec, L_TIMESTAMP),
        origMessageIndex: mi,
        lapStart: lapStartIdx.has(mi),
      };
    });
    if (lengths.length && !lengths.some(l => l.lapStart)) lengths[0].lapStart = true;

    return { parsed, lengths, lapRec, lapRecs, sesRec, poolLenM, sessionInfo };
  }

  // ---------------------------------------------------------------------------
  // Derived per-length values
  // ---------------------------------------------------------------------------
  function lengthMetrics(model, len) {
    const dur = len.elapsedMs / 1000.0;
    const speed = dur > 0 ? model.poolLenM / dur : 0;
    const pacePer100 = speed > 0 ? 100.0 / speed : 0; // seconds/100m
    const cadence = dur > 0 ? len.strokes / (dur / 60.0) : 0;
    return { durationS: dur, speed, pacePer100, cadence };
  }

  function medianActiveDuration(model) {
    const durs = model.lengths.filter(l => l.active).map(l => l.elapsedMs / 1000.0).sort((a, b) => a - b);
    if (!durs.length) return 0;
    const m = Math.floor(durs.length / 2);
    return durs.length % 2 ? durs[m] : (durs[m - 1] + durs[m]) / 2;
  }

  // ---------------------------------------------------------------------------
  // Edit operations (mutate model.lengths)
  // ---------------------------------------------------------------------------
  // Fold length at index `src` into its neighbour at index `dst` (dst kept).
  function mergeInto(model, dstIdx, srcIdx) {
    const dst = model.lengths[dstIdx];
    const src = model.lengths[srcIdx];
    if (!dst || !src) return false;
    dst.elapsedMs += src.elapsedMs;
    dst.timerMs += src.timerMs;
    dst.strokes += src.strokes;
    if (dst.calories != null && src.calories != null) dst.calories += src.calories;
    // combined length ends when the later of the two ends
    if (src.timestamp != null && dst.timestamp != null) {
      dst.timestamp = Math.max(dst.timestamp, src.timestamp);
    }
    // it starts when the earlier of the two starts
    if (src.startTime != null && dst.startTime != null) {
      dst.startTime = Math.min(dst.startTime, src.startTime);
    }
    dst.lapStart = dst.lapStart || src.lapStart;
    model.lengths.splice(srcIdx, 1);
    return true;
  }

  // Merge a set of selected indices. Contiguous runs collapse into one length
  // each (folding all into the earliest of the run). Returns number removed.
  function mergeSelected(model, indices) {
    const sorted = [...new Set(indices)].sort((a, b) => a - b);
    // group into contiguous runs
    const runs = [];
    for (const i of sorted) {
      const last = runs[runs.length - 1];
      if (last && i === last[last.length - 1] + 1) last.push(i);
      else runs.push([i]);
    }
    let removed = 0;
    // process runs right-to-left so earlier indices stay valid
    for (const run of runs.reverse()) {
      if (run.length < 2) continue;
      const keep = run[0];
      for (let k = run.length - 1; k >= 1; k--) {
        mergeInto(model, keep, run[k]);
        removed++;
      }
    }
    return removed;
  }

  // Delete lengths at the given indices entirely (e.g. phantom lengths).
  function deleteLengths(model, indices) {
    const sorted = [...new Set(indices)].sort((a, b) => b - a);
    for (const i of sorted) model.lengths.splice(i, 1);
    if (model.lengths.length && !model.lengths.some(l => l.lapStart)) {
      model.lengths[0].lapStart = true;
    }
    return sorted.length;
  }

  // Set stroke on the given indices (or all if indices omitted).
  function setStroke(model, indices, stroke) {
    const set = indices ? new Set(indices) : null;
    model.lengths.forEach((L, i) => { if (!set || set.has(i)) L.swimStroke = stroke; });
  }
  function setStrokeAll(model, stroke) { setStroke(model, null, stroke); }

  // Snapshot / restore for undo (length objects hold primitives + a stable
  // recRef, so a shallow clone per length is a full logical copy).
  function snapshot(model) { return model.lengths.map(L => Object.assign({}, L)); }
  function restore(model, snap) { model.lengths = snap.map(L => Object.assign({}, L)); }

  function mergeWithPrevious(model, idx) {
    if (idx <= 0) return false;
    return mergeInto(model, idx - 1, idx);
  }
  function mergeWithNext(model, idx) {
    if (idx >= model.lengths.length - 1) return false;
    return mergeInto(model, idx, idx + 1);
  }

  // Split length at idx into two at `firstSeconds` (default = half).
  function splitLength(model, idx, firstSeconds) {
    const len = model.lengths[idx];
    if (!len) return false;
    const totalS = len.elapsedMs / 1000.0;
    let f = (firstSeconds == null) ? totalS / 2 : firstSeconds;
    f = Math.max(0.5, Math.min(totalS - 0.5, f));
    const firstMs = Math.round(f * 1000);
    const secondMs = len.elapsedMs - firstMs;
    const frac = firstMs / len.elapsedMs;
    const firstStrokes = Math.max(0, Math.round(len.strokes * frac));
    const secondStrokes = Math.max(0, len.strokes - firstStrokes);
    const firstTimer = Math.round(len.timerMs * frac);
    const secondTimer = len.timerMs - firstTimer;
    let firstCal = null, secondCal = null;
    if (len.calories != null) {
      firstCal = Math.round(len.calories * frac);
      secondCal = len.calories - firstCal;
    }
    const midTime = (len.startTime != null) ? len.startTime + Math.round(firstMs / 1000) : null;

    const a = Object.assign({}, len, {
      id: (model._nextId = (model._nextId || 1e6) + 1),
      elapsedMs: firstMs, timerMs: firstTimer, strokes: firstStrokes,
      calories: firstCal, timestamp: midTime,
    });
    const b = Object.assign({}, len, {
      id: (model._nextId = (model._nextId || 1e6) + 1),
      elapsedMs: secondMs, timerMs: secondTimer, strokes: secondStrokes,
      calories: secondCal, startTime: midTime,
    });
    model.lengths.splice(idx, 1, a, b);
    return true;
  }

  // Auto-merge: fold each abnormally short active length into the same-stroke
  // neighbour whose combined duration lands closest to the median (bias to the
  // previous length, per the requested "併入前段" behaviour). Returns a log.
  function autoMerge(model, opts) {
    opts = opts || {};
    const median = medianActiveDuration(model);
    const shortThresh = opts.shortSeconds != null ? opts.shortSeconds : median * 0.6;
    const bandLo = (opts.bandLo != null ? opts.bandLo : 0.65) * median;
    const bandHi = (opts.bandHi != null ? opts.bandHi : 1.35) * median;
    const log = [];
    let changed = true;
    // repeat until stable (a merge can expose/resolve neighbours)
    let guard = 0;
    while (changed && guard++ < 1000) {
      changed = false;
      for (let i = 0; i < model.lengths.length; i++) {
        const L = model.lengths[i];
        if (!L.active) continue;
        if (L.elapsedMs / 1000.0 >= shortThresh) continue;
        // candidate neighbours: prev then next, same stroke, combined within band
        const cand = [];
        const prev = model.lengths[i - 1];
        const next = model.lengths[i + 1];
        if (prev && prev.active && prev.swimStroke === L.swimStroke) {
          const combo = (prev.elapsedMs + L.elapsedMs) / 1000.0;
          if (combo >= bandLo && combo <= bandHi) cand.push({ dir: 'prev', combo, bias: 0 });
        }
        if (next && next.active && next.swimStroke === L.swimStroke) {
          const combo = (next.elapsedMs + L.elapsedMs) / 1000.0;
          if (combo >= bandLo && combo <= bandHi) cand.push({ dir: 'next', combo, bias: 0.001 });
        }
        if (!cand.length) continue;
        // choose closest-to-median; tie-break toward prev (smaller bias)
        cand.sort((x, y) => (Math.abs(x.combo - median) + x.bias) - (Math.abs(y.combo - median) + y.bias));
        const pick = cand[0];
        if (pick.dir === 'prev') {
          log.push('第 ' + (i + 1) + ' 段 (' + fmtDur(L.elapsedMs) + ') 併入前段 → ' + pick.combo.toFixed(1) + 's');
          mergeWithPrevious(model, i);
        } else {
          log.push('第 ' + (i + 1) + ' 段 (' + fmtDur(L.elapsedMs) + ') 併入後段 → ' + pick.combo.toFixed(1) + 's');
          mergeWithNext(model, i);
        }
        changed = true;
        break; // indices shifted; restart scan
      }
    }
    // report anything still short & unresolved
    model.lengths.forEach((L, i) => {
      if (L.active && L.elapsedMs / 1000.0 < shortThresh) {
        log.push('⚠ 第 ' + (i + 1) + ' 段仍偏短 (' + fmtDur(L.elapsedMs) + '，' + (SWIM_STROKE_NAMES[L.swimStroke] || L.swimStroke) + ')，找不到合適的同泳姿鄰段，請手動處理');
      }
    });
    return { log, median, shortThresh };
  }

  function fmtDur(ms) {
    const s = ms / 1000.0;
    return s.toFixed(1) + 's';
  }

  // Indices of active lengths whose pace is physically implausible: shorter
  // than `shortSeconds` AND clearly faster than the field (leftover phantom
  // lengths a merge could not resolve). Stroke-agnostic via median speed.
  function findAbnormalPace(model, shortSeconds) {
    const active = model.lengths.filter(l => l.active && l.elapsedMs > 0);
    if (!active.length) return [];
    const speeds = active.map(l => model.poolLenM / (l.elapsedMs / 1000)).sort((a, b) => a - b);
    const medSpeed = speeds[Math.floor(speeds.length / 2)];
    const out = [];
    model.lengths.forEach((L, i) => {
      if (!L.active || L.elapsedMs <= 0) return;
      const dur = L.elapsedMs / 1000;
      const sp = model.poolLenM / dur;
      if (dur < shortSeconds && sp > medSpeed * 1.6) out.push(i);
    });
    return out;
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  function summary(model) {
    const active = model.lengths.filter(l => l.active);
    const totalStrokes = model.lengths.reduce((a, l) => a + (l.strokes || 0), 0);
    const movingMs = active.reduce((a, l) => a + l.elapsedMs, 0);
    const distance = active.length * model.poolLenM;
    const avgSpl = active.length ? totalStrokes / active.length : 0;
    const distPerStroke = avgSpl > 0 ? model.poolLenM / avgSpl : 0;
    return {
      totalLengths: model.lengths.length,
      activeLengths: active.length,
      distance,
      poolLenM: model.poolLenM,
      totalStrokes,
      movingMs,
      avgSpl,
      distPerStroke,
      avgHr: model.sessionInfo ? model.sessionInfo.avgHr : null,
      calories: model.sessionInfo ? model.sessionInfo.calories : null,
      startTime: model.sessionInfo ? model.sessionInfo.startTime : null,
      totalTimerMs: (model.sessionInfo && model.sessionInfo.totalTimerMs != null)
        ? model.sessionInfo.totalTimerMs : movingMs,
    };
  }

  // ---------------------------------------------------------------------------
  // Export: re-encode a byte-faithful .fit reflecting the edited model.
  // ---------------------------------------------------------------------------
  function exportFit(model) {
    const parsed = model.parsed;
    const src = parsed.bytes;

    // Map: which original records are length messages (the contiguous block we replace)
    const lengthRecSet = new Set(parsed.records.filter(r => !r.isDefinition && r.globalNum === MESG_LENGTH));
    const firstLengthRec = parsed.records.find(r => lengthRecSet.has(r));

    const activeCount = model.lengths.filter(l => l.active).length;
    const totalCount = model.lengths.length;
    const totalStrokes = model.lengths.reduce((a, l) => a + (l.strokes || 0), 0);
    const distRaw = Math.round(activeCount * model.poolLenM * 100);

    // Encode one length message from its template record + edited values.
    function encodeLength(len, seqIndex) {
      const tpl = len.recRef;
      const size = tpl.rawEnd - tpl.rawStart;
      const buf = src.slice(tpl.rawStart, tpl.rawEnd); // Uint8Array copy
      const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      const durS = len.elapsedMs / 1000.0;
      const speedRaw = durS > 0 ? Math.round((model.poolLenM / durS) * 1000) : 0;
      const cadRaw = durS > 0 ? Math.round(len.strokes / (durS / 60.0)) : 0;
      writeField(dv, tpl, L_MESSAGE_INDEX, seqIndex);
      writeField(dv, tpl, L_TOTAL_ELAPSED_TIME, len.elapsedMs);
      writeField(dv, tpl, L_TOTAL_TIMER_TIME, len.timerMs);
      writeField(dv, tpl, L_TOTAL_STROKES, len.strokes);
      writeField(dv, tpl, L_AVG_SPEED, speedRaw);
      if (tpl.fieldOffsets[L_AVG_SWIM_CADENCE]) writeField(dv, tpl, L_AVG_SWIM_CADENCE, cadRaw);
      if (len.startTime != null) writeField(dv, tpl, L_START_TIME, len.startTime);
      if (len.timestamp != null) writeField(dv, tpl, L_TIMESTAMP, len.timestamp);
      if (len.calories != null && tpl.fieldOffsets[L_TOTAL_CALORIES]) {
        writeField(dv, tpl, L_TOTAL_CALORIES, len.calories);
      }
      return buf;
    }

    // Encode lap / session with patched aggregates.
    function encodePatched(rec, patches) {
      const buf = src.slice(rec.rawStart, rec.rawEnd);
      const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      for (const [defNum, value] of patches) {
        if (rec.fieldOffsets[defNum]) writeField(dv, rec, defNum, value);
      }
      return buf;
    }

    // Walk original records; rebuild the data section.
    const parts = [];
    let emittedLengths = false;
    let seq = 0;
    for (const rec of parsed.records) {
      if (!rec.isDefinition && lengthRecSet.has(rec)) {
        // Replace the whole length block once, at the position of the first length.
        if (!emittedLengths) {
          for (const len of model.lengths) parts.push(encodeLength(len, seq++));
          emittedLengths = true;
        }
        // consumed/removed original length slots emit nothing
        continue;
      }
      if (!rec.isDefinition && rec === model.lapRec) {
        parts.push(encodePatched(rec, [
          [LAP_TOTAL_DISTANCE, distRaw],
          [LAP_TOTAL_CYCLES, totalStrokes],
          [LAP_NUM_LENGTHS, totalCount],
          [LAP_NUM_ACTIVE_LENGTHS, activeCount],
        ]));
        continue;
      }
      if (!rec.isDefinition && rec === model.sesRec) {
        parts.push(encodePatched(rec, [
          [SES_TOTAL_DISTANCE, distRaw],
          [SES_TOTAL_CYCLES, totalStrokes],
          [SES_NUM_ACTIVE_LENGTHS, activeCount],
        ]));
        continue;
      }
      parts.push(src.slice(rec.rawStart, rec.rawEnd));
    }

    // Assemble: header + data + trailing CRC.
    const dataLen = parts.reduce((a, p) => a + p.length, 0);
    const out = new Uint8Array(parsed.headerSize + dataLen + 2);
    // copy original header verbatim, then fix data_size + header CRC
    out.set(src.slice(0, parsed.headerSize), 0);
    const odv = new DataView(out.buffer);
    odv.setUint32(4, dataLen, true);
    if (parsed.headerSize === 14) {
      const hcrc = crc16(out, 0, 12);
      odv.setUint16(12, hcrc, true);
    }
    // data section
    let cursor = parsed.headerSize;
    for (const p of parts) { out.set(p, cursor); cursor += p.length; }
    // trailing file CRC over header+data
    const fcrc = crc16(out, 0, cursor);
    odv.setUint16(cursor, fcrc, true);

    return out;
  }

  const api = {
    parse, buildModel, lengthMetrics, medianActiveDuration,
    mergeInto, mergeWithPrevious, mergeWithNext, mergeSelected,
    splitLength, deleteLengths, setStroke, setStrokeAll, autoMerge,
    findAbnormalPace, snapshot, restore, summary, exportFit, readField,
    SWIM_STROKE_NAMES,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FitCore = api;
})(typeof window !== 'undefined' ? window : this);
