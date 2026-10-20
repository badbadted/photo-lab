// 照片解碼：RAW 走 LibRaw（WASM，在 Web Worker 裡跑），其餘交給 Chromium
import LibRaw from '/node_modules/libraw-wasm/dist/index.js';
import { readJpegExif, infoFromExif, infoFromLibRaw } from './exif.js';

export const RAW_EXT = ['cr3', 'cr2', 'nef', 'arw', 'dng', 'raf', 'orf', 'rw2', 'pef', 'srw'];
export const extOf = (p) => p.slice(p.lastIndexOf('.') + 1).toLowerCase();
export const isRaw = (p) => RAW_EXT.includes(extOf(p));

// 線性 16-bit、相機白平衡、不自動提亮：亮度與白平衡交給使用者在面板調
const RAW_SETTINGS = { useCameraWb: true, outputBps: 16, outputColor: 1, noAutoBright: true, gamm: [1, 1], userQual: 3, highlight: 0 };

/**
 * @returns {{kind:'raw', width, height, data:Uint16Array, info} | {kind:'bitmap', bitmap:ImageBitmap, width, height, info}}
 */
export async function decode(path, bytes) {
  if (isRaw(path)) {
    const raw = new LibRaw();
    try {
      await raw.open(bytes, RAW_SETTINGS);
      const meta = await raw.metadata(true).catch(() => null);
      const img = await raw.imageData();
      if (!img || img.colors !== 3 || img.bits !== 16) throw new Error('RAW 解碼結果格式不符');
      const data = img.data instanceof Uint16Array ? img.data : new Uint16Array(img.data.buffer, img.data.byteOffset, img.data.byteLength / 2);
      return { kind: 'raw', width: img.width, height: img.height, data, info: infoFromLibRaw(meta) };
    } catch (e) {
      throw new Error(`這個 RAW 檔解不開（${e.message || e}）`);
    } finally {
      raw.dispose();
    }
  }
  const type = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[extOf(path)];
  const bitmap = await createImageBitmap(new Blob([bytes], { type }), { imageOrientation: 'from-image', colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
    .catch(() => { throw new Error('這張照片解不開，檔案可能損毀'); });
  const info = type === 'image/jpeg' ? infoFromExif(readJpegExif(bytes)) : null;
  return { kind: 'bitmap', bitmap, width: bitmap.width, height: bitmap.height, info };
}
