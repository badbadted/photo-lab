// 迷你 EXIF 讀取（JPEG），只取相片資訊面板要顯示的欄位
const TAGS = { 0x010f: 'make', 0x0110: 'model', 0x829a: 'exposure', 0x829d: 'fnumber', 0x8827: 'iso', 0x9003: 'date', 0x920a: 'focal', 0xa434: 'lens' };
const SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

export function readJpegExif(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.byteLength < 4 || dv.getUint16(0) !== 0xffd8) return null;
  let off = 2;
  while (off + 4 <= dv.byteLength) {
    const marker = dv.getUint16(off), len = dv.getUint16(off + 2);
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break;
    if (marker === 0xffe1 && off + 10 <= dv.byteLength && dv.getUint32(off + 4) === 0x45786966) {
      try { return parseTiff(dv, off + 10, Math.min(dv.byteLength, off + 2 + len)); } catch { return null; }
    }
    off += 2 + len;
  }
  return null;
}

function parseTiff(dv, base, end) {
  const le = dv.getUint16(base) === 0x4949;
  const u16 = (o) => dv.getUint16(o, le), u32 = (o) => dv.getUint32(o, le);
  const out = {};
  const seen = new Set();
  const readIfd = (ifdOff) => {
    const p = base + ifdOff;
    if (seen.has(p) || p + 2 > end) return;
    seen.add(p);
    const n = u16(p);
    for (let i = 0; i < n; i++) {
      const e = p + 2 + i * 12;
      if (e + 12 > end) return;
      const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
      const bytes = (SIZE[type] || 1) * count;
      const vo = bytes > 4 ? base + u32(e + 8) : e + 8;
      if (vo + bytes > end) continue;
      if (tag === 0x8769) { readIfd(u32(e + 8)); continue; }
      const key = TAGS[tag];
      if (!key) continue;
      if (type === 2) out[key] = new TextDecoder().decode(new Uint8Array(dv.buffer, dv.byteOffset + vo, count)).replace(/\0+$/, '').trim();
      else if (type === 3) out[key] = u16(vo);
      else if (type === 4) out[key] = u32(vo);
      else if (type === 5 || type === 10) { const d = u32(vo + 4); out[key] = d ? u32(vo) / d : 0; }
    }
  };
  readIfd(u32(base + 4));
  return out;
}

/** 統一轉成面板要的格式；RAW 的資訊來自 LibRaw metadata */
export function infoFromExif(x) {
  if (!x) return null;
  return {
    camera: [x.make, x.model].filter(Boolean).join(' ').replace(/^(\S+) \1 /i, '$1 '),
    lens: x.lens || '', fnumber: x.fnumber || 0, shutter: x.exposure || 0, iso: x.iso || 0, focal: x.focal || 0,
    date: x.date ? x.date.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3') : '',
  };
}

export function infoFromLibRaw(m) {
  if (!m) return null;
  const pad = (n) => String(n).padStart(2, '0');
  const t = m.timestamp instanceof Date && !isNaN(m.timestamp) && m.timestamp.getTime() > 0 ? m.timestamp : null;
  return {
    camera: [m.camera_make, m.camera_model].filter(Boolean).join(' '),
    lens: m.lens?.Lens || m.lens?.makernotes?.Lens || '',
    fnumber: m.aperture || 0, shutter: m.shutter || 0, iso: m.iso_speed || 0, focal: m.focal_len || 0,
    date: t ? `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}` : '',
  };
}

export function fmtShutter(s) {
  if (!s) return '';
  return s >= 1 ? `${+s.toFixed(1)}s` : `1/${Math.round(1 / s)}s`;
}
