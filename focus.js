// 對焦判斷（純函式，可在 node 測）
// 做法：照片縮到長邊 1500，切 12×8 格；每格只看「最明顯的邊緣」（梯度前 10%），
// 算 |拉普拉斯| ÷ 梯度：邊緣越銳利，二階變化相對越大；這個比值跟畫面對比、亮度無關。
// 取最清楚的 4 格平均當分數（主角清楚、背景虛化不會被誤判），再跟同資料夾的照片比。
// 2026-10-21 用 Olympus 棒球連拍 120 張校準：正常照片 1.16～1.50，人工模糊 1px 只剩約一半。

export const FOCUS_LONG = 1500;
const GRID_X = 12, GRID_Y = 8, TOP_TILES = 4;
export const OK_RATIO = 0.82, BAD_RATIO = 0.62;
const FALLBACK_REF = 1.6; // 照片太少、沒得比時的參考值（App 內縮圖算出的正常照片約 1.4～1.8）
export const CLASSES = { ok: '準焦', mid: '待確認', bad: '失焦' };

export function lumaFromRGBA(px, n) {
  const L = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) L[i] = (0.2126 * px[j] + 0.7152 * px[j + 1] + 0.0722 * px[j + 2]) / 255;
  return L;
}

/** 邊緣銳利度分數；越大越清楚，正常照片約 1.1～1.6 */
export function edgeScore(L, w, h) {
  if (w < 32 || h < 32) return 0;
  const iw = w - 2, ih = h - 2;
  const lap = new Float32Array(iw * ih), grad = new Float32Array(iw * ih);
  for (let y = 1; y < h - 1; y++) {
    const r = y * w, o = (y - 1) * iw - 1;
    for (let x = 1; x < w - 1; x++) {
      const c = L[r + x], up = L[r - w + x], dn = L[r + w + x], lf = L[r + x - 1], rt = L[r + x + 1];
      lap[o + x] = up + dn + lf + rt - 4 * c;
      const gx = (rt - lf) * 0.5, gy = (dn - up) * 0.5;
      grad[o + x] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  const BINS = 512, GMAX = 0.75, hist = new Uint32Array(BINS), tiles = [];
  for (let ty = 0; ty < GRID_Y; ty++) {
    for (let tx = 0; tx < GRID_X; tx++) {
      const ys = Math.floor((ty * ih) / GRID_Y), ye = Math.floor(((ty + 1) * ih) / GRID_Y);
      const xs = Math.floor((tx * iw) / GRID_X), xe = Math.floor(((tx + 1) * iw) / GRID_X);
      hist.fill(0);
      let n = 0;
      for (let y = ys; y < ye; y++) for (let x = xs; x < xe; x++) { hist[Math.min(BINS - 1, Math.floor((grad[y * iw + x] / GMAX) * BINS))]++; n++; }
      // 第 90 百分位當門檻，只看這格裡最明顯的邊緣
      let acc = 0, b = 0;
      for (; b < BINS; b++) { acc += hist[b]; if (acc >= n * 0.9) break; }
      const thr = Math.max((b / BINS) * GMAX, 0.02);
      let sl = 0, sg = 0, cnt = 0;
      for (let y = ys; y < ye; y++) for (let x = xs; x < xe; x++) {
        const i = y * iw + x;
        if (grad[i] > thr) { sl += Math.abs(lap[i]); sg += grad[i]; cnt++; }
      }
      tiles.push(cnt > 30 ? sl / (sg + 1e-6) : 0);
    }
  }
  tiles.sort((a, b) => b - a);
  return tiles.slice(0, TOP_TILES).reduce((a, v) => a + v, 0) / TOP_TILES;
}

/** 參考值：同資料夾第 90 百分位（這台相機、這種場景「清楚」大概長怎樣） */
export function referenceScore(scores) {
  const s = scores.filter((v) => v > 0).sort((a, b) => a - b);
  if (s.length < 8) return FALLBACK_REF;
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.9))];
}

/** 分類：使用者手動改過的優先 */
export function classify(score, ref, override = null) {
  if (override && override in CLASSES) return override;
  if (!(score > 0)) return 'mid';
  const r = score / ref;
  return r >= OK_RATIO ? 'ok' : r < BAD_RATIO ? 'bad' : 'mid';
}

/** 顯示用清晰度 0–100（跟同資料夾最清楚那群比） */
export const clarity = (score, ref) => Math.max(0, Math.min(100, Math.round((score / ref) * 100)));
