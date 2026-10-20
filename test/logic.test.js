import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultCrop, ratioOf, fits, maxRect, fitCrop, tryRect, rotatedBounds, resizeFromCorner, scaleCrop } from '../renderer/crop.js';
import { ADJ, defaults, isDefault, sanitize, History, fmtValue } from '../renderer/settings.js';
import { readJpegExif, infoFromExif, fmtShutter } from '../renderer/exif.js';
import { halfLut } from '../renderer/pipeline.js';

const W = 6000, H = 4000;
const close = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('預設裁切＝整張圖且合法', () => {
  const C = defaultCrop(W, H);
  assert.ok(fits(C, C, W, H));
  close(ratioOf(C, W, H), 1.5);
});

test('拉直後最大裁切框剛好貼邊、不露白', () => {
  for (const angle of [-45, -12.5, 0.1, 7, 30, 45]) {
    for (const ratio of ['orig', '1', '0.8', '1.7778']) {
      const C = { ...defaultCrop(W, H), angle, ratio };
      fitCrop(C, W, H);
      assert.ok(fits(C, C, W, H), `angle ${angle} ratio ${ratio} 應合法`);
      close(C.w / C.h, ratioOf(C, W, H), 1e-6);
      const bigger = { ...C, w: C.w * 1.01, h: C.h * 1.01 };
      assert.ok(!fits(C, bigger, W, H), `angle ${angle} ratio ${ratio} 放大 1% 應超出`);
    }
  }
});

test('直橫互換', () => {
  const C = { ...defaultCrop(W, H), ratio: '1.7778', flip: true };
  close(ratioOf(C, W, H), 1 / 1.7778, 1e-6);
  assert.equal(ratioOf({ ...C, ratio: 'free' }, W, H), null);
});

test('拖曳撞邊會停在邊上', () => {
  const C = { ...defaultCrop(W, H), ratio: '1' };
  fitCrop(C, W, H);
  Object.assign(C, { w: 1000, h: 1000 });
  tryRect(C, { ...C }, { cx: 99999, cy: 0, w: 1000, h: 1000 }, W, H);
  assert.ok(fits(C, C, W, H));
  close(C.cx, W / 2 - 500, 0.5);
});

test('拖角點鎖比例、對角固定', () => {
  const r0 = { cx: 0, cy: 0, w: 1600, h: 1000 };
  const r = resizeFromCorner(r0, 1, 1, { x: 400, y: 100 }, 1.6);
  close(r.w / r.h, 1.6, 1e-6);
  close(r.cx - r.w / 2, -800); close(r.cy - r.h / 2, -500); // 左上角沒動
  const free = resizeFromCorner(r0, -1, -1, { x: 0, y: 0 }, null);
  close(free.w, 800); close(free.h, 500);
});

test('旋轉外框尺寸', () => {
  const b = rotatedBounds(90, W, H);
  close(b.w, H); close(b.h, W);
});

test('不同尺寸的舊設定等比換算', () => {
  const C = { ...defaultCrop(W, H), cx: 300, cy: -200, w: 3000, h: 2000 };
  const s = scaleCrop(C, W, H, W / 2, H / 2);
  close(s.cx, 150); close(s.w, 1500);
});

test('maxRect 未給比例時沿用目前比例', () => {
  const r = maxRect({ angle: 0, w: 200, h: 100 }, null, W, H);
  close(r.w / r.h, 2, 1e-6);
});

test('設定：預設、清洗、判斷是否動過', () => {
  const d = defaults(W, H);
  assert.ok(isDefault(d, W, H));
  const s = sanitize({ exp: 99, con: 'x', hack: 1, crop: { ratio: 'evil', angle: 90, cx: 5 } }, W, H);
  assert.equal(s.exp, 5); assert.equal(s.con, 0); assert.equal(s.hack, undefined);
  assert.equal(s.crop.ratio, 'orig'); assert.equal(s.crop.angle, 45); assert.equal(s.crop.cx, 5);
  assert.ok(!isDefault(s, W, H));
  assert.ok(isDefault(sanitize(null, W, H), W, H));
  for (const k in ADJ) assert.equal(typeof fmtValue(k, ADJ[k][2]), 'string');
  assert.equal(fmtValue('exp', 0.5), '+0.50');
  assert.equal(fmtValue('mid', 50), '50');
});

