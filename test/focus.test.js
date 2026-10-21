import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edgeScore, referenceScore, classify, clarity, lumaFromRGBA } from '../renderer/focus.js';

// 合成測試圖：隨機方塊（有銳利邊緣），再用盒狀模糊做出失焦版本
function scene(w, h, seed = 1, contrast = 1) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const L = new Float32Array(w * h).fill(0.5);
  for (let k = 0; k < 120; k++) {
    const x0 = Math.floor(rnd() * w), y0 = Math.floor(rnd() * h), bw = 8 + Math.floor(rnd() * 60), bh = 8 + Math.floor(rnd() * 60), v = 0.5 + (rnd() - 0.5) * contrast;
    for (let y = y0; y < Math.min(h, y0 + bh); y++) for (let x = x0; x < Math.min(w, x0 + bw); x++) L[y * w + x] = v;
  }
  return L;
}
function blur(L, w, h, r) {
  let a = L;
  for (let pass = 0; pass < 2; pass++) {
    const b = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let d = -r; d <= r; d++) {
        const xx = pass ? x : Math.min(w - 1, Math.max(0, x + d)), yy = pass ? Math.min(h - 1, Math.max(0, y + d)) : y;
        s += a[yy * w + xx]; n++;
      }
      b[y * w + x] = s / n;
    }
    a = b;
  }
  return a;
}

test('清楚的分數高於模糊的，模糊越重分數越低', () => {
  const w = 400, h = 300, L = scene(w, h);
  const s0 = edgeScore(L, w, h), s1 = edgeScore(blur(L, w, h, 1), w, h), s3 = edgeScore(blur(L, w, h, 3), w, h);
  assert.ok(s0 > s1 * 1.4, `清楚 ${s0} vs 輕糊 ${s1}`);
  assert.ok(s1 > s3, `輕糊 ${s1} vs 重糊 ${s3}`);
});

test('分數跟畫面對比幾乎無關', () => {
  const w = 400, h = 300;
  const hi = edgeScore(scene(w, h, 7, 1), w, h), lo = edgeScore(scene(w, h, 7, 0.3), w, h);
  assert.ok(Math.abs(hi - lo) / hi < 0.15, `高對比 ${hi} 低對比 ${lo}`);
});

test('主角清楚、背景糊（只看最清楚的格子）仍判清楚', () => {
  const w = 480, h = 320, L = scene(w, h, 3), B = blur(L, w, h, 3), M = new Float32Array(B);
  for (let y = 100; y < 220; y++) for (let x = 160; x < 320; x++) M[y * w + x] = L[y * w + x]; // 中間一塊保持清楚
  const sharp = edgeScore(L, w, h), mixed = edgeScore(M, w, h), allBlur = edgeScore(B, w, h);
  assert.ok(mixed > sharp * 0.8, `局部清楚 ${mixed} vs 全清楚 ${sharp}`);
  assert.ok(mixed > allBlur * 1.5);
});

test('純色、太小的圖不會出錯', () => {
  assert.equal(edgeScore(new Float32Array(100 * 100).fill(0.5), 100, 100), 0);
  assert.equal(edgeScore(new Float32Array(10 * 10), 10, 10), 0);
});

test('分類與參考值', () => {
  const ref = referenceScore([1.2, 1.3, 1.35, 1.4, 1.45, 1.5, 1.3, 1.25, 1.38, 1.42]);
  assert.ok(ref >= 1.42 && ref <= 1.5);
  assert.equal(classify(1.4, ref), 'ok');
  assert.equal(classify(1.05, ref), 'mid');
  assert.equal(classify(0.7, ref), 'bad');
  assert.equal(classify(0.7, ref, 'ok'), 'ok', '手動改過的優先');
  assert.equal(classify(0, ref), 'mid', '算不出來的放待確認');
  assert.equal(referenceScore([1, 1.2]), 1.6, '張數太少用預設參考值');
  assert.equal(clarity(2, 1), 100);
  assert.equal(clarity(0.5, 1), 50);
});

test('RGBA 轉亮度', () => {
  const L = lumaFromRGBA(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]), 2);
  assert.ok(Math.abs(L[0] - 1) < 1e-6 && L[1] === 0);
});
