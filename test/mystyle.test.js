import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  captureStyle, resolveStyle, setCustomStyles, getCustomStyles, customStyles, adoptOrphan, styleById,
  sanitizeCustomStyle, isCustomId, describeStyle, newStyleId,
} from '../renderer/styles.js';
import { ADJ, defaults, sanitize } from '../renderer/settings.js';

const KEYS = Object.keys(ADJ);
const close = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const photo = (o = {}) => ({ ...defaults(4000, 3000), ...o });

beforeEach(() => { setCustomStyles([]); });

test('存下來的風格套到「沒調過的照片」＝存檔當下看到的色調（不含光線）', () => {
  const S = photo({ temp: 12, con: 20, vib: 15, exp: 0.7, sh: 30, vig: -40, mid: 30, style: 'jp', amt: 60 });
  const mine = captureStyle(S, ['wb', 'vignette'], '測試', KEYS);
  setCustomStyles([mine]);
  const before = resolveStyle(S, KEYS), after = resolveStyle(photo({ style: mine.id, amt: 100 }), KEYS);
  for (const k of ['temp', 'tint', 'con', 'vib', 'sat', 'vig', 'mid', 'round', 'feat', 'vhl']) close(after.adj[k], before.adj[k]);
  for (const k of ['exp', 'hl', 'sh', 'wh', 'bl']) assert.equal(after.adj[k], 0, `${k} 不該被存`);
  close(after.fade, before.fade); close(after.gc, before.gc);
  after.splitS.forEach((v, i) => close(v, before.splitS[i]));
});

test('勾選光線就連光線一起存；色彩與對比一定會存', () => {
  const S = photo({ exp: 0.5, con: 10 });
  const a = captureStyle(S, ['light'], 'A', KEYS);
  assert.deepEqual(a.groups.sort(), ['color', 'light']);
  close(a.adj.exp, 0.5); close(a.adj.con, 10);
  const b = captureStyle(S, [], 'B', KEYS);
  assert.deepEqual(b.groups, ['color']);
  assert.equal(b.adj.exp, undefined);
});

test('強度縮放自訂風格', () => {
  const mine = captureStyle(photo({ vib: 40, style: 'film' }), [], 'X', KEYS);
  setCustomStyles([mine]);
  const r = resolveStyle(photo({ style: mine.id, amt: 50 }), KEYS);
  close(r.adj.vib, mine.adj.vib * 0.5);
  close(r.grain, mine.fx.grain * 0.5);
  assert.equal(resolveStyle(photo({ style: mine.id, amt: 0 }), KEYS).mono, false);
});

test('清洗：亂資料、注入字串、超長名稱、未知群組', () => {
  assert.equal(sanitizeCustomStyle(null), null);
  assert.equal(sanitizeCustomStyle({ id: 'jp', name: 'x' }), null); // 不能冒用內建 id
  assert.equal(sanitizeCustomStyle({ id: 'u_abc123', name: '   ' }), null);
  const s = sanitizeCustomStyle({ id: 'u_abc123', name: '<img src=x onerror=1>'.repeat(3), groups: ['color', 'hack'], adj: { con: 9999, exp: 1, evil: 1 }, fx: { fade: 9, splitS: [5, 'a'] } });
  assert.equal(s.name.length, 20);
  assert.deepEqual(s.groups, ['color']);
  assert.equal(s.adj.con, 200); assert.equal(s.adj.exp, undefined); assert.equal(s.adj.evil, undefined); // 沒勾光線就不收 exp
  assert.equal(s.fx.fade, 0.5); assert.deepEqual(s.fx.splitS, [0, 0, 0]);
});

test('清單：去重、照片設定檔帶的已刪除風格會暫時掛上', () => {
  const a = captureStyle(photo({ con: 5 }), [], 'A', KEYS);
  setCustomStyles([a, a, { bad: true }]);
  assert.equal(getCustomStyles().length, 1);
  const gone = captureStyle(photo({ sat: -30 }), [], '舊的', KEYS);
  adoptOrphan(gone);
  assert.equal(styleById(gone.id).name, '舊的');
  assert.ok(customStyles().find((s) => s.id === gone.id).orphan);
  assert.equal(getCustomStyles().length, 1, '已刪除的不會寫回清單');
  adoptOrphan(a); // 清單裡已經有就不重複掛
  assert.equal(customStyles().length, 2);
  assert.match(describeStyle(styleById(gone.id)), /被更新或刪除/);
});

test('照片設定檔引用我的風格：清單有就認得，沒有就退回「無」', () => {
  const a = captureStyle(photo({ con: 5 }), [], 'A', KEYS);
  setCustomStyles([a]);
  assert.equal(sanitize({ style: a.id }, 10, 10).style, a.id);
  setCustomStyles([]);
  assert.equal(sanitize({ style: a.id }, 10, 10).style, 'none');
});

test('id 格式', () => {
  for (let i = 0; i < 50; i++) assert.ok(isCustomId(newStyleId()));
  assert.ok(!isCustomId('u_'));
  assert.ok(!isCustomId('none'));
});
