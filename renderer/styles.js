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

// ---------- 我的風格 ----------
// 自訂風格的格式：{ id:'u_xxx', name, created, groups:[...], adj:{拉桿: 疊加量}, fx:{fade, gc, grain, mono, splitS, splitH} }
// fx 是存檔當下「已換算好」的效果（強度 100% 時的量），套用時再乘上強度。

export const GROUP_KEYS = {
  color: ['con', 'vib', 'sat'],
  wb: ['temp', 'tint'],
  light: ['exp', 'hl', 'sh', 'wh', 'bl'],
  vignette: ['vig', 'mid', 'round', 'feat', 'vhl'],
};
export const GROUP_NAMES = { color: '色彩與對比', wb: '白平衡', light: '光線', vignette: '暈映' };
// 拉桿預設值（自訂風格存的是「跟預設差多少」）
const BASE = { mid: 50, feat: 50 };
const NAME_MAX = 20;

let custom = [];   // 使用者存的
let orphans = [];  // 已刪除、但目前開著的照片還在用的（只放記憶體，不寫回清單）

export const customStyles = () => custom.concat(orphans);
export const allStyles = () => customStyles().concat(STYLES);
export const styleById = (id) => allStyles().find((s) => s.id === id) || STYLES[0];
export const isCustomId = (id) => typeof id === 'string' && /^u_[a-z0-9]{6,16}$/.test(id);

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const vec3 = (v) => (Array.isArray(v) && v.length === 3 ? v.map((x) => Math.max(-1, Math.min(1, num(x)))) : [0, 0, 0]);

/** 讀進來的自訂風格一律清洗；格式不對回 null */
export function sanitizeCustomStyle(raw) {
  if (!raw || typeof raw !== 'object' || !isCustomId(raw.id)) return null;
  const name = String(raw.name ?? '').trim().slice(0, NAME_MAX);
  if (!name) return null;
  const groups = Array.isArray(raw.groups) ? raw.groups.filter((g) => g in GROUP_KEYS) : ['color'];
  const adj = {};
  const allowed = new Set(groups.flatMap((g) => GROUP_KEYS[g]));
  for (const k of allowed) if (raw.adj && Number.isFinite(Number(raw.adj[k]))) adj[k] = Math.max(-200, Math.min(200, Number(raw.adj[k])));
  const f = raw.fx || {};
  const fx = {
    fade: Math.max(0, Math.min(0.5, num(f.fade))), gc: Math.max(0, Math.min(1, num(f.gc))),
    grain: Math.max(0, Math.min(0.2, num(f.grain))), mono: !!f.mono, splitS: vec3(f.splitS), splitH: vec3(f.splitH),
  };
  return { id: raw.id, name, created: String(raw.created ?? '').slice(0, 30), groups, adj, fx };
}

export function setCustomStyles(list) {
  custom = (Array.isArray(list) ? list : []).map(sanitizeCustomStyle).filter(Boolean);
  const ids = new Set(custom.map((s) => s.id));
  custom = custom.filter((s, i, a) => a.findIndex((x) => x.id === s.id) === i);
  orphans = orphans.filter((o) => !ids.has(o.id));
  return custom;
}
export const getCustomStyles = () => custom.slice();

/** 照片設定檔裡帶的風格定義：清單裡沒有就當「已刪除」暫時掛上，讓照片維持原樣 */
export function adoptOrphan(def) {
  const s = sanitizeCustomStyle(def);
  if (!s || allStyles().some((x) => x.id === s.id)) return;
  orphans.push({ ...s, orphan: true });
}

export const newStyleId = () => 'u_' + Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 10);

/**
 * 把「目前看到的色調」打包成自訂風格。
 * @param S 目前設定；@param groups 要包含的群組（color 一定會含）；@param adjKeys 全部拉桿 key
 */
export function captureStyle(S, groups, name, adjKeys, id = newStyleId()) {
  const g = Array.from(new Set(['color', ...groups.filter((x) => x in GROUP_KEYS)]));
  const r = resolveStyle(S, adjKeys);
  const adj = {};
  for (const grp of g) for (const k of GROUP_KEYS[grp]) {
    const v = +(r.adj[k] - (BASE[k] || 0)).toFixed(3);
    if (v) adj[k] = v;
  }
  return sanitizeCustomStyle({
    id, name, groups: g, adj, created: new Date().toISOString().slice(0, 10),
    fx: { fade: r.fade, gc: r.gc, grain: r.grain, mono: r.mono, splitS: r.splitS, splitH: r.splitH },
  });
}

export function describeStyle(st) {
  if (!st.fx) return st.desc;
  const parts = st.groups.map((g) => GROUP_NAMES[g]).join('、');
  return `我的風格：${st.name}${st.created ? `（${st.created} 存）` : ''}。包含${parts}。${st.orphan ? '這是這張照片當初套用的版本，風格後來被更新或刪除了，效果維持原樣。' : ''}`;
}

/** 色相 → RGB（飽和度 1、亮度 0.5） */
export function hueRGB(h) {
  const f = (n) => { const k = (n + h / 30) % 12; return 0.5 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [f(0), f(8), f(4)];
}

/**
 * 把風格換算成 shader 要的參數。
 * @param S 設定（含 style、amt）；@param adjKeys 拉桿 key 清單；@param ranges 選填，{key:[min,max]} 夾範圍
 * @returns {{adj: Object, fade, gc, grain, mono, splitS: [r,g,b], splitH: [r,g,b]}}
 */
export function resolveStyle(S, adjKeys, ranges = null) {
  const st = styleById(S.style), k = Math.max(0, Math.min(1, (S.amt ?? 100) / 100));
  const adj = {};
  for (const key of adjKeys) {
    let v = S[key] + (st.adj?.[key] || 0) * k;
    if (ranges?.[key]) v = Math.max(ranges[key][0], Math.min(ranges[key][1], v));
    adj[key] = v;
  }
  if (st.fx) {
    const f = st.fx;
    return { adj, fade: f.fade * k, gc: f.gc * k, grain: f.grain * k, mono: f.mono && k > 0, splitS: f.splitS.map((v) => v * k), splitH: f.splitH.map((v) => v * k) };
  }
  const tone = (pair) => (pair ? hueRGB(pair[0]).map((v) => (v - 0.5) * pair[1] * k) : [0, 0, 0]);
  return {
    adj, fade: (st.fade || 0) * k, gc: (st.gc || 0) * k, grain: (st.grain || 0) * k,
    mono: !!st.mono && k > 0, splitS: tone(st.split?.s), splitH: tone(st.split?.h),
  };
}
