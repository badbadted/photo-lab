// 風格：疊在使用者拉桿上的一層，不改動拉桿數值（純函式，可在 node 測）
// adj：加到拉桿上的量；fade 褪色；split 陰影/亮部色調 [色相°, 強度]；gc 綠轉青；mono 黑白；grain 顆粒
export const STYLES = [
  { id: 'none', name: '無', desc: '不套風格。' },
  { id: 'jp', name: '日系清新', desc: '偏亮、低對比、微微發青，暗部帶一點霧感，綠色往青色靠，整體乾淨透亮。',
    adj: { exp: 0.35, con: -22, hl: -30, sh: 28, temp: -10, tint: -4, sat: -14, vib: 6 }, fade: 0.07, split: { s: [190, 0.08], h: [40, 0.03] }, gc: 0.5 },
  { id: 'vivid', name: '鮮豔', desc: '色彩飽滿、對比加強，藍天綠地更跳，膚色不會過紅。',
    adj: { con: 22, vib: 42, sat: 8, wh: 10, bl: -12, sh: 10 } },
  { id: 'film', name: '底片復古', desc: '暖色偏移、暗部褪成灰調、略降飽和，加一點底片顆粒。',
    adj: { con: -8, temp: 12, sat: -18, hl: -15 }, fade: 0.11, split: { s: [180, 0.07], h: [35, 0.09] }, grain: 0.022 },
  { id: 'teal', name: '電影青橙', desc: '暗部偏青、亮部與膚色偏橙，電影海報常見的配色。',
    adj: { con: 16, hl: -22, sat: -6, vib: 8 }, split: { s: [188, 0.2], h: [30, 0.15] } },
  { id: 'warm', name: '暖陽', desc: '像傍晚陽光，整體偏暖、亮部帶金黃。',
    adj: { temp: 28, exp: 0.12, vib: 16, sh: 8 }, split: { h: [45, 0.08] } },
  { id: 'cool', name: '冷冽', desc: '偏冷偏藍、飽和略降、對比稍強，適合雨天、城市、冬天。',
    adj: { temp: -28, tint: 4, con: 12, sat: -12 } },
  { id: 'soft', name: '柔和人像', desc: '降低對比、提亮暗部、膚色偏暖柔和，適合拍人。',
    adj: { con: -16, sh: 22, hl: -15, sat: -8, vib: 6, temp: 6 }, fade: 0.04 },
  { id: 'bw', name: '經典黑白', desc: '黑白，加一點對比讓層次分明。',
    adj: { con: 24, sh: -4 }, mono: true },
];

export const styleById = (id) => STYLES.find((s) => s.id === id) || STYLES[0];

/** 色相 → RGB（飽和度 1、亮度 0.5） */
export function hueRGB(h) {
  const f = (n) => { const k = (n + h / 30) % 12; return 0.5 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [f(0), f(8), f(4)];
}

/**
 * 把風格換算成 shader 要的參數。
 * @param S 設定（含 style、amt）；@param adjKeys 拉桿 key 清單
 * @returns {{adj: Object, fade, gc, grain, mono, splitS: [r,g,b], splitH: [r,g,b]}}
 */
export function resolveStyle(S, adjKeys) {
  const st = styleById(S.style), k = Math.max(0, Math.min(1, (S.amt ?? 100) / 100));
  const adj = {};
  for (const key of adjKeys) adj[key] = S[key] + (st.adj?.[key] || 0) * k;
  const tone = (pair) => (pair ? hueRGB(pair[0]).map((v) => (v - 0.5) * pair[1] * k) : [0, 0, 0]);
  return {
    adj, fade: (st.fade || 0) * k, gc: (st.gc || 0) * k, grain: (st.grain || 0) * k,
    mono: !!st.mono && k > 0, splitS: tone(st.split?.s), splitH: tone(st.split?.h),
  };
}
