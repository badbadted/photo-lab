// 自動調整：看亮度分布與色偏，回推拉桿數值（純函式，統計交給呼叫端，可在 node 測）
// stats(P) 要回傳：以設定 P 渲染後的 { p005, p05, p50, p995, clip, r, g, b }
//   p00x 為亮度百分位（0–1，sRGB 編碼值）、clip 為過曝比例
//   r/g/b 為「接近灰白」的中間調像素的線性平均，neutral 為這類像素佔比

const toLin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * 自動白平衡：只看接近灰白的像素（彩色衣服、三角錐不算），推回中性；只修一半，
 * 避免把夕陽、雨天冷調這類刻意的色調洗掉。灰白像素太少（滿版彩色）就不修，差一點點也不修。
 */
export function autoWhiteBalance(P, stats) {
  const st = stats({ ...P, temp: 0, tint: 0 });
  if (!(st.r > 0 && st.g > 0 && st.b > 0) || !(st.neutral >= 0.03)) return P;
  const dz = (v) => (Math.abs(v) < 6 ? 0 : Math.round(v));
  P.temp = dz(clamp((Math.log(st.b / st.r) / 0.7) * 100 * 0.5, -50, 50));
  P.tint = dz(clamp((Math.log(st.g / ((st.r + st.b) / 2)) / 0.25) * 100 * 0.5, -25, 25));
  return P;
}

/** 自動光線：中間調明顯偏暗/偏亮才動曝光，再補亮部、陰影、白色、黑色 */
export function autoTone(P, stats) {
  for (const k of ['exp', 'hl', 'sh', 'wh', 'bl']) P[k] = 0;
  let st = stats(P);
  const target = clamp(st.p50, 0.36, 0.58); // 中間調在 0.36～0.58 視為曝光正常
  P.exp = +clamp(Math.log2(toLin(target) / toLin(Math.max(st.p50, 0.01))) * 0.85, -2, 2).toFixed(2);
  st = stats(P);
  P.hl = Math.round(-Math.min(70, st.clip * 1500 + (st.p995 > 0.97 ? 20 : 0)));
  P.sh = Math.round(clamp((0.18 - st.p05) * 250, 0, 50));
  st = stats(P);
  P.wh = Math.round(clamp((0.97 - st.p995) * 160, -40, 40));
  P.bl = Math.round(clamp(-(st.p005 - 0.02) * 300, -30, 30));
  P.vib = Math.max(P.vib, 10);
  return P;
}

/** 從 RGBA 像素算 stats 需要的統計值 */
export function pixelStats(px) {
  const n = px.length / 4, hist = new Uint32Array(1024);
  let sr = 0, sg = 0, sb = 0, cnt = 0, clip = 0;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255;
    const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    hist[Math.min(1023, Math.floor(L * 1024))]++;
    if (L > 0.995) clip++;
    const mx = Math.max(r, g, b), chroma = mx > 0 ? (mx - Math.min(r, g, b)) / mx : 0;
    if (L > 0.15 && L < 0.9 && chroma < 0.15) { sr += toLin(r); sg += toLin(g); sb += toLin(b); cnt++; }
  }
  const q = (p) => { const t = p * n; let acc = 0; for (let i = 0; i < 1024; i++) { acc += hist[i]; if (acc > t) return (i + 0.5) / 1024; } return 1; };
  return { p005: q(0.005), p05: q(0.05), p50: q(0.5), p995: q(0.995), clip: clip / n, neutral: cnt / n, r: cnt ? sr / cnt : 0, g: cnt ? sg / cnt : 0, b: cnt ? sb / cnt : 0 };
}
