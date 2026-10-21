import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shrinkRGB16 } from '../renderer/raster.js';

test('48MP（8064×6048）縮到長邊 4096 以內', () => {
  // 只驗尺寸計算，用小圖等比模擬：8064×6048 → k=2 → 4032×3024
  const w = 8064 / 48, h = 6048 / 48; // 168×126，maxLong 換算成 4096/48
  const r = shrinkRGB16(new Uint16Array(w * h * 3), w, h, 4096 / 48);
  assert.equal(r.width, 84); assert.equal(r.height, 63);
});

test('不超過上限就原樣回傳（不複製）', () => {
  const d = new Uint16Array(10 * 8 * 3);
  const r = shrinkRGB16(d, 10, 8, 4096);
  assert.equal(r.data, d); assert.equal(r.width, 10);
});

test('盒狀平均：2×2 取平均、各色分開算', () => {
  // 4×2 → maxLong 2 → k=2 → 2×1
  const d = new Uint16Array([
    0, 100, 1000, 4, 100, 1000, 10, 0, 0, 20, 0, 0,
    8, 100, 1000, 0, 100, 1000, 30, 0, 0, 40, 0, 65535,
  ]);
  const r = shrinkRGB16(d, 4, 2, 2);
  assert.equal(r.width, 2); assert.equal(r.height, 1);
  assert.deepEqual([...r.data], [3, 100, 1000, 25, 0, 16384]);
});

test('長寬不是 k 的倍數時捨去邊緣，不會讀出界', () => {
  const r = shrinkRGB16(new Uint16Array(9 * 7 * 3).fill(500), 9, 7, 4);
  assert.equal(r.width, 3); assert.equal(r.height, 2);
  assert.ok([...r.data].every((v) => v === 500));
});
