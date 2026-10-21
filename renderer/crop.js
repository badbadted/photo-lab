// 裁切幾何（純函式，可在 node 測）
// 座標系：原點＝原圖中心，單位＝原圖像素；裁切框是「旋轉後畫面」上的正框，
// 必須整個落在旋轉後的原圖內（不露白邊）。

export const RATIOS = [
  { v: 'orig', label: '原始比例' },
  { v: '1', label: '1:1' },
  { v: '0.8', label: '4:5' },
  { v: '0.75', label: '3:4' },
  { v: '0.6667', label: '2:3' },
  { v: '0.5625', label: '9:16' },
  { v: '1.7778', label: '16:9' },
  { v: 'free', label: '自由' },
];

const rad = (a) => (a * Math.PI) / 180;

export function defaultCrop(W, H) {
  return { ratio: 'orig', flip: false, angle: 0, cx: 0, cy: 0, w: W, h: H };
}

/** 目前比例（寬/高）；自由比例回 null */
export function ratioOf(C, W, H) {
  if (C.ratio === 'free') return null;
  const a = C.ratio === 'orig' ? W / H : +C.ratio;
  return C.flip ? 1 / a : a;
}

export function fits(C, r, W, H) {
  const co = Math.cos(rad(C.angle)), si = Math.sin(rad(C.angle));
  for (const [ux, uy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const x = r.cx + (ux * r.w) / 2, y = r.cy + (uy * r.h) / 2;
    const sx = co * x + si * y, sy = -si * x + co * y; // 反旋轉回原圖
    if (Math.abs(sx) > W / 2 + 0.01 || Math.abs(sy) > H / 2 + 0.01) return false;
  }
  return true;
}

/** 指定比例下、置中、不露白邊的最大裁切框 */
export function maxRect(C, a, W, H) {
  a = a || C.w / C.h;
  const co = Math.abs(Math.cos(rad(C.angle))), si = Math.abs(Math.sin(rad(C.angle)));
  const h = Math.min(W / (a * co + si), H / (a * si + co));
  return { cx: 0, cy: 0, w: h * a, h };
}

export function fitCrop(C, W, H) {
  Object.assign(C, maxRect(C, ratioOf(C, W, H), W, H));
  return C;
}

/** 從 from 往 to 移動，撞到圖邊就停在能到的最遠處（二分搜尋） */
export function tryRect(C, from, to, W, H) {
  if (fits(C, to, W, H)) { Object.assign(C, to); return C; }
  let lo = 0, hi = 1;
  const at = (m) => ({ cx: from.cx + (to.cx - from.cx) * m, cy: from.cy + (to.cy - from.cy) * m, w: from.w + (to.w - from.w) * m, h: from.h + (to.h - from.h) * m });
  for (let n = 0; n < 32; n++) { const m = (lo + hi) / 2; fits(C, at(m), W, H) ? (lo = m) : (hi = m); }
  Object.assign(C, at(lo));
  return C;
}

/** 拉直時整張圖旋轉後的外框尺寸 */
export function rotatedBounds(angle, W, H) {
  const co = Math.abs(Math.cos(rad(angle))), si = Math.abs(Math.sin(rad(angle)));
  return { w: W * co + H * si, h: W * si + H * co };
}

/** 拖曳角點：對角固定，鎖比例時以較大的一邊為準 */
export function resizeFromCorner(r0, ux, uy, p, a, minSize = 32) {
  const ax = r0.cx - (ux * r0.w) / 2, ay = r0.cy - (uy * r0.h) / 2;
  let w = Math.max(minSize, (p.x - ax) * ux), h = Math.max(minSize, (p.y - ay) * uy);
  if (a) { if (w / h > a) h = w / a; else w = h * a; }
  return { cx: ax + (ux * w) / 2, cy: ay + (uy * h) / 2, w, h };
}

/** 載入舊設定時，圖片尺寸若不同（例如換了解碼方式）就等比換算 */
export function scaleCrop(C, fromW, fromH, W, H) {
  const k = Math.min(W / fromW, H / fromH);
  const out = { ...C, cx: C.cx * k, cy: C.cy * k, w: C.w * k, h: C.h * k };
  if (!fits(out, out, W, H)) fitCrop(out, W, H);
  return out;
}

/** 比例值是否合法：清單裡的，或「固定尺寸」換算出來的數字（0.1～10） */
export function validRatio(v) {
  if (RATIOS.some((r) => r.v === v)) return true;
  const n = Number(v);
  return typeof v === 'string' && Number.isFinite(n) && n >= 0.1 && n <= 10;
}
