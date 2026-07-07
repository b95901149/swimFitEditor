/* ui.js — Visual editor UI layer over FitCore. No build magic: plain DOM. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const FIT_EPOCH = 631065600; // seconds between Unix and FIT epoch (1989-12-31 UTC)
  const strokeName = FitCore.SWIM_STROKE_NAMES;
  const strokeZh = { 0:'自由式',1:'仰式',2:'蛙式',3:'蝶式',4:'drill',5:'混合',6:'個人混合',255:'—' };

  let originalAB = null, model = null, fileName = 'activity.fit';
  let selected = new Set();      // selected length ids
  let history = [];              // undo stack of snapshots

  // ---- formatting ----
  function fitToDate(fitTs) { return fitTs == null ? null : new Date((FIT_EPOCH + fitTs) * 1000); }
  function fmtClock(fitTs) {
    const d = fitToDate(fitTs); if (!d) return '—';
    return d.toLocaleTimeString('zh-Hant', { hour12: false });
  }
  function fmtDateTime(fitTs) {
    const d = fitToDate(fitTs); if (!d) return '—';
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function fmtDur(s) { const m = Math.floor(s/60), r = s-m*60; return m>0 ? `${m}:${r.toFixed(1).padStart(4,'0')}` : `${r.toFixed(1)}s`; }
  function fmtMMSS(s) { const m = Math.floor(s/60), r = Math.round(s-m*60); return `${m}:${String(r).padStart(2,'0')}`; }
  function fmtPace(sp100) { return (!sp100||!isFinite(sp100)) ? '—' : fmtMMSS(sp100); }

  // ---- load / reset ----
  function loadBuffer(ab, name) { originalAB = ab.slice(0); fileName = name || 'activity.fit'; rebuild(ab); }
  function rebuild(ab) {
    const parsed = FitCore.parse(ab);
    model = FitCore.buildModel(parsed);
    selected.clear(); history = [];
    $('app').classList.remove('hidden'); $('drop').classList.add('hidden');
    $('fname').textContent = fileName;
    renderAll();
    log('已載入：' + model.lengths.length + ' 趟，泳池 ' + model.poolLenM + ' m。');
    log('中位趟時間 ' + FitCore.medianActiveDuration(model).toFixed(1) + ' s。可直接按「⚡ 自動合併短趟」。');
  }
  function pushHistory() { history.push(FitCore.snapshot(model)); if (history.length > 100) history.shift(); $('undoBtn').disabled = false; }
  function shortThreshold() { return parseFloat($('thresh').value) || 30; }

  // ---- selection helpers ----
  function selectedIndices() {
    const out = [];
    model.lengths.forEach((L, i) => { if (selected.has(L.id)) out.push(i); });
    return out;
  }
  function updateSelInfo() {
    const n = selected.size;
    $('selinfo').innerHTML = n ? `已選取 <b>${n}</b> 段` : '未選取';
    $('mergeBtn').disabled = n < 2 || !contiguousSelectable();
    $('splitBtn').disabled = n < 1;
    $('delBtn').disabled = n < 1;
    $('strokeSelBtn').disabled = n < 1;
  }
  function contiguousSelectable() {
    const idx = selectedIndices();
    return idx.some((v, k) => k > 0 && v === idx[k-1] + 1); // at least one adjacent pair
  }

  // ---- render ----
  function renderAll() { renderCards(); renderChart(); renderTable(); updateSelInfo(); renderLegend(); }

  function renderCards() {
    const s = FitCore.summary(model);
    const origActive = model.parsed.records.filter(r => !r.isDefinition && r.globalNum === 101).length;
    const cards = [
      ['Workout Date', fmtDateTime(s.startTime), null],
      ['Pool Length', s.poolLenM + 'm', null],
      ['Total Time', fmtMMSS(s.totalTimerMs/1000), null],
      ['Total Lengths', s.activeLengths, origActive],
      ['Total Distance', s.distance + 'm', origActive * s.poolLenM + 'm'],
      ['Avg. Pace', fmtPace((s.totalTimerMs/1000)/(s.distance/100)) + '/100m', null],
      ['Avg. SPL', s.avgSpl.toFixed(1) + '/length', null],
      ['Avg. Dist/Stroke', s.distPerStroke.toFixed(2) + 'm', null],
      ['Avg. Heartrate', s.avgHr != null ? s.avgHr + ' bpm' : '—', null],
      ['Calories', s.calories != null ? s.calories + ' kcal' : '—', null],
    ];
    $('cards').innerHTML = cards.map(([k,v,orig]) => {
      let d = '';
      if (orig != null) d = (String(v)!==String(orig)) ? `<div class="d up">原始 ${orig}</div>` : `<div class="d same">未變動</div>`;
      return `<div class="card"><div class="k">${k}</div><div class="v">${v}</div>${d}</div>`;
    }).join('');
  }

  function renderLegend() {
    const used = [...new Set(model.lengths.map(l => l.swimStroke))].filter(s => s != null && s !== 255);
    $('legend').innerHTML = used.map(s => `<span><i style="background:var(--s${s})"></i>${strokeZh[s]||strokeName[s]}</span>`).join('')
      + `<span><i style="background:var(--bg);border:1.5px solid var(--sel)"></i>已選取</span>`;
  }

  function renderChart() {
    const svg = $('chart');
    const n = model.lengths.length;
    const H = 380, padL = 44, padR = 12, padT = 14, padB = 30;
    const W = Math.max(svg.clientWidth || 900, padL + padR + n * 8);
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const thr = shortThreshold();

    const durs = model.lengths.map(l => l.elapsedMs / 1000);
    const maxDur = Math.max(70, Math.ceil(Math.max(...durs, 0) / 10) * 10);
    const y = v => padT + plotH - (v / maxDur) * plotH;
    const bw = plotW / n;
    const barW = Math.max(2, bw * 0.78);

    let el = '';
    // y grid + labels
    for (let v = 0; v <= maxDur; v += 10) {
      el += `<line class="grid" x1="${padL}" y1="${y(v)}" x2="${W-padR}" y2="${y(v)}"/>`;
      el += `<text class="axis" x="${padL-6}" y="${y(v)+3}" text-anchor="end">${v}</text>`;
    }
    el += `<text class="axis" transform="translate(12,${padT+plotH/2}) rotate(-90)" text-anchor="middle">Duration (seconds)</text>`;
    // bars
    model.lengths.forEach((L, i) => {
      const d = L.elapsedMs / 1000;
      const x = padL + i * bw + (bw - barW) / 2;
      const h = plotH - (y(d) - padT);
      const isSel = selected.has(L.id);
      const col = `var(--s${L.swimStroke != null && L.swimStroke <= 6 ? L.swimStroke : 4})`;
      const isShort = L.active && d < thr;
      const stroke = isSel ? 'var(--sel)' : (isShort ? 'var(--warn)' : 'rgba(0,0,0,.15)');
      const sw = isSel ? 2.5 : (isShort ? 1.5 : 0.5);
      const op = L.active ? 1 : 0.4;
      el += `<rect class="bar" data-i="${i}" x="${x.toFixed(1)}" y="${y(d).toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0,h).toFixed(1)}" rx="1.5" fill="${col}" fill-opacity="${op}" stroke="${stroke}" stroke-width="${sw}"/>`;
      // lap boundary dashed line before this length (interval start)
      if (L.lapStart) {
        const lx = padL + i * bw + 0.5;
        el += `<line class="lap" x1="${lx.toFixed(1)}" y1="${padT}" x2="${lx.toFixed(1)}" y2="${padT+plotH}"/>`;
      }
      // x labels every few
      const step = n > 40 ? 2 : 1;
      if (i % step === 0) el += `<text class="axis" x="${(x+barW/2).toFixed(1)}" y="${H-padB+14}" text-anchor="middle">${i+1}</text>`;
    });
    el += `<text class="axis" x="${padL+plotW/2}" y="${H-2}" text-anchor="middle">Length</text>`;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('preserveAspectRatio', 'xMinYMid meet');
    svg.style.width = W + 'px';
    svg.innerHTML = el;
    attachChartEvents();
  }

  // Wire chart interaction once; the SVG node itself is stable across renders.
  function attachChartEvents() {
    const svg = $('chart');
    if (svg._wired) return;
    svg._wired = true;
    svg.addEventListener('dblclick', e => {
      const bar = e.target.closest('.bar'); if (!bar) return;
      const i = parseInt(bar.dataset.i, 10);
      pushHistory(); FitCore.splitLength(model, i);
      log(`第 ${i+1} 段（點兩下）平均分割成兩段。`);
      selected.clear(); renderAll();
    });
    svg.addEventListener('click', e => {
      const bar = e.target.closest('.bar'); if (!bar) { selected.clear(); renderAll(); return; }
      const i = parseInt(bar.dataset.i, 10);
      const L = model.lengths[i];
      if (e.shiftKey && selected.size) {
        // range select from last anchor
        const anchor = model.lengths.findIndex(x => x.id === (svg._anchorId ?? L.id));
        const [a, b] = [Math.min(anchor, i), Math.max(anchor, i)];
        for (let k = a; k <= b; k++) selected.add(model.lengths[k].id);
      } else {
        if (selected.has(L.id)) selected.delete(L.id); else selected.add(L.id);
        svg._anchorId = L.id;
      }
      renderAll();
    });
    svg.addEventListener('mousemove', e => {
      const bar = e.target.closest('.bar'); const tip = $('tip');
      if (!bar) { tip.style.display = 'none'; return; }
      const i = parseInt(bar.dataset.i, 10), L = model.lengths[i], m = FitCore.lengthMetrics(model, L);
      tip.innerHTML = `<b>#${i+1}</b> ${strokeZh[L.swimStroke]||strokeName[L.swimStroke]}<br>時間 ${fmtDur(m.durationS)}｜划手 ${L.strokes}<br>速度 ${m.speed.toFixed(3)} m/s｜配速 ${fmtPace(m.pacePer100)}/100m${L.active?'':'<br>(休息/idle)'}`;
      tip.style.display = 'block';
      tip.style.left = Math.min(e.clientX + 14, innerWidth - 190) + 'px';
      tip.style.top = (e.clientY + 14) + 'px';
    });
    svg.addEventListener('mouseleave', () => { $('tip').style.display = 'none'; });
  }

  function renderTable() {
    const thr = shortThreshold();
    $('rows').innerHTML = model.lengths.map((L, i) => {
      const m = FitCore.lengthMetrics(model, L);
      const isShort = L.active && m.durationS < thr;
      const isFast = L.active && m.speed > 0.9 && m.durationS < thr;
      const cls = (isFast ? 'fast ' : isShort ? 'short ' : '') + (selected.has(L.id) ? 'selected' : '');
      const flag = isFast ? '<span class="badge fast">配速異常</span>' : isShort ? '<span class="badge short">偏短</span>' : '';
      const sel = `<input type="checkbox" data-act="sel" data-i="${i}" ${selected.has(L.id)?'checked':''}>`;
      return `<tr class="${cls}">
        <td>${sel}</td><td>${i+1}${L.lapStart?' ▸':''}</td>
        <td class="l">${fmtClock(L.startTime)}</td>
        <td class="l">${strokeZh[L.swimStroke]||strokeName[L.swimStroke]}</td>
        <td>${fmtDur(m.durationS)}</td><td>${L.strokes}</td>
        <td>${m.speed.toFixed(3)} m/s</td><td>${fmtPace(m.pacePer100)}</td><td>${Math.round(m.cadence)}</td>
        <td>${flag}</td>
        <td class="actions">
          <button class="small" data-act="up" data-i="${i}" ${i===0?'disabled':''}>▲併上</button>
          <button class="small" data-act="down" data-i="${i}" ${i===model.lengths.length-1?'disabled':''}>▼併下</button>
          <button class="small" data-act="split" data-i="${i}">✂</button>
        </td></tr>`;
    }).join('');
  }

  function log(msg, cls) { const d = document.createElement('div'); if (cls) d.className = cls; d.textContent = msg; $('log').prepend(d); }

  // ---- actions ----
  function doMergeSelected() {
    const idx = selectedIndices(); if (idx.length < 2) return;
    pushHistory(); const removed = FitCore.mergeSelected(model, idx);
    log(`合併選取：移除 ${removed} 段。`); selected.clear(); renderAll();
  }
  function doSplitSelected() {
    const idx = selectedIndices(); if (!idx.length) return;
    pushHistory();
    // split from right to left so indices stay valid
    idx.sort((a,b)=>b-a).forEach(i => FitCore.splitLength(model, i));
    log(`分割選取：${idx.length} 段各分成兩段。`); selected.clear(); renderAll();
  }
  function doDeleteSelected() {
    const idx = selectedIndices(); if (!idx.length) return;
    pushHistory(); const n = FitCore.deleteLengths(model, idx);
    log(`刪除 ${n} 段。`); selected.clear(); renderAll();
  }
  function doDeleteFast() {
    const idx = FitCore.findAbnormalPace(model, shortThreshold());
    if (!idx.length) { log('沒有偵測到配速異常的短趟。', 'warn'); return; }
    const lostS = idx.reduce((a, i) => a + model.lengths[i].elapsedMs / 1000, 0);
    if (!confirm(`偵測到 ${idx.length} 段配速異常的短趟（合計 ${lostS.toFixed(1)} 秒）。\n刪除後總距離會少 ${idx.length * model.poolLenM} m。\n\n注意：若這些其實是被拆開的真實趟，用「合併」比刪除更正確。確定刪除？`)) return;
    pushHistory(); const n = FitCore.deleteLengths(model, idx);
    log(`刪除 ${n} 段配速異常趟。`); selected.clear(); renderAll();
  }
  function doStroke(all) {
    const stroke = parseInt($('strokeSel').value, 10);
    if (all) { pushHistory(); FitCore.setStrokeAll(model, stroke); log(`一鍵：全部 ${model.lengths.length} 段改為 ${strokeZh[stroke]}。`); }
    else { const idx = selectedIndices(); if (!idx.length) return; pushHistory(); FitCore.setStroke(model, idx, stroke); log(`選取 ${idx.length} 段改為 ${strokeZh[stroke]}。`); }
    renderAll();
  }
  function doAuto() {
    pushHistory();
    const res = FitCore.autoMerge(model, { shortSeconds: shortThreshold() });
    res.log.forEach(x => log(x, x.startsWith('⚠') ? 'warn' : null));
    log(`自動合併完成（門檻 ${res.shortThresh.toFixed(1)}s，中位 ${res.median.toFixed(1)}s）。`);
    selected.clear(); renderAll();
  }
  function doUndo() {
    if (!history.length) return;
    FitCore.restore(model, history.pop());
    $('undoBtn').disabled = history.length === 0;
    selected.clear(); log('已復原上一步。'); renderAll();
  }
  function doReset() { if (originalAB) { rebuild(originalAB.slice(0)); log('已還原到原始資料。'); } }
  function doDownload() {
    const out = FitCore.exportFit(model);
    const blob = new Blob([out], { type: 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName.replace(/\.fit$/i, '') + '_fixed.fit';
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    const s = FitCore.summary(model);
    log(`已下載修正檔：${a.download}（${s.activeLengths} 趟，${s.distance} m）。`);
  }

  // ---- wire up ----
  $('mergeBtn').addEventListener('click', doMergeSelected);
  $('splitBtn').addEventListener('click', doSplitSelected);
  $('delBtn').addEventListener('click', doDeleteSelected);
  $('delFastBtn').addEventListener('click', doDeleteFast);
  $('strokeSelBtn').addEventListener('click', () => doStroke(false));
  $('strokeAllBtn').addEventListener('click', () => doStroke(true));
  $('autoBtn').addEventListener('click', doAuto);
  $('undoBtn').addEventListener('click', doUndo);
  $('resetBtn').addEventListener('click', doReset);
  $('dlBtn').addEventListener('click', doDownload);
  $('thresh').addEventListener('input', () => { renderChart(); renderTable(); });
  window.addEventListener('resize', () => { if (model) renderChart(); });

  $('rows').addEventListener('click', e => {
    const btn = e.target.closest('button'); if (!btn) return;
    const i = parseInt(btn.dataset.i, 10), act = btn.dataset.act;
    if (act === 'up') { pushHistory(); FitCore.mergeWithPrevious(model, i); log(`第 ${i+1} 段併入上一段。`); selected.clear(); renderAll(); }
    else if (act === 'down') { pushHistory(); FitCore.mergeWithNext(model, i); log(`第 ${i+1} 段併入下一段。`); selected.clear(); renderAll(); }
    else if (act === 'split') {
      const L = model.lengths[i], totalS = (L.elapsedMs/1000).toFixed(1);
      const ans = prompt(`把第 ${i+1} 段 (${totalS}s) 分成兩段。\n輸入第一段秒數（留空＝平分）：`, (L.elapsedMs/2000).toFixed(1));
      if (ans === null) return;
      pushHistory(); FitCore.splitLength(model, i, ans.trim()===''?null:parseFloat(ans));
      log(`第 ${i+1} 段分割。`); renderAll();
    }
  });
  $('rows').addEventListener('change', e => {
    const cb = e.target.closest('input[data-act="sel"]'); if (!cb) return;
    const L = model.lengths[parseInt(cb.dataset.i, 10)];
    if (cb.checked) selected.add(L.id); else selected.delete(L.id);
    renderChart(); updateSelInfo();
    e.target.closest('tr').classList.toggle('selected', cb.checked);
  });

  // ---- file input / drag drop ----
  const drop = $('drop'), fileInput = $('file');
  drop.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', e => { const f = e.target.files[0]; if (f) readFile(f); });
  ['dragenter','dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('hover'); }));
  ['dragleave','drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('hover'); }));
  drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) readFile(f); });
  document.addEventListener('dragover', e => { if (!$('app').classList.contains('hidden')) e.preventDefault(); });
  document.addEventListener('drop', e => { if (!$('app').classList.contains('hidden')) { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) readFile(f); } });
  function readFile(f) { const r = new FileReader(); r.onload = () => { try { loadBuffer(r.result, f.name); } catch (err) { alert('無法解析：' + err.message); } }; r.readAsArrayBuffer(f); }

  // ---- Electron file-association hook (no-op in a plain browser) ----
  if (window.electronAPI && window.electronAPI.onOpenFile) {
    window.electronAPI.onOpenFile((bytes, name) => {
      try {
        const ab = bytes.buffer ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes;
        loadBuffer(ab, name || 'activity.fit');
      } catch (err) { alert('無法解析：' + err.message); }
    });
  }
})();
