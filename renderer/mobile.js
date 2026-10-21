// 手機版介面：快速套風格、裁切、存到相簿。修圖核心與電腦版共用。
import { Pipeline } from './pipeline.js';
import { decode } from './decode.js';
import { ADJ, defaults, clone, isDefault, sanitize, History, SCHEMA_VERSION, fmtValue } from './settings.js';
import { STYLES, styleById, customStyles, getCustomStyles, setCustomStyles, captureStyle, adoptOrphan, isCustomId, sanitizeCustomStyle } from './styles.js';
import { autoTone, autoWhiteBalance, pixelStats, untouchedForAuto } from './auto.js';
import { ratioOf, fits, fitCrop, tryRect, rotatedBounds, resizeFromCorner } from './crop.js';
import { download } from './platform.js';

const lab = window.lab;
const MAX_LONG = 4096; // 手機記憶體有限，照片長邊縮到 4096 內再修（約 1200 萬畫素）
const RATIOS = [['orig', '原始'], ['1', '1:1'], ['0.8', '4:5'], ['0.75', '3:4'], ['0.6667', '2:3'], ['0.5625', '9:16'], ['1.7778', '16:9']];
const SIZES = [['IG 直式', 1080, 1350], ['IG 方形', 1080, 1080], ['限時動態', 1080, 1920], ['橫式 HD', 1920, 1080]];
const ADJ_GROUPS = [['light', '光線', ['exp', 'con', 'hl', 'sh', 'wh', 'bl']], ['wb', '白平衡', ['temp', 'tint']], ['color', '色彩', ['vib', 'sat']], ['vig', '暈映', ['vig', 'mid', 'round', 'feat', 'vhl']]];
const pref = {
  get(k, d) { try { const v = localStorage.getItem('photolab.m.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('photolab.m.' + k, JSON.stringify(v)); } catch { /* 存不了就算了 */ } },
};

// ---------- 畫面 ----------
const link = document.createElement('link');
link.rel = 'stylesheet'; link.href = 'mobile.css';
document.head.append(link);
document.body.className = 'm';
document.body.innerHTML = `
<div class="m-top"><button class="m-tb" id="mOpen">開啟</button><span class="m-count" id="mCount"></span><button class="m-tb pri" id="mSave" disabled>存到相簿</button></div>
<div class="m-info" id="mInfo" hidden><span class="m-tag" id="mTag"></span><span id="mInfoText"></span></div>
<div class="m-stage" id="mStage">
  <div class="m-empty" id="mEmpty"><div class="m-logo">◐</div><b>Photo Lab</b><span>按左上「開啟」從相簿選照片<br>可以一次選很多張</span><span class="m-small">照片只在這支手機上處理，不會上傳</span></div>
  <div class="m-cw" id="mCw" hidden><canvas id="mImg"></canvas><canvas id="mOv"></canvas><div class="m-dims" id="mDims" hidden></div></div>
  <div class="m-busy" id="mBusy" hidden><div class="m-spin"></div><span id="mBusyText"></span></div>
</div>
<div class="m-dots" id="mDots"></div>
<div class="m-panel" id="pStyle">
  <label class="m-toggle"><span>套風格時先自動校正</span><input type="checkbox" id="mAuto"><i></i></label>
  <div class="m-strip" id="mStrip"></div>
  <div class="m-amt" id="mAmtRow"><span>強度</span><input type="range" id="mAmt" min="0" max="100" value="100"><output id="mAmtO">100</output></div>
</div>
<div class="m-panel" id="pAdjust" hidden>
  <div class="m-seg" id="mAdjSeg"></div>
  <button class="m-autob" id="mAutoBtn">✦ 自動</button>
  <div id="mSliders"></div>
</div>
<div class="m-panel" id="pCrop" hidden>
  <div class="m-seg" id="mCropSeg"><button data-m="free">自由</button><button data-m="ratio">比例</button><button data-m="size">尺寸</button></div>
  <div class="m-chips" id="mChips"></div>
  <div class="m-custom" id="mCustom" hidden><span>自訂</span><input type="number" id="mSizeW" min="16" max="10000" inputmode="numeric"><span>×</span><input type="number" id="mSizeH" min="16" max="10000" inputmode="numeric"><span>像素</span></div>
  <div class="m-tools"><button class="m-flip" id="mFlip">⇄ 直橫</button><span>拉直</span><input type="range" id="mAngle" min="-45" max="45" step="0.5" value="0"><output id="mAngleO">0°</output></div>
</div>
<div class="m-tabs"><button class="m-tab on" id="tStyle"><b>◐</b>風格</button><button class="m-tab" id="tAdjust"><b>☀</b>調整</button><button class="m-tab" id="tCrop"><b>⛶</b>裁切</button><button class="m-tab" id="tUndo"><b>↺</b>復原</button></div>
<div class="m-sheet-bg" id="mSheetBg" hidden><div class="m-sheet" id="mSheet"></div></div>
<div class="m-toast" id="mToast" hidden></div>`;
const $ = (id) => document.getElementById(id);
const cv = $('mImg'), ov = $('mOv'), ox = ov.getContext('2d');
let pipe;
try { pipe = new Pipeline(cv); } catch (e) { $('mEmpty').innerHTML = `<b>這個瀏覽器不支援</b><span>${String(e.message || e).replace(/[<>&]/g, '')}</span>`; throw e; }

const st = { files: [], idx: -1, cur: null, states: new Map(), crop: false, cropBefore: null, drag: null, token: 0 };
// cur：{ id, W, H, S, hist }
const frameOf = () => {
  const c = st.cur.S.crop;
  if (st.crop) { const b = rotatedBounds(c.angle, st.cur.W, st.cur.H); return { cx: 0, cy: 0, w: b.w, h: b.h }; }
  return { cx: c.cx, cy: c.cy, w: c.w, h: c.h };
};
const nameOf = (id) => id.slice(id.lastIndexOf('/') + 1);

// ---------- 開檔與換張 ----------
$('mOpen').onclick = async () => {
  if (st.crop) return cancelCrop();
  const ids = await lab.openFiles();
  if (!ids.length) return;
  await persist();
  st.files = ids; st.states.clear(); st.idx = -1;
  await show(0);
};

async function show(i) {
  if (i < 0 || i >= st.files.length || i === st.idx) return;
  await persist();
  const token = ++st.token, id = st.files[i];
  busy('載入中…');
  try {
    const img = await decode(id, await lab.readFile(id), { maxLong: Math.min(MAX_LONG, pipe.maxTex) });
    if (token !== st.token) { img.bitmap?.close?.(); return; }
    if (img.kind === 'raw') pipe.setLinear16(img.data, img.width, img.height);
    else { pipe.setSRGB8(img.bitmap); img.bitmap.close?.(); }
    st.idx = i;
    if (img.preview) toast('這張 RAW 太大，手機記憶體不夠整張解開，改用檔案內嵌的預覽圖修（畫質接近一般照片）');
    st.cur = st.states.get(id) || await freshState(id, img.width, img.height);
    st.cur.kind = img.kind === 'raw' ? 'RAW' : img.preview ? 'RAW 預覽' : (id.match(/\.([^.]+)$/)?.[1] || '').toUpperCase().replace('JPG', 'JPEG');
    st.states.set(id, st.cur);
    $('mEmpty').hidden = true; $('mCw').hidden = false; $('mSave').disabled = false;
    sync(); layout(); renderDots();
  } catch (e) {
    toast(`${nameOf(id)}：${e.message || e}`);
  } finally { if (token === st.token) busy(null); }
}

async function freshState(id, W, H) {
  const side = await lab.sidecarRead(id).catch(() => null);
  if (side?.styleDef) adoptOrphan(side.styleDef);
  let S = sanitize(side?.settings, W, H);
  if (side?.srcW && (side.srcW !== W || side.srcH !== H)) { S.crop = defaults(W, H).crop; S.crop.ratio = sanitize(side.settings, W, H).crop.ratio; fitCrop(S.crop, W, H); }
  else if (!fits(S.crop, S.crop, W, H)) fitCrop(S.crop, W, H);
  return { id, W, H, S, hist: new History(S, side ? '開啟（含上次的調整）' : '匯入') };
}

async function persist() {
  const c = st.cur;
  if (!c) return;
  const data = isDefault(c.S, c.W, c.H) ? null : {
    app: 'photo-lab', version: SCHEMA_VERSION, srcW: c.W, srcH: c.H, updated: new Date().toISOString(), settings: c.S,
    ...(isCustomId(c.S.style) ? { styleDef: stripOrphan(styleById(c.S.style)) } : {}),
  };
  await lab.sidecarWrite(c.id, data).catch(() => {});
}
const stripOrphan = (d) => { const { orphan, ...rest } = d; return sanitizeCustomStyle(rest); };

function commit(label) { st.cur.hist.push(label, st.cur.S); persist(); }

// 左右滑換張（裁切模式不滑）
{
  let sx = null, sy = 0;
  $('mStage').addEventListener('pointerdown', (e) => { if (!st.crop) { sx = e.clientX; sy = e.clientY; } });
  $('mStage').addEventListener('pointerup', (e) => {
    if (sx == null) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    sx = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) show(st.idx + (dx < 0 ? 1 : -1));
  });
}

function renderDots() {
  const n = st.files.length;
  $('mCount').textContent = n ? `${st.idx + 1} / ${n}` : '';
  const max = 9, start = Math.max(0, Math.min(st.idx - 4, n - max));
  $('mDots').replaceChildren(...Array.from({ length: Math.min(n, max) }, (_, k) => {
    const d = document.createElement('i'); if (start + k === st.idx) d.className = 'on'; return d;
  }));
  $('mDots').hidden = n < 2;
}

// ---------- 繪製 ----------
function layout() {
  if (!st.cur) return;
  const stage = $('mStage'), f = frameOf(), dpr = window.devicePixelRatio || 1;
  const pad = st.crop ? 18 : 6, aw = Math.max(50, stage.clientWidth - pad * 2), ah = Math.max(50, stage.clientHeight - pad * 2);
  const k = Math.min(aw / f.w, ah / f.h), cssW = Math.max(1, Math.round(f.w * k)), cssH = Math.max(1, Math.round(f.h * k));
  for (const c of [cv, ov]) {
    c.style.width = cssW + 'px'; c.style.height = cssH + 'px';
    const pw = Math.round(cssW * dpr), ph = Math.round(cssH * dpr);
    if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
  }
  draw();
}
let raf = 0;
const redraw = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };
function draw() {
  if (!st.cur) return;
  const f = frameOf();
  pipe.draw(st.cur.S, f);
  drawOverlay(f);
  scheduleThumbs();
}
const toCanvas = (f, x, y) => [((x - f.cx) / f.w + 0.5) * ov.width, ((y - f.cy) / f.h + 0.5) * ov.height];
function drawOverlay(f) {
  ox.clearRect(0, 0, ov.width, ov.height);
  if (!st.crop) return;
  const c = st.cur.S.crop, dpr = window.devicePixelRatio || 1;
  const [x0, y0] = toCanvas(f, c.cx - c.w / 2, c.cy - c.h / 2), [x1, y1] = toCanvas(f, c.cx + c.w / 2, c.cy + c.h / 2);
  const w = x1 - x0, h = y1 - y0;
  ox.fillStyle = '#000000a8'; ox.beginPath(); ox.rect(0, 0, ov.width, ov.height); ox.rect(x0, y0, w, h); ox.fill('evenodd');
  ox.strokeStyle = '#ffffff80'; ox.lineWidth = dpr; ox.beginPath();
  for (const t of [1 / 3, 2 / 3]) { ox.moveTo(x0 + w * t, y0); ox.lineTo(x0 + w * t, y1); ox.moveTo(x0, y0 + h * t); ox.lineTo(x1, y0 + h * t); }
  ox.stroke();
  ox.strokeStyle = '#fff'; ox.lineWidth = 2 * dpr; ox.strokeRect(x0, y0, w, h);
  const L = 22 * dpr; ox.lineWidth = 5 * dpr; ox.beginPath();
  for (const [hx, hy, dx, dy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) { ox.moveTo(hx + dx * L, hy); ox.lineTo(hx, hy); ox.lineTo(hx, hy + dy * L); }
  ox.stroke();
}
new ResizeObserver(() => layout()).observe($('mStage'));

// ---------- 風格 ----------
const autoBox = $('mAuto');
autoBox.checked = pref.get('autoBeforeStyle', true);
autoBox.onchange = () => pref.set('autoBeforeStyle', autoBox.checked);

function card(s, kind) {
  const el = document.createElement('button');
  el.className = 'm-sty' + (kind === 'new' ? ' new' : '');
  if (kind === 'new') { el.innerHTML = '<div class="m-plus">＋</div>存成我的'; el.onclick = saveMine; return el; }
  el.dataset.id = s.id;
  const c = document.createElement('canvas'); c.width = 136; c.height = 136;
  const name = document.createElement('span'); name.textContent = s.orphan ? `${s.name}・舊版` : s.name; // 使用者輸入的名稱一律 textContent
  el.append(c, name);
  el.onclick = () => pickStyle(s.id);
  if (kind === 'mine' && !s.orphan) {
    let t = 0;
    el.addEventListener('pointerdown', () => { t = setTimeout(() => { t = -1; styleMenu(s); }, 550); });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(ev, () => { if (t > 0) clearTimeout(t); });
    el.addEventListener('click', (e) => { if (t === -1) { e.stopImmediatePropagation(); t = 0; } }, true);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  return el;
}
let stripKey = null;
function renderStrip() {
  const mine = customStyles().filter((s) => !s.orphan || s.id === st.cur?.S.style);
  const key = mine.map((s) => s.id + s.name).join('|');
  if (key !== stripKey) {
    stripKey = key;
    $('mStrip').replaceChildren(card(null, 'new'), ...mine.map((s) => card(s, 'mine')), ...STYLES.map((s) => card(s, 'builtin')));
    scheduleThumbs(true);
  }
  for (const el of $('mStrip').querySelectorAll('.m-sty[data-id]')) el.classList.toggle('on', el.dataset.id === st.cur?.S.style);
}
let thumbT = 0, thumbForce = false;
function scheduleThumbs(force = false) { thumbForce ||= force; clearTimeout(thumbT); thumbT = setTimeout(drawThumbs, 250); }
function drawThumbs() {
  if (!st.cur) return;
  const c = st.cur.S.crop, frame = { cx: c.cx, cy: c.cy, w: c.w, h: c.h };
  const k = 136 / Math.min(c.w, c.h), w = Math.max(1, Math.round(c.w * k)), h = Math.max(1, Math.round(c.h * k));
  for (const el of $('mStrip').querySelectorAll('.m-sty[data-id]')) {
    const cnv = el.querySelector('canvas');
    if (cnv.width !== w || cnv.height !== h) { cnv.width = w; cnv.height = h; }
    cnv.getContext('2d').putImageData(new ImageData(pipe.readPixels({ ...st.cur.S, style: el.dataset.id, amt: 100 }, frame, w, h), w, h), 0, 0);
  }
  thumbForce = false;
}

function statsFor(S) {
  return (P) => {
    const c = S.crop, k = Math.min(1, 320 / Math.max(c.w, c.h));
    return pixelStats(pipe.readPixels({ ...S, ...P, style: 'none', vig: 0 }, { cx: c.cx, cy: c.cy, w: c.w, h: c.h }, Math.max(1, Math.round(c.w * k)), Math.max(1, Math.round(c.h * k))));
  };
}
function autoCorrect(S) {
  const P = {};
  for (const k in ADJ) P[k] = S[k];
  autoWhiteBalance(P, statsFor(S)); autoTone(P, statsFor(S));
  const changed = Object.keys(ADJ).some((k) => P[k] !== S[k]);
  Object.assign(S, P);
  return changed;
}

function pickStyle(id) {
  if (!st.cur || st.cur.S.style === id) return;
  const S = st.cur.S, corrected = autoBox.checked && id !== 'none' && untouchedForAuto(S) && autoCorrect(S);
  S.style = id;
  sync(); redraw();
  commit(`${corrected ? '自動校正＋' : ''}風格 ${styleById(id).name}`);
}
{
  const a = $('mAmt');
  let before = 100;
  a.addEventListener('pointerdown', () => { before = st.cur?.S.amt; });
  a.addEventListener('input', () => { if (!st.cur) return; st.cur.S.amt = +a.value; $('mAmtO').textContent = a.value; redraw(); });
  a.addEventListener('change', () => { if (st.cur && st.cur.S.amt !== before) commit(`風格強度 ${st.cur.S.amt}`); });
}

async function saveMine() {
  if (!st.cur) return toast('先開一張照片，調好再存');
  const name = await askName('存成我的風格', '');
  if (!name) return;
  setCustomStyles([captureStyle(st.cur.S, ['wb', 'vignette'], name, Object.keys(ADJ)), ...getCustomStyles()]);
  if (await saveStyles()) toast(`已存成「${name}」`);
  sync();
}
function styleMenu(s) {
  sheet(`<b>${esc(s.name)}</b>`, [
    ['重新命名', async () => {
      const name = await askName('重新命名', s.name, s.id);
      if (!name) return;
      setCustomStyles(getCustomStyles().map((x) => (x.id === s.id ? { ...x, name } : x)));
      await saveStyles(); sync();
    }],
    ['刪除', async () => {
      setCustomStyles(getCustomStyles().filter((x) => x.id !== s.id));
      if (st.cur?.S.style === s.id) adoptOrphan(s); // 這張照片仍維持原樣
      await saveStyles(); toast(`已刪除「${s.name}」`); sync();
    }, 'danger'],
  ]);
}
async function saveStyles() { try { await lab.stylesWrite(getCustomStyles()); return true; } catch (e) { toast(`存不進去：${e.message}`); return false; } }
lab.stylesRead().then((l) => { setCustomStyles(l); renderStrip(); }).catch(() => {});

// ---------- 調整 ----------
let adjGroup = 'light';
$('mAdjSeg').replaceChildren(...ADJ_GROUPS.map(([g, label]) => {
  const b = document.createElement('button'); b.dataset.g = g; b.textContent = label;
  b.onclick = () => { adjGroup = g; renderSliders(); }; return b;
}));
function renderSliders() {
  for (const b of $('mAdjSeg').children) b.classList.toggle('on', b.dataset.g === adjGroup);
  const keys = ADJ_GROUPS.find(([g]) => g === adjGroup)[2];
  $('mSliders').replaceChildren(...keys.map((k) => {
    const [mn, mx, d, name, step] = ADJ[k];
    const row = document.createElement('div'); row.className = 'm-sl'; row.dataset.k = k;
    const lab = document.createElement('span'); lab.textContent = name;
    const inp = document.createElement('input'); inp.type = 'range'; inp.min = mn; inp.max = mx; inp.step = step || 1; inp.id = 'mS_' + k;
    if (k === 'temp' || k === 'tint') inp.className = k;
    const out = document.createElement('output');
    row.append(lab, inp, out);
    let before = d;
    inp.addEventListener('pointerdown', () => { before = st.cur?.S[k]; });
    inp.addEventListener('input', () => { if (!st.cur) return; st.cur.S[k] = +inp.value; paintSlider(k); redraw(); });
    inp.addEventListener('change', () => { if (st.cur && st.cur.S[k] !== before) commit(`${name} ${fmtValue(k, st.cur.S[k])}`); });
    const reset = () => { if (!st.cur || st.cur.S[k] === d) return; st.cur.S[k] = d; paintSlider(k); redraw(); commit(`${name} 歸零`); };
    inp.addEventListener('dblclick', reset); lab.addEventListener('dblclick', reset);
    return row;
  }));
  for (const k of keys) paintSlider(k);
}
function paintSlider(k) {
  const inp = $('mS_' + k);
  if (!inp || !st.cur) return;
  const v = st.cur.S[k];
  inp.value = v;
  inp.nextElementSibling.textContent = fmtValue(k, v);
  inp.parentElement.classList.toggle('ch', v !== ADJ[k][2]);
}
$('mAutoBtn').onclick = () => {
  if (!st.cur) return;
  if (!autoCorrect(st.cur.S)) return toast('這張照片不需要調整');
  sync(); redraw(); commit('自動調整');
};

// ---------- 裁切 ----------
// 三種：自由（任意拉）、比例（照字面：4:5、9:16 是直的）、尺寸（輸出固定像素，框鎖該比例）
let cropMode = 'ratio';
const modeOf = (C) => (C.size ? 'size' : C.ratio === 'free' ? 'free' : 'ratio');
for (const b of $('mCropSeg').children) b.onclick = () => setCropMode(b.dataset.m);
function setCropMode(m) {
  const C = st.cur.S.crop;
  cropMode = m;
  if (m === 'free') { delete C.size; C.ratio = 'free'; C.flip = false; }
  else if (m === 'ratio') { delete C.size; if (C.ratio === 'free' || !RATIOS.some(([v]) => v === C.ratio)) C.ratio = 'orig'; C.flip = false; fitCrop(C, st.cur.W, st.cur.H); }
  else if (!C.size) setSize(SIZES[0][1], SIZES[0][2]);
  renderCropChips(); sync(); redraw();
}
function setSize(w, h) {
  const C = st.cur.S.crop;
  C.size = { w, h }; C.ratio = String(+(w / h).toFixed(6)); C.flip = false;
  fitCrop(C, st.cur.W, st.cur.H);
}
function renderCropChips() {
  const C = st.cur?.S.crop;
  const box = $('mChips');
  $('mCustom').hidden = cropMode !== 'size';
  box.hidden = cropMode === 'free';
  if (cropMode === 'ratio') {
    box.replaceChildren(...RATIOS.map(([v, label]) => {
      const b = document.createElement('button'); b.className = 'm-chip'; b.dataset.v = v; b.textContent = label;
      b.onclick = () => { const c = st.cur.S.crop; c.ratio = v; c.flip = false; fitCrop(c, st.cur.W, st.cur.H); sync(); redraw(); };
      return b;
    }));
  } else if (cropMode === 'size') {
    box.replaceChildren(...SIZES.map(([label, w, h]) => {
      const b = document.createElement('button'); b.className = 'm-chip'; b.dataset.size = `${w}x${h}`;
      b.textContent = label;
      const sm = document.createElement('small'); sm.textContent = `${w}×${h}`; b.append(sm);
      b.onclick = () => { setSize(w, h); sync(); redraw(); };
      return b;
    }));
    if (C?.size) { $('mSizeW').value = C.size.w; $('mSizeH').value = C.size.h; }
  }
}
for (const id of ['mSizeW', 'mSizeH']) {
  $(id).addEventListener('change', () => {
    const w = Math.round(+$('mSizeW').value), h = Math.round(+$('mSizeH').value);
    if (!(w >= 16 && w <= 10000 && h >= 16 && h <= 10000)) { toast('尺寸要在 16～10000 像素之間'); sync(); return; }
    setSize(w, h); sync(); redraw();
  });
}
function flip() {
  const C = st.cur.S.crop;
  if (C.size) setSize(C.size.h, C.size.w); // 尺寸模式：寬高對調
  else if (C.ratio !== 'free') { C.flip = !C.flip; fitCrop(C, st.cur.W, st.cur.H); }
  sync(); redraw();
}
$('mFlip').onclick = flip;
{
  const a = $('mAngle');
  a.addEventListener('input', () => {
    const C = st.cur.S.crop;
    C.angle = +a.value; $('mAngleO').textContent = `${C.angle.toFixed(1)}°`;
    fitCrop(C, st.cur.W, st.cur.H); layout();
  });
}
function cropDims() {
  const c = st.cur.S.crop, w = Math.round(c.w), h = Math.round(c.h);
  if (!c.size) return `${w}×${h}`;
  return `輸出 ${c.size.w}×${c.size.h}${w < c.size.w ? '（照片不夠大，會放大）' : ''}`;
}
function fromEvent(e) {
  const f = frameOf(), b = ov.getBoundingClientRect();
  return { x: f.cx + ((e.clientX - b.left) / b.width - 0.5) * f.w, y: f.cy + ((e.clientY - b.top) / b.height - 0.5) * f.h };
}
function hit(p) {
  const c = st.cur.S.crop, f = frameOf(), tol = (30 / ov.getBoundingClientRect().width) * f.w; // 手指比滑鼠粗，容許範圍放大
  for (const [ux, uy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) if (Math.abs(p.x - (c.cx + (ux * c.w) / 2)) < tol && Math.abs(p.y - (c.cy + (uy * c.h) / 2)) < tol) return { type: 'corner', ux, uy };
  if (Math.abs(p.x - c.cx) < c.w / 2 && Math.abs(p.y - c.cy) < c.h / 2) return { type: 'move' };
  return null;
}
ov.addEventListener('pointerdown', (e) => {
  if (!st.crop) return;
  const p = fromEvent(e), h = hit(p);
  if (!h) return;
  st.drag = { ...h, p0: p, r0: { ...st.cur.S.crop } };
  try { ov.setPointerCapture(e.pointerId); } catch { /* 忽略 */ }
  e.preventDefault();
});
ov.addEventListener('pointermove', (e) => {
  if (!st.drag) return;
  const p = fromEvent(e), C = st.cur.S.crop, d = st.drag, r0 = d.r0, { W, H } = st.cur;
  if (d.type === 'move') {
    const tx = r0.cx + p.x - d.p0.x, ty = r0.cy + p.y - d.p0.y;
    for (let i = 0; i < 4; i++) {
      tryRect(C, { ...C }, { cx: tx, cy: C.cy, w: C.w, h: C.h }, W, H);
      tryRect(C, { ...C }, { cx: C.cx, cy: ty, w: C.w, h: C.h }, W, H);
    }
  } else {
    tryRect(C, { cx: C.cx, cy: C.cy, w: C.w, h: C.h }, resizeFromCorner(r0, d.ux, d.uy, p, ratioOf(C, W, H), Math.min(W, H) * 0.05), W, H);
  }
  $('mDims').textContent = cropDims();
  redraw();
});
for (const ev of ['pointerup', 'pointercancel']) ov.addEventListener(ev, () => { st.drag = null; });

// ---------- 分頁 ----------
let tab = 'style';
function setTab(t) {
  if (!st.cur && t !== 'style') return;
  if (st.crop && t !== 'crop') leaveCrop(true);
  tab = t;
  $('pStyle').hidden = t !== 'style'; $('pAdjust').hidden = t !== 'adjust'; $('pCrop').hidden = t !== 'crop';
  for (const [id, n] of [['tStyle', 'style'], ['tAdjust', 'adjust'], ['tCrop', 'crop']]) $(id).classList.toggle('on', n === t);
  if (t === 'adjust') renderSliders();
  if (t === 'crop') enterCrop();
}
function enterCrop() {
  if (!st.cur || st.crop) return;
  st.crop = true; st.cropBefore = clone(st.cur.S.crop);
  cropMode = modeOf(st.cur.S.crop);
  $('mOpen').textContent = '取消'; $('mSave').textContent = '完成';
  $('mCount').textContent = '裁切';
  $('mDots').hidden = true;
  ov.style.pointerEvents = 'auto';
  renderCropChips(); sync(); layout();
}
function leaveCrop(keep) {
  if (!st.crop) return;
  if (!keep) st.cur.S.crop = st.cropBefore;
  const changed = JSON.stringify(st.cur.S.crop) !== JSON.stringify(st.cropBefore);
  st.crop = false;
  $('mOpen').textContent = '開啟'; $('mSave').textContent = '存到相簿';
  ov.style.pointerEvents = 'none';
  if (tab === 'crop') { tab = 'style'; $('pStyle').hidden = false; $('pCrop').hidden = true; $('tStyle').classList.add('on'); $('tCrop').classList.remove('on'); }
  renderDots(); sync(); layout();
  if (keep && changed) commit('裁切');
}
const cancelCrop = () => leaveCrop(false);
$('tStyle').onclick = () => setTab('style');
$('tAdjust').onclick = () => setTab('adjust');
$('tCrop').onclick = () => setTab('crop');
$('tUndo').onclick = () => {
  if (!st.cur) return;
  if (st.crop) { st.cur.S.crop = clone(st.cropBefore); cropMode = modeOf(st.cur.S.crop); renderCropChips(); sync(); layout(); return; }
  if (!st.cur.hist.canUndo) return toast('已經是最原始的樣子');
  st.cur.S = st.cur.hist.undo(); sync(); layout(); persist();
};

function sync() {
  if (!st.cur) return;
  const S = st.cur.S, C = S.crop;
  $('mAmt').value = S.amt; $('mAmtO').textContent = Math.round(S.amt);
  $('mAmtRow').classList.toggle('off', S.style === 'none');
  $('mAngle').value = C.angle; $('mAngleO').textContent = `${C.angle.toFixed(1)}°`;
  for (const b of $('mCropSeg').children) b.classList.toggle('on', b.dataset.m === cropMode);
  for (const b of $('mChips').querySelectorAll('.m-chip[data-v]')) b.classList.toggle('on', !C.size && b.dataset.v === C.ratio);
  for (const b of $('mChips').querySelectorAll('.m-chip[data-size]')) b.classList.toggle('on', !!C.size && b.dataset.size === `${C.size.w}x${C.size.h}`);
  if (C.size) { $('mSizeW').value = C.size.w; $('mSizeH').value = C.size.h; }
  $('mFlip').disabled = cropMode === 'free';
  $('mDims').hidden = !st.crop; $('mDims').textContent = cropDims();
  // 檔案資訊：看得出是不是 RAW
  $('mInfo').hidden = false;
  const tag = $('mTag');
  tag.textContent = st.cur.kind || '';
  tag.className = 'm-tag ' + (st.cur.kind === 'RAW' ? 'raw' : st.cur.kind === 'RAW 預覽' ? 'pv' : '');
  $('mInfoText').textContent = `${nameOf(st.cur.id)} · ${st.cur.W}×${st.cur.H}`;
  if (tab === 'adjust') for (const k of ADJ_GROUPS.find(([g]) => g === adjGroup)[2]) paintSlider(k);
  renderStrip();
}

// ---------- 存到相簿 ----------
$('mSave').onclick = () => {
  if (st.crop) return leaveCrop(true);
  if (!st.cur) return;
  if (st.files.length < 2) return exportSet([st.idx]);
  const s = styleById(st.cur.S.style), C = st.cur.S.crop;
  const r = C.size ? `${C.size.w}×${C.size.h}` : C.ratio === 'free' ? '自由' : RATIOS.find(([v]) => v === C.ratio)?.[1];
  sheet(`<b>存到相簿</b><span>風格「${esc(s.name)}」${st.cur.S.style !== 'none' ? ` ${Math.round(st.cur.S.amt)}%` : ''}${C.ratio !== 'orig' || C.size ? `，裁切 ${r}` : ''}</span>`, [
    ['只存這一張', () => exportSet([st.idx]), 'pri'],
    [`套用到全部 ${st.files.length} 張再一次存`, () => exportSet(st.files.map((_, i) => i))],
  ], '「全部」會每張各自先自動校正（如果有開）再套同一個風格；裁切比例照用，框放正中間。');
};

async function exportSet(list) {
  await persist();
  const keep = st.idx, master = clone(st.cur.S), out = [];
  // 目前這張先做：它的照片已經在顯示卡上，之後才輪到別張換貼圖
  list = [...list.filter((i) => i === keep), ...list.filter((i) => i !== keep)];
  try {
    for (let n = 0; n < list.length; n++) {
      const i = list[n], id = st.files[i];
      busy(list.length > 1 ? `處理中 ${n + 1} / ${list.length}` : '處理中…');
      let job;
      if (i === keep) job = st.cur;
      else {
        const img = await decode(id, await lab.readFile(id), { maxLong: Math.min(MAX_LONG, pipe.maxTex) });
        if (img.kind === 'raw') pipe.setLinear16(img.data, img.width, img.height);
        else { pipe.setSRGB8(img.bitmap); img.bitmap.close?.(); }
        job = st.states.get(id) || await freshState(id, img.width, img.height);
        const S = job.S;
        if (autoBox.checked && master.style !== 'none' && untouchedForAuto(S)) autoCorrect(S);
        S.style = master.style; S.amt = master.amt;
        if (master.crop.ratio !== 'orig' || master.crop.flip || master.crop.size) {
          S.crop = { ...S.crop, ratio: master.crop.ratio, flip: master.crop.flip, angle: 0 };
          if (master.crop.size) S.crop.size = { ...master.crop.size }; else delete S.crop.size;
          if (S.crop.ratio === 'free') S.crop.ratio = String(+(master.crop.w / master.crop.h).toFixed(6)); // 自由框：照同一個長寬比
          fitCrop(S.crop, job.W, job.H);
        }
        job.hist.push('套用到全部', S);
        st.states.set(id, job);
        await lab.sidecarWrite(id, { app: 'photo-lab', version: SCHEMA_VERSION, srcW: job.W, srcH: job.H, updated: new Date().toISOString(), settings: S, ...(isCustomId(S.style) ? { styleDef: stripOrphan(styleById(S.style)) } : {}) }).catch(() => {});
      }
      out.push(await renderJpeg(job, id));
      await new Promise((r) => setTimeout(r, 0));
    }
  } catch (e) {
    toast(`處理失敗：${e.message || e}`);
    out.length = 0;
  } finally {
    // 換回目前這張
    if (list.some((i) => i !== keep)) {
      const id = st.files[keep], img = await decode(id, await lab.readFile(id), { maxLong: Math.min(MAX_LONG, pipe.maxTex) }).catch(() => null);
      if (img) { if (img.kind === 'raw') pipe.setLinear16(img.data, img.width, img.height); else { pipe.setSRGB8(img.bitmap); img.bitmap.close?.(); } }
    }
    busy(null); sync(); layout();
  }
  if (!out.length) return;
  // iOS 只允許「使用者剛點的那一下」叫出分享，處理完再請使用者點一次
  const canShare = lab.canShareFiles?.() && navigator.canShare?.({ files: out });
  sheet(`<b>準備好了</b><span>${out.length} 張，存成新照片，原圖不動</span>`, [
    [canShare ? `存到相簿（${out.length} 張）` : `下載（${out.length} 張）`, async () => {
      if (canShare) {
        try { await navigator.share({ files: out }); } catch (e) { if (e.name !== 'AbortError') toast(`分享失敗：${e.message}`); }
      } else for (const f of out) download(f, f.name);
    }, 'pri'],
  ], canShare ? '會跳出分享選單，點「儲存影像」就存進相簿。' : '這個瀏覽器不能直接存相簿，改成下載。');
}

async function renderJpeg(job, id) {
  const c = job.S.crop, w = Math.max(1, Math.round(c.w)), h = Math.max(1, Math.round(c.h));
  const px = pipe.readPixels(job.S, { cx: c.cx, cy: c.cy, w: c.w, h: c.h }, w, h);
  let cnv = document.createElement('canvas'); cnv.width = w; cnv.height = h;
  cnv.getContext('2d').putImageData(new ImageData(px, w, h), 0, 0);
  if (c.size && (c.size.w !== w || c.size.h !== h)) { // 「尺寸」：縮放成剛好指定的像素
    const out = document.createElement('canvas'); out.width = c.size.w; out.height = c.size.h;
    const g = out.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(cnv, 0, 0, out.width, out.height);
    cnv.width = cnv.height = 0; cnv = out;
  }
  const blob = await new Promise((r) => cnv.toBlob(r, 'image/jpeg', 0.92));
  cnv.width = cnv.height = 0;
  return new File([blob], nameOf(id).replace(/\.[^.]+$/, '') + '_edit.jpg', { type: 'image/jpeg', lastModified: Date.now() });
}

// ---------- 小工具：底部選單、輸入名稱、提示 ----------
const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
function sheet(headHtml, actions, note = '') {
  const box = $('mSheet');
  box.innerHTML = `<div class="m-sh-head">${headHtml}</div>`;
  for (const [label, fn, cls] of actions) {
    const b = document.createElement('button'); b.className = 'm-sh-btn ' + (cls || ''); b.textContent = label;
    b.onclick = () => { closeSheet(); fn(); };
    box.append(b);
  }
  if (note) { const n = document.createElement('div'); n.className = 'm-sh-note'; n.textContent = note; box.append(n); }
  const c = document.createElement('button'); c.className = 'm-sh-btn'; c.textContent = '取消'; c.onclick = closeSheet; box.append(c);
  $('mSheetBg').hidden = false;
}
const closeSheet = () => { $('mSheetBg').hidden = true; };
$('mSheetBg').addEventListener('click', (e) => { if (e.target.id === 'mSheetBg') closeSheet(); });

function askName(title, value, selfId = null) {
  return new Promise((resolve) => {
    const box = $('mSheet');
    box.innerHTML = `<div class="m-sh-head"><b>${esc(title)}</b></div><input class="m-input" id="mName" maxlength="20" placeholder="例如：雨天比賽"><div class="m-sh-err" id="mNameErr"></div>`;
    const input = box.querySelector('#mName'); input.value = value;
    const ok = document.createElement('button'); ok.className = 'm-sh-btn pri'; ok.textContent = '儲存';
    const cancel = document.createElement('button'); cancel.className = 'm-sh-btn'; cancel.textContent = '取消';
    ok.onclick = () => {
      const v = input.value.trim();
      if (!v) { box.querySelector('#mNameErr').textContent = '請輸入名稱'; return; }
      if (getCustomStyles().some((x) => x.name === v && x.id !== selfId)) { box.querySelector('#mNameErr').textContent = '已經有同名的風格'; return; }
      closeSheet(); resolve(v);
    };
    cancel.onclick = () => { closeSheet(); resolve(null); };
    box.append(ok, cancel);
    $('mSheetBg').hidden = false;
    setTimeout(() => input.focus(), 50);
  });
}

function busy(text) { $('mBusy').hidden = !text; if (text) $('mBusyText').textContent = text; }
let toastT = 0;
function toast(msg) {
  const t = $('mToast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 4000);
}
window.addEventListener('pagehide', () => { persist(); });

// 測試用掛鉤
window.__m = { st, show, pickStyle, setTab, setCropMode, setSize, flip, exportSet, renderJpeg, pipe, registerFiles: (fl) => lab.registerFiles(fl) };
