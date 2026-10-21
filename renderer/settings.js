// 調整項目定義、預設值、歷史紀錄（純邏輯，可在 node 測）
import { defaultCrop, validRatio } from './crop.js';
import { allStyles } from './styles.js';

// key: [最小, 最大, 預設, 名稱, 步進]
export const ADJ = {
  temp: [-100, 100, 0, '色溫'], tint: [-100, 100, 0, '色調'],
  exp: [-5, 5, 0, '曝光', 0.05], con: [-100, 100, 0, '對比'],
  hl: [-100, 100, 0, '亮部'], sh: [-100, 100, 0, '陰影'],
  wh: [-100, 100, 0, '白色'], bl: [-100, 100, 0, '黑色'],
  vib: [-100, 100, 0, '鮮豔度'], sat: [-100, 100, 0, '飽和度'],
  vig: [-100, 100, 0, '暈映量'], mid: [0, 100, 50, '中點'], round: [-100, 100, 0, '圓度'],
  feat: [0, 100, 50, '羽化'], vhl: [0, 100, 0, '亮部保護'],
};

export const GROUPS = [
  { panel: 'basic', title: '白平衡', keys: ['temp', 'tint'] },
  { panel: 'basic', title: '光線', keys: ['exp', 'con', 'hl', 'sh', 'wh', 'bl'] },
  { panel: 'basic', title: '色彩', keys: ['vib', 'sat'] },
  { panel: 'fx', title: '裁切後暈映', keys: ['vig', 'mid', 'round', 'feat', 'vhl'] },
];

export const SCHEMA_VERSION = 1;

export function defaults(W, H) {
  const s = { crop: defaultCrop(W, H), style: 'none', amt: 100 };
  for (const k in ADJ) s[k] = ADJ[k][2];
  return s;
}

export const clone = (s) => JSON.parse(JSON.stringify(s));

const near = (a, b) => Math.abs(a - b) < 1e-6;
export function isDefault(s, W, H) {
  const d = defaults(W, H);
  for (const k in ADJ) if (!near(s[k], d[k])) return false;
  if (s.style !== 'none' || !near(s.amt, 100)) return false;
  const c = s.crop;
  return c.ratio === 'orig' && !c.flip && !c.size && near(c.angle, 0) && near(c.cx, 0) && near(c.cy, 0) && near(c.w, W) && near(c.h, H);
}

/** 讀進來的設定一律過濾：未知欄位丟掉、數值夾在範圍內 */
export function sanitize(raw, W, H) {
  const s = defaults(W, H);
  if (!raw || typeof raw !== 'object') return s;
  for (const k in ADJ) {
    const v = Number(raw[k]);
    if (Number.isFinite(v)) s[k] = Math.min(ADJ[k][1], Math.max(ADJ[k][0], v));
  }
  if (allStyles().some((x) => x.id === raw.style)) s.style = raw.style;
  if (Number.isFinite(Number(raw.amt))) s.amt = Math.min(100, Math.max(0, Number(raw.amt)));
  const c = raw.crop;
  if (c && typeof c === 'object') {
    if (validRatio(c.ratio)) s.crop.ratio = c.ratio;
    // 手機版「尺寸」：存照片時縮放成固定像素
    const sw = Math.round(Number(c.size?.w)), sh = Math.round(Number(c.size?.h));
    if (sw >= 16 && sw <= 10000 && sh >= 16 && sh <= 10000) s.crop.size = { w: sw, h: sh };
    s.crop.flip = !!c.flip;
    for (const k of ['angle', 'cx', 'cy', 'w', 'h']) if (Number.isFinite(Number(c[k]))) s.crop[k] = Number(c[k]);
    s.crop.angle = Math.min(45, Math.max(-45, s.crop.angle));
  }
  return s;
}

export function fmtValue(k, v) {
  if (k === 'exp') return (v > 0 ? '+' : '') + v.toFixed(2);
  return (v > 0 && ADJ[k][0] < 0 ? '+' : '') + Math.round(v);
}

export class History {
  constructor(initial, label = '匯入') { this.items = [{ n: label, s: clone(initial) }]; this.cur = 0; }
  get state() { return clone(this.items[this.cur].s); }
  push(label, s) {
    this.items = this.items.slice(0, this.cur + 1);
    this.items.push({ n: label, s: clone(s) });
    this.cur++;
  }
  undo() { if (this.cur > 0) this.cur--; return this.state; }
  redo() { if (this.cur < this.items.length - 1) this.cur++; return this.state; }
  go(i) { this.cur = Math.max(0, Math.min(this.items.length - 1, i)); return this.state; }
  get canUndo() { return this.cur > 0; }
  get canRedo() { return this.cur < this.items.length - 1; }
}
