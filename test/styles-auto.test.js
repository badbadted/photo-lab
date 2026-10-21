import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STYLES, styleById, resolveStyle, hueRGB } from '../renderer/styles.js';
import { autoTone, autoWhiteBalance, pixelStats } from '../renderer/auto.js';
import { ADJ, defaults, isDefault, sanitize } from '../renderer/settings.js';

const KEYS = ['temp', 'tint', 'exp', 'con', 'hl', 'sh', 'wh', 'bl', 'vib', 'sat'];
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('風格清單：8 種＋無，id 不重複，調整項目都是既有拉桿', () => {
  assert.equal(STYLES.length, 9);
  assert.equal(new Set(STYLES.map((s) => s.id)).size, 9);
  for (const s of STYLES) for (const k of Object.keys(s.adj || {})) assert.ok(KEYS.includes(k), `${s.id}.${k}`);
  assert.equal(styleById('不存在').id, 'none');
});

test('風格疊在拉桿上，不改原值；強度線性縮放', () => {
  const S = { ...defaults(100, 100), exp: 0.5, con: 10, style: 'jp', amt: 50 };
  const r = resolveStyle(S, KEYS);
  close(r.adj.exp, 0.5 + 0.35 * 0.5);
  close(r.adj.con, 10 - 22 * 0.5);
  close(r.fade, 0.035);
  assert.equal(S.exp, 0.5); // 原設定沒被動到
  const none = resolveStyle({ ...S, style: 'none' }, KEYS);
  close(none.adj.exp, 0.5); assert.equal(none.fade, 0); assert.deepEqual(none.splitS, [0, 0, 0]);
  const zero = resolveStyle({ ...S, style: 'bw', amt: 0 }, KEYS);
  assert.equal(zero.mono, false); close(zero.adj.con, 10);
  assert.equal(resolveStyle({ ...S, style: 'bw', amt: 100 }, KEYS).mono, true);
});

test('色相轉 RGB', () => {
  assert.deepEqual(hueRGB(0).map((v) => +v.toFixed(3)), [1, 0, 0]);
  assert.deepEqual(hueRGB(120).map((v) => +v.toFixed(3)), [0, 1, 0]);
  assert.deepEqual(hueRGB(180).map((v) => +v.toFixed(3)), [0, 1, 1]);
});

test('設定：風格欄位的預設、清洗、是否動過', () => {
  const d = defaults(10, 10);
  assert.equal(d.style, 'none'); assert.equal(d.amt, 100);
  assert.ok(!isDefault({ ...d, style: 'vivid' }, 10, 10));
  assert.ok(!isDefault({ ...d, amt: 40 }, 10, 10));
  const s = sanitize({ style: '<script>', amt: 999 }, 10, 10);
  assert.equal(s.style, 'none'); assert.equal(s.amt, 100);
  assert.equal(sanitize({ style: 'film', amt: 30 }, 10, 10).style, 'film');
  assert.equal(sanitize({}, 10, 10).amt, 100); // 舊設定檔沒有這兩欄也能讀
});

// 假的渲染器：亮度隨曝光線性變化，用來驗證自動調整的方向
function fakeStats(base) {
  return (P) => {
    const k = 2 ** (P.exp || 0);
    const enc = (v) => Math.min(1, Math.pow(Math.min(1, v * k), 1 / 2.2));
    return { p005: enc(base.lo), p05: enc(base.lo * 1.5), p50: enc(base.mid), p995: enc(base.hi), clip: base.hi * k > 1 ? 0.05 : 0, r: base.r, g: base.g, b: base.b };
  };
}

test('自動光線：暗照片提亮、正常照片曝光幾乎不動、過曝壓亮部', () => {
  const blank = () => { const P = {}; for (const k of KEYS) P[k] = 0; return P; };
  const dark = autoTone(blank(), fakeStats({ lo: 0.001, mid: 0.02, hi: 0.2, r: 1, g: 1, b: 1 }));
  assert.ok(dark.exp > 0.8, `暗照片曝光 ${dark.exp}`);
  const ok = autoTone(blank(), fakeStats({ lo: 0.002, mid: 0.2, hi: 0.9, r: 1, g: 1, b: 1 }));
  assert.ok(Math.abs(ok.exp) < 0.05, `正常照片曝光 ${ok.exp}`);
  const hot = autoTone(blank(), fakeStats({ lo: 0.05, mid: 0.6, hi: 3, r: 1, g: 1, b: 1 }));
  assert.ok(hot.hl < 0, '過曝要壓亮部');
  for (const P of [dark, ok, hot]) for (const k of KEYS) assert.ok(P[k] >= ADJ[k][0] && P[k] <= ADJ[k][1], `${k}=${P[k]} 超出範圍`);
});

test('自動白平衡：偏藍往暖修、偏綠往洋紅修、中性不動', () => {
  const P0 = () => ({ temp: 0, tint: 0 });
  assert.ok(autoWhiteBalance(P0(), () => ({ r: 0.3, g: 0.4, b: 0.6, neutral: 0.2 })).temp > 0, '偏藍應加色溫');
  assert.ok(autoWhiteBalance(P0(), () => ({ r: 0.4, g: 0.6, b: 0.4, neutral: 0.2 })).tint > 0, '偏綠應加色調（往洋紅）');
  const n = autoWhiteBalance(P0(), () => ({ r: 0.4, g: 0.4, b: 0.4, neutral: 0.2 }));
  assert.equal(n.temp, 0); assert.equal(n.tint, 0);
  assert.deepEqual(autoWhiteBalance(P0(), () => ({ r: 0, g: 0, b: 0, neutral: 0.2 })), P0()); // 全黑不出錯
  assert.deepEqual(autoWhiteBalance(P0(), () => ({ r: 0.3, g: 0.4, b: 0.6, neutral: 0.01 })), P0()); // 灰白像素太少就不修
});

test('像素統計', () => {
  const px = new Uint8ClampedArray(4 * 1000);
  for (let i = 0; i < 1000; i++) { const v = Math.round((i / 999) * 255); px.set([v, v, v, 255], i * 4); }
  const s = pixelStats(px);
  assert.ok(Math.abs(s.p50 - 0.5) < 0.01, `p50 ${s.p50}`);
  assert.ok(s.p005 < 0.02 && s.p995 > 0.98);
  close(s.r, s.g); close(s.g, s.b);
  assert.ok(s.neutral > 0.5);
  const red = new Uint8ClampedArray([230, 60, 80, 255, 200, 40, 60, 255]);
  assert.equal(pixelStats(red).neutral, 0); // 鮮紅色不算灰白
});

test('套風格前自動校正：只在光線、白平衡都沒動過時才做', async () => {
  const { untouchedForAuto } = await import('../renderer/auto.js');
  const d = defaults(10, 10);
  assert.ok(untouchedForAuto(d));
  assert.ok(untouchedForAuto({ ...d, con: 30, vib: 20, vig: -40, style: 'jp' }), '色彩、暈映、風格不影響判斷');
  for (const k of ['exp', 'hl', 'sh', 'wh', 'bl', 'temp', 'tint']) assert.ok(!untouchedForAuto({ ...d, [k]: k === 'exp' ? 0.05 : 1 }), `${k} 動過就不校正`);
});
