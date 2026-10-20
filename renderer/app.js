// Photo Lab 畫面邏輯
import { Pipeline } from './pipeline.js';
import { decode } from './decode.js';
import { fmtShutter } from './exif.js';
import { ADJ, GROUPS, SCHEMA_VERSION, defaults, clone, isDefault, sanitize, fmtValue, History } from './settings.js';
import { RATIOS, ratioOf, fits, fitCrop, tryRect, rotatedBounds, resizeFromCorner, scaleCrop, defaultCrop } from './crop.js';

const $ = (id) => document.getElementById(id);
const lab = window.lab;
const store = {
  get(k, d) { try { const v = localStorage.getItem('photolab.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('photolab.' + k, JSON.stringify(v)); } catch { /* 存不了就算了 */ } },
};

const cv = $('img'), ov = $('overlay'), ox = ov.getContext('2d');
let pipe;
try { pipe = new Pipeline(cv); } catch (e) { fatal(e); }

const st = {
  files: [], idx: -1, path: null, W: 0, H: 0, info: null,
  S: null, hist: null, histories: new Map(),
  cropMode: false, orig: false, drag: null, loadToken: 0, saveTimer: null, dirty: false,
};
const frameOf = () => {
  const c = st.S.crop;
  if (st.cropMode) { const b = rotatedBounds(c.angle, st.W, st.H); return { cx: 0, cy: 0, w: b.w, h: b.h }; }
  return { cx: c.cx, cy: c.cy, w: c.w, h: c.h };
};
const dirOf = (p) => p.slice(0, Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/')));
const nameOf = (p) => p.slice(Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/')) + 1);

// ---------- 面板 ----------
for (const g of GROUPS) {
  const el = $(g.panel);
  el.insertAdjacentHTML('beforeend', `<div class="sub">${g.title}</div>`);
  for (const k of g.keys) {
    const [mn, mx, d, n, step] = ADJ[k];
    el.insertAdjacentHTML('beforeend', `<div class="row" id="row_${k}"><span class="name" data-k="${k}">${n}</span><input type="range" id="${k}" min="${mn}" max="${mx}" step="${step || 1}" value="${d}"><output id="o_${k}">${fmtValue(k, d)}</output></div>`);
  }
}
for (const r of RATIOS) $('ratio').insertAdjacentHTML('beforeend', `<option value="${r.v}">${r.label}</option>`);

function syncUI() {
  const S = st.S;
  for (const k in ADJ) {
    $(k).value = S[k];
    $('o_' + k).textContent = fmtValue(k, S[k]);
    $('row_' + k).classList.toggle('changed', S[k] !== ADJ[k][2]);
  }
  $('ratio').value = S.crop.ratio;
  $('angle').value = S.crop.angle;
  $('o_angle').textContent = `${S.crop.angle.toFixed(1)}°`;
  $('flip').disabled = S.crop.ratio === 'free';
}

function drawHistory() {
  const h = st.hist;
  $('hist').innerHTML = h ? h.items.map((it, i) => `<div class="hist-item ${i === h.cur ? 'cur' : ''} ${i > h.cur ? 'future' : ''}" data-i="${i}">${it.n}</div>`).reverse().join('') : '';
  $('undo').disabled = !h?.canUndo;
  $('redo').disabled = !h?.canRedo;
}

function commit(label) {
  st.hist.push(label, st.S);
  drawHistory();
  scheduleSave();
}

function applyState(s) {
  st.S = s;
  syncUI(); layout(); drawHistory(); scheduleSave();
}

for (const k in ADJ) {
  const el = $(k);
  let before = null;
  el.addEventListener('pointerdown', () => { before = st.S?.[k]; });
  el.addEventListener('input', () => {
    if (!st.S) return;
    st.S[k] = +el.value;
    $('o_' + k).textContent = fmtValue(k, st.S[k]);
    $('row_' + k).classList.toggle('changed', st.S[k] !== ADJ[k][2]);
    redraw();
  });
  el.addEventListener('change', () => {
    if (!st.S || st.S[k] === before) return;
    commit(`${ADJ[k][3]} ${fmtValue(k, st.S[k])}`);
    before = st.S[k];
  });
  const reset = () => {
    if (!st.S || st.S[k] === ADJ[k][2]) return;
    st.S[k] = ADJ[k][2]; syncUI(); redraw(); commit(`${ADJ[k][3]} 歸零`);
  };
  el.addEventListener('dblclick', reset);
  $('row_' + k).querySelector('.name').addEventListener('dblclick', reset);
}

// ---------- 版面與繪製 ----------
function layout() {
  if (!st.S) return;
  const view = $('view'), f = frameOf(), dpr = window.devicePixelRatio || 1;
  const pad = 24, aw = Math.max(50, view.clientWidth - pad * 2), ah = Math.max(50, view.clientHeight - pad * 2);
  const scale = Math.min(aw / f.w, ah / f.h, 1 / dpr * 2); // 最多放大到 2 倍像素，避免小圖糊成一片
  const cssW = Math.max(1, Math.round(f.w * scale)), cssH = Math.max(1, Math.round(f.h * scale));
  for (const c of [cv, ov]) {
    c.style.width = cssW + 'px'; c.style.height = cssH + 'px';
    const pw = Math.round(cssW * dpr), ph = Math.round(cssH * dpr);
    if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
  }
  redrawNow();
}

let raf = 0, histRaf = 0;
function redraw() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; redrawNow(); }); }
function redrawNow() {
  if (!st.S) return;
  const f = frameOf();
  pipe.draw(st.S, f, { orig: st.orig });
  drawOverlay(f);
  if (!histRaf) histRaf = requestAnimationFrame(() => { histRaf = 0; drawHistogram(); });
}

function drawHistogram() {
  if (!st.S) return;
  const c = st.S.crop;
  const h = pipe.histogram(st.S, { cx: c.cx, cy: c.cy, w: c.w, h: c.h }, { orig: st.orig });
  const g = $('hg').getContext('2d'), W = $('hg').width, H = $('hg').height;
  g.clearRect(0, 0, W, H);
  if (!h) return;
  let mx = 1;
  for (const ch of [h.r, h.g, h.b]) for (let i = 2; i < 254; i++) mx = Math.max(mx, ch[i]);
  g.globalCompositeOperation = 'lighter';
  [[h.r, '#e5484d'], [h.g, '#46a758'], [h.b, '#3e63dd']].forEach(([ch, col]) => {
    g.fillStyle = col + 'b0';
    g.beginPath(); g.moveTo(0, H);
    for (let i = 0; i < 256; i++) g.lineTo((i / 255) * W, H - Math.min(H - 2, (ch[i] / mx) * (H - 6)));
    g.lineTo(W, H); g.fill();
  });
  g.globalCompositeOperation = 'source-over';
  const clip = $('clip');
  clip.textContent = `過曝 ${(h.clipHi * 100).toFixed(1)}%　死黑 ${(h.clipLo * 100).toFixed(1)}%`;
  clip.classList.toggle('warn', h.clipHi > 0.01 || h.clipLo > 0.01);
}

// 畫面座標 ↔ 旋轉後座標
function toCanvas(f, x, y) { return [((x - f.cx) / f.w + 0.5) * ov.width, ((y - f.cy) / f.h + 0.5) * ov.height]; }
function fromEvent(e) {
  const f = frameOf(), b = ov.getBoundingClientRect();
  return { x: f.cx + ((e.clientX - b.left) / b.width - 0.5) * f.w, y: f.cy + ((e.clientY - b.top) / b.height - 0.5) * f.h };
}

function drawOverlay(f) {
  ox.clearRect(0, 0, ov.width, ov.height);
  if (!st.cropMode) return;
  const c = st.S.crop;
  const [x0, y0] = toCanvas(f, c.cx - c.w / 2, c.cy - c.h / 2), [x1, y1] = toCanvas(f, c.cx + c.w / 2, c.cy + c.h / 2);
  const w = x1 - x0, h = y1 - y0, dpr = window.devicePixelRatio || 1;
  ox.fillStyle = '#000000a8';
  ox.beginPath(); ox.rect(0, 0, ov.width, ov.height); ox.rect(x0, y0, w, h); ox.fill('evenodd');
  ox.strokeStyle = '#ffffff80'; ox.lineWidth = dpr; ox.beginPath();
  for (const t of [1 / 3, 2 / 3]) { ox.moveTo(x0 + w * t, y0); ox.lineTo(x0 + w * t, y1); ox.moveTo(x0, y0 + h * t); ox.lineTo(x1, y0 + h * t); }
  ox.stroke();
  ox.strokeStyle = '#fff'; ox.lineWidth = 1.5 * dpr; ox.strokeRect(x0, y0, w, h);
  const L = 18 * dpr; ox.lineWidth = 4 * dpr; ox.beginPath();
  for (const [hx, hy, dx, dy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
    ox.moveTo(hx + dx * L, hy); ox.lineTo(hx, hy); ox.lineTo(hx, hy + dy * L);
  }
  ox.stroke();
}

// ---------- 裁切 ----------
function setCropMode(on) {
  if (!st.S || st.cropMode === on) return;
  st.cropMode = on;
  $('cropBtn').classList.toggle('on', on);
  $('cropBtn').textContent = on ? '✓ 完成裁切' : '⛶ 裁切';
  $('cropRow').classList.toggle('show', on);
  $('cw').classList.toggle('crop', on);
  ov.style.cursor = 'default';
  layout();
}
$('cropBtn').onclick = () => setCropMode(!st.cropMode);

function hitTest(p) {
  const c = st.S.crop, f = frameOf(), tol = (14 / ov.getBoundingClientRect().width) * f.w;
  for (const [ux, uy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    if (Math.abs(p.x - (c.cx + (ux * c.w) / 2)) < tol && Math.abs(p.y - (c.cy + (uy * c.h) / 2)) < tol) return { type: 'corner', ux, uy };
  }
  if (Math.abs(p.x - c.cx) < c.w / 2 && Math.abs(p.y - c.cy) < c.h / 2) return { type: 'move' };
  return null;
}
ov.addEventListener('pointerdown', (e) => {
  if (!st.cropMode) return;
  const p = fromEvent(e), h = hitTest(p);
  if (!h) return;
  st.drag = { ...h, p0: p, r0: { ...st.S.crop } };
  try { ov.setPointerCapture(e.pointerId); } catch { /* 觸控筆等特殊輸入抓不到也照樣可拖 */ }
  e.preventDefault();
});
ov.addEventListener('pointermove', (e) => {
  if (!st.cropMode) return;
  const p = fromEvent(e);
  if (!st.drag) {
    const h = hitTest(p);
    ov.style.cursor = !h ? 'default' : h.type === 'move' ? 'move' : h.ux * h.uy > 0 ? 'nwse-resize' : 'nesw-resize';
    return;
  }
  const C = st.S.crop, d = st.drag, r0 = d.r0, cur = { cx: C.cx, cy: C.cy, w: C.w, h: C.h };
  if (d.type === 'move') {
    // x、y 輪流走幾次：撞到斜邊時能沿著邊滑，不會卡住
    const tx = r0.cx + p.x - d.p0.x, ty = r0.cy + p.y - d.p0.y;
    for (let i = 0; i < 4; i++) {
      tryRect(C, { ...C }, { cx: tx, cy: C.cy, w: C.w, h: C.h }, st.W, st.H);
      tryRect(C, { ...C }, { cx: C.cx, cy: ty, w: C.w, h: C.h }, st.W, st.H);
    }
  } else {
    tryRect(C, cur, resizeFromCorner(r0, d.ux, d.uy, p, ratioOf(C, st.W, st.H), Math.min(st.W, st.H) * 0.03), st.W, st.H);
  }
  redraw();
});
const endDrag = () => {
  if (!st.drag) return;
  const r0 = st.drag.r0, c = st.S.crop;
  st.drag = null;
  if (r0.cx !== c.cx || r0.cy !== c.cy || r0.w !== c.w || r0.h !== c.h) commit('調整裁切框');
};
ov.addEventListener('pointerup', endDrag);
ov.addEventListener('pointercancel', endDrag);

const ang = $('angle');
let angBefore = 0;
ang.addEventListener('pointerdown', () => { angBefore = st.S?.crop.angle; });
ang.addEventListener('input', () => {
  if (!st.S) return;
  st.S.crop.angle = +ang.value;
  $('o_angle').textContent = `${st.S.crop.angle.toFixed(1)}°`;
  fitCrop(st.S.crop, st.W, st.H);
  layout();
});
ang.addEventListener('change', () => { if (st.S && st.S.crop.angle !== angBefore) { commit(`拉直 ${st.S.crop.angle.toFixed(1)}°`); angBefore = st.S.crop.angle; } });
ang.addEventListener('dblclick', () => { if (!st.S || !st.S.crop.angle) return; ang.value = 0; ang.dispatchEvent(new Event('input')); commit('拉直歸零'); });
$('ratio').onchange = (e) => {
  const C = st.S.crop;
  C.ratio = e.target.value;
  // 直式照片選 16:9 會自動變 9:16，方向跟著照片走
  C.flip = C.ratio !== 'free' && ratioOf({ ...C, flip: false }, st.W, st.H) > 1 !== st.W / st.H > 1;
  fitCrop(C, st.W, st.H); syncUI(); redraw();
  commit('比例 ' + e.target.selectedOptions[0].text);
  e.target.blur();
};
$('flip').onclick = () => {
  const C = st.S.crop;
  if (C.ratio === 'free') return;
  C.flip = !C.flip; fitCrop(C, st.W, st.H); redraw();
  commit(C.w < C.h ? '改直式' : '改橫式');
};
$('cropReset').onclick = () => {
  st.S.crop = defaultCrop(st.W, st.H); syncUI(); layout(); commit('重設裁切');
};

// ---------- 復原／原圖 ----------
$('undo').onclick = () => { if (st.hist?.canUndo) applyState(st.hist.undo()); };
$('redo').onclick = () => { if (st.hist?.canRedo) applyState(st.hist.redo()); };
$('hist').onclick = (e) => { const i = e.target.dataset.i; if (i != null) applyState(st.hist.go(+i)); };
$('resetAll').onclick = () => {
  if (!st.S || isDefault(st.S, st.W, st.H)) return;
  st.S = defaults(st.W, st.H); syncUI(); layout(); commit('全部重設');
};
function setOrig(on) {
  if (!st.S || st.orig === on) return;
  st.orig = on;
  $('badge').style.display = on ? 'block' : 'none';
  $('baBtn').classList.toggle('on', on);
  redraw();
}
$('baBtn').addEventListener('pointerdown', () => setOrig(true));
for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) $('baBtn').addEventListener(ev, () => setOrig(false));

// ---------- 存設定（非破壞：原檔不動，設定寫在旁邊的 .photolab.json） ----------
function scheduleSave() {
  if (!st.path) return;
  st.dirty = true;
  clearTimeout(st.saveTimer);
  st.saveTimer = setTimeout(flushSave, 400);
}
async function flushSave() {
  clearTimeout(st.saveTimer);
  if (!st.dirty || !st.path || !st.S) return;
  st.dirty = false;
  const data = isDefault(st.S, st.W, st.H) ? null
    : { app: 'photo-lab', version: SCHEMA_VERSION, srcW: st.W, srcH: st.H, updated: new Date().toISOString(), settings: st.S };
  try { await lab.sidecarWrite(st.path, data); } catch (e) { toast(`調整設定存不進去：${e.message}`, true); }
}

// ---------- 開檔 ----------
function setBusy(text) {
  $('loading').hidden = !text;
  if (text) $('loadingText').textContent = text;
}

async function openList(files, idx = 0) {
  if (!files.length) return;
  st.files = files;
  await loadIndex(idx);
}

async function loadIndex(idx) {
  if (idx < 0 || idx >= st.files.length) return;
  await flushSave();
  const token = ++st.loadToken, path = st.files[idx];
  st.idx = idx;
  updateHeader(path);
  setBusy(/\.(cr3|cr2|nef|arw|dng|raf|orf|rw2|pef|srw)$/i.test(path) ? '解碼 RAW 中，大檔約需幾秒…' : '載入中…');
  try {
    const bytes = await lab.readFile(path);
    if (token !== st.loadToken) return;
    const img = await decode(path, bytes);
    if (token !== st.loadToken) { img.bitmap?.close(); return; }
    if (img.kind === 'raw') pipe.setLinear16(img.data, img.width, img.height);
    else { pipe.setSRGB8(img.bitmap); img.bitmap.close(); }
    const W = img.width, H = img.height;
    const side = await lab.sidecarRead(path);
    if (token !== st.loadToken) return;
    let S = sanitize(side?.settings, W, H);
    if (side?.srcW && (side.srcW !== W || side.srcH !== H)) S.crop = scaleCrop(S.crop, side.srcW, side.srcH, W, H);
    else if (!fits(S.crop, S.crop, W, H)) fitCrop(S.crop, W, H);
    Object.assign(st, { path, W, H, info: img.info, S, orig: false, dirty: false });
    st.hist = st.histories.get(path) || new History(S, side ? '開啟（含上次的調整）' : '匯入');
    if (st.histories.has(path)) st.S = st.hist.state;
    st.histories.set(path, st.hist);
    if (st.histories.size > 30) st.histories.delete(st.histories.keys().next().value);
    $('empty').hidden = true; $('cw').hidden = false;
    for (const id of ['cropBtn', 'baBtn', 'resetAll', 'exportBtn']) $(id).disabled = false;
    setCropMode(false);
    syncUI(); drawHistory(); updateHeader(path); renderInfo(); layout();
  } catch (e) {
    if (token !== st.loadToken) return;
    lab.log(`load ${path}: ${e.stack || e}`);
    toast(`${nameOf(path)}：${e.message || e}`, true);
  } finally {
    if (token === st.loadToken) setBusy(null);
  }
}

function updateHeader(path) {
  const n = st.files.length;
  $('fileLabel').textContent = path
    ? `${nameOf(path)}${st.path === path && st.W ? `　·　${st.W}×${st.H}` : ''}${n > 1 ? `　·　${st.idx + 1} / ${n}` : ''}`
    : '尚未開啟照片';
  $('prev').disabled = st.idx <= 0;
  $('next').disabled = st.idx < 0 || st.idx >= n - 1;
}

function renderInfo() {
  const i = st.info, esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]);
  const shot = i ? [i.fnumber ? `f/${+i.fnumber.toFixed(1)}` : '', fmtShutter(i.shutter), i.iso ? `ISO ${i.iso}` : ''].filter(Boolean).join(' · ') : '';
  $('shot').textContent = shot;
  const lines = i ? [i.camera, i.lens, i.focal ? `${Math.round(i.focal)}mm` : '', shot, i.date].filter(Boolean) : [];
  $('exif').innerHTML = `<h4>相片資訊</h4>${esc(nameOf(st.path))}<br>${st.W}×${st.H}${lines.length ? '<br>' + lines.map(esc).join('<br>') : ''}`;
}

async function siblingsOf(path) {
  try {
    const list = await lab.listFolder(dirOf(path));
    const i = list.indexOf(path);
    return i >= 0 ? { list, i } : { list: [path], i: 0 };
  } catch { return { list: [path], i: 0 }; }
}

$('openFiles').onclick = async () => {
  const files = await lab.openFiles();
  if (files.length === 1) { const { list, i } = await siblingsOf(files[0]); openList(list, i); } else openList(files);
};
$('openFolder').onclick = async () => {
  const r = await lab.openFolder();
  if (!r) return;
  if (!r.files.length) { toast('這個資料夾裡沒有支援的照片', true); return; }
  openList(r.files);
};
$('prev').onclick = () => loadIndex(st.idx - 1);
$('next').onclick = () => loadIndex(st.idx + 1);

window.addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('drag'); });
window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('drag'); });
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  document.body.classList.remove('drag');
  const paths = [...e.dataTransfer.files].map((f) => lab.pathForFile(f)).filter((p) => /\.(jpe?g|png|webp|cr3|cr2|nef|arw|dng|raf|orf|rw2|pef|srw)$/i.test(p));
  if (!paths.length) { toast('拖進來的不是支援的照片格式', true); return; }
  if (paths.length === 1) { const { list, i } = await siblingsOf(paths[0]); openList(list, i); } else openList(paths);
});

