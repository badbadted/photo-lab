// 影像陣列小工具（純函式，可在 node 測）

/**
 * 16-bit RGB 等比縮小：每 k×k 個像素平均成一個（盒狀平均，不會產生鋸齒）。
 * k 取整數，縮完長邊 ≤ maxLong。
 * @returns {{data: Uint16Array, width: number, height: number}}
 */
export function shrinkRGB16(data, w, h, maxLong) {
  const k = Math.ceil(Math.max(w, h) / maxLong);
  if (k <= 1) return { data, width: w, height: h };
  const nw = Math.floor(w / k), nh = Math.floor(h / k), out = new Uint16Array(nw * nh * 3), n = k * k;
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < k; dy++) {
        let i = ((y * k + dy) * w + x * k) * 3;
        for (let dx = 0; dx < k; dx++, i += 3) { r += data[i]; g += data[i + 1]; b += data[i + 2]; }
      }
      const o = (y * nw + x) * 3;
      out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n); out[o + 2] = Math.round(b / n);
    }
  }
  return { data: out, width: nw, height: nh };
}