test('歷史紀錄：復原、重做、分岔後丟掉未來', () => {
  const h = new History({ v: 0 });
  h.push('a', { v: 1 }); h.push('b', { v: 2 });
  assert.equal(h.undo().v, 1); assert.equal(h.undo().v, 0); assert.equal(h.undo().v, 0);
  assert.ok(!h.canUndo); assert.equal(h.redo().v, 1);
  h.push('c', { v: 9 });
  assert.ok(!h.canRedo); assert.equal(h.items.length, 3); assert.equal(h.go(0).v, 0);
  const s = h.state; s.v = 123; assert.equal(h.state.v, 0); // 回傳的是副本
});

function makeJpegWithExif() {
  // 小端 TIFF：IFD0 有 Make、Model、ExifIFD；ExifIFD 有快門、光圈、ISO、日期、鏡頭
  const parts = [];
  const tiff = new Uint8Array(400), dv = new DataView(tiff.buffer);
  tiff.set([0x49, 0x49, 0x2a, 0x00]); dv.setUint32(4, 8, true);
  let p = 8, data = 200;
  const str = (s) => { const b = new TextEncoder().encode(s + '\0'); const o = data; tiff.set(b, o); data += b.length + (b.length % 2); return [b.length, o]; };
  const entries0 = [];
  const [ml, mo] = str('Canon'); entries0.push([0x010f, 2, ml, mo]);
  const [nl, no] = str('Canon EOS R6'); entries0.push([0x0110, 2, nl, no]);
  entries0.push([0x8769, 4, 1, 120]);
  const ifd = (at, list) => { dv.setUint16(at, list.length, true); list.forEach(([t, ty, c, v], i) => { const e = at + 2 + i * 12; dv.setUint16(e, t, true); dv.setUint16(e + 2, ty, true); dv.setUint32(e + 4, c, true); if (ty === 3) dv.setUint16(e + 8, v, true); else dv.setUint32(e + 8, v, true); }); dv.setUint32(at + 2 + list.length * 12, 0, true); };
  ifd(p, entries0);
  const rat = (n, d) => { const o = data; dv.setUint32(o, n, true); dv.setUint32(o + 4, d, true); data += 8; return o; };
  const ex = [[0x829a, 5, 1, rat(1, 250)], [0x829d, 5, 1, rat(80, 10)], [0x8827, 3, 1, 100]];
  const [dl, dofs] = str('2026:10:18 16:42:00'); ex.push([0x9003, 2, dl, dofs]);
  const [ll, lo] = str('RF24-105mm F4 L IS USM'); ex.push([0xa434, 2, ll, lo]);
  ifd(120, ex);
  const app1 = new Uint8Array(2 + 2 + 6 + data);
  const a = new DataView(app1.buffer);
  a.setUint16(0, 0xffe1); a.setUint16(2, 2 + 6 + data);
  app1.set([0x45, 0x78, 0x69, 0x66, 0, 0], 4); app1.set(tiff.subarray(0, data), 10);
  parts.push(new Uint8Array([0xff, 0xd8]), app1, new Uint8Array([0xff, 0xda, 0, 2]));
  const out = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
  let o = 0; for (const x of parts) { out.set(x, o); o += x.length; }
  return out;
}

test('EXIF 讀取', () => {
  const info = infoFromExif(readJpegExif(makeJpegWithExif()));
  assert.equal(info.camera, 'Canon EOS R6');
  assert.equal(info.lens, 'RF24-105mm F4 L IS USM');
  close(info.fnumber, 8); assert.equal(info.iso, 100);
  assert.equal(fmtShutter(info.shutter), '1/250s');
  assert.equal(info.date, '2026-10-18 16:42:00');
  assert.equal(readJpegExif(new Uint8Array([1, 2, 3])), null);
  assert.equal(readJpegExif(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff])), null); // 截斷檔不會丟例外
});

test('16-bit → 半精度轉換', () => {
  const lut = halfLut();
  const toF = (h) => { const s = h >> 15 ? -1 : 1, e = (h >> 10) & 31, m = h & 1023; return e === 0 ? s * m * 2 ** -24 : s * (1 + m / 1024) * 2 ** (e - 15); };
  assert.equal(lut[0], 0); assert.equal(lut[65535], 0x3c00);
  for (const i of [1, 7, 100, 1000, 12345, 32768, 50000, 65534]) {
    const v = i / 65535, got = toF(lut[i]);
    assert.ok(Math.abs(got - v) <= v * 1e-3 + 1e-7, `${i}: ${got} vs ${v}`);
  }
  for (let i = 1; i < 65536; i++) assert.ok(toF(lut[i]) >= toF(lut[i - 1]), `單調遞增 @${i}`);
});