// ---------- 匯出 ----------
const dlg = $('exportDlg');
const exOpts = store.get('export', { fmt: 'jpg', q: 90, size: '0', custom: 3000, suffix: '_edit', dest: 'same', dir: '' });
function exportSize() {
  const c = st.S.crop, w = Math.round(c.w), h = Math.round(c.h);
  const lim = $('exSize').value === 'custom' ? Math.max(100, +$('exCustom').value || 0) : +$('exSize').value;
  const k = lim && Math.max(w, h) > lim ? lim / Math.max(w, h) : 1;
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)), fw: w, fh: h };
}
function refreshExport() {
  if (!st.path) return;
  $('exQRow').style.display = $('exFmt').value === 'jpg' ? '' : 'none';
  $('exQo').textContent = $('exQ').value;
  $('exCustom').hidden = $('exSize').value !== 'custom';
  const custom = document.querySelector('input[name=exDest]:checked').value === 'custom';
  $('exDir').textContent = custom ? (exOpts.dir || '（尚未選擇）') : dirOf(st.path);
  const { w, h } = exportSize();
  const base = nameOf(st.path).replace(/\.[^.]+$/, '') + $('exSuffix').value.trim();
  $('exInfo').textContent = `輸出 ${w}×${h}　檔名 ${base}.${$('exFmt').value}`;
  $('exGo').disabled = (custom && !exOpts.dir) || /[\\/:*?"<>|]/.test($('exSuffix').value);
}
function openExport() {
  if (!st.S || dlg.open) return;
  setCropMode(false);
  $('exFmt').value = exOpts.fmt; $('exQ').value = exOpts.q; $('exSize').value = exOpts.size;
  $('exCustom').value = exOpts.custom; $('exSuffix').value = exOpts.suffix;
  document.querySelector(`input[name=exDest][value=${exOpts.dest === 'custom' ? 'custom' : 'same'}]`).checked = true;
  refreshExport();
  dlg.showModal();
}
$('exportBtn').onclick = openExport;
$('exportForm').addEventListener('input', refreshExport);
$('exportForm').addEventListener('change', refreshExport);
$('exPick').onclick = async () => {
  const d = await lab.chooseDir(exOpts.dir || dirOf(st.path));
  if (d) { exOpts.dir = d; document.querySelector('input[name=exDest][value=custom]').checked = true; refreshExport(); }
};
$('exCancel').onclick = () => dlg.close();
$('exportForm').addEventListener('submit', (e) => { e.preventDefault(); if ($('exGo').disabled) return; dlg.close(); runExport(); });

async function runExport() {
  Object.assign(exOpts, {
    fmt: $('exFmt').value, q: +$('exQ').value, size: $('exSize').value, custom: +$('exCustom').value,
    suffix: $('exSuffix').value.trim(), dest: document.querySelector('input[name=exDest]:checked').value,
  });
  store.set('export', exOpts);
  const dir = exOpts.dest === 'custom' ? exOpts.dir : dirOf(st.path);
  const base = nameOf(st.path).replace(/\.[^.]+$/, '') + exOpts.suffix;
  const { w, h, fw, fh } = exportSize();
  setBusy(`匯出中（${w}×${h}）…`);
  await new Promise((r) => setTimeout(r, 30)); // 讓轉圈先畫出來
  try {
    const c = st.S.crop;
    const px = pipe.readPixels(st.S, { cx: c.cx, cy: c.cy, w: c.w, h: c.h }, fw, fh);
    let bmp = await createImageBitmap(new ImageData(px, fw, fh));
    if (w !== fw || h !== fh) { const small = await createImageBitmap(bmp, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' }); bmp.close(); bmp = small; }
    const oc = new OffscreenCanvas(w, h);
    oc.getContext('2d').drawImage(bmp, 0, 0);
    bmp.close();
    const blob = await oc.convertToBlob(exOpts.fmt === 'jpg' ? { type: 'image/jpeg', quality: exOpts.q / 100 } : { type: 'image/png' });
    const out = await lab.exportSave(dir, base, '.' + exOpts.fmt, new Uint8Array(await blob.arrayBuffer()));
    toast(`已匯出 ${nameOf(out)}`, false, { label: '在資料夾中顯示', fn: () => lab.reveal(out) });
  } catch (e) {
    lab.log(`export: ${e.stack || e}`);
    toast(`匯出失敗：${e.message || e}`, true);
  } finally {
    setBusy(null);
  }
}

// ---------- 其他 ----------
let toastTimer;
function toast(msg, err = false, action = null) {
  const t = $('toast');
  t.className = 'toast' + (err ? ' err' : '');
  t.textContent = msg;
  if (action) { const a = document.createElement('a'); a.textContent = action.label; a.onclick = action.fn; t.append(a); }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, err ? 7000 : 5000);
}
function fatal(e) {
  document.body.innerHTML = `<div style="padding:40px;color:#e6e6e6">Photo Lab 無法啟動：${String(e.message || e)}</div>`;
  window.lab?.log(`fatal: ${e.stack || e}`);
  throw e;
}

const left = $('left');
if (store.get('leftHidden', false)) left.classList.add('hide');
$('toggleLeft').onclick = () => { left.classList.toggle('hide'); store.set('leftHidden', left.classList.contains('hide')); layout(); };

const typing = () => { const a = document.activeElement; return a && (a.tagName === 'INPUT' && a.type !== 'range' || a.tagName === 'SELECT' || a.tagName === 'TEXTAREA'); };
window.addEventListener('keydown', (e) => {
  if (dlg.open) return;
  const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && k === 'o') { e.preventDefault(); (e.shiftKey ? $('openFolder') : $('openFiles')).click(); return; }
  if (ctrl && e.shiftKey && k === 'e') { e.preventDefault(); openExport(); return; }
  if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); $('redo').click(); return; }
  if (ctrl && k === 'z') { e.preventDefault(); $('undo').click(); return; }
  if (typing() || ctrl || !st.S) return;
  const onRange = document.activeElement?.type === 'range';
  if (k === 'r') setCropMode(!st.cropMode);
  else if (k === 'enter' && st.cropMode) setCropMode(false);
  else if (k === 'escape' && st.cropMode) setCropMode(false);
  else if (k === 'x' && st.cropMode) $('flip').click();
  else if (k === '\\') { if (!e.repeat) setOrig(true); }
  else if (!onRange && k === 'arrowleft') loadIndex(st.idx - 1);
  else if (!onRange && k === 'arrowright') loadIndex(st.idx + 1);
});
window.addEventListener('keyup', (e) => { if (e.key === '\\') setOrig(false); });
window.addEventListener('blur', () => setOrig(false));
new ResizeObserver(() => layout()).observe($('view'));
window.addEventListener('beforeunload', () => { flushSave(); });

// 測試用掛鉤（只讀狀態與呼叫既有流程）
window.__lab = { st, openList, loadIndex, setCropMode, runExport, pipe, clone };
