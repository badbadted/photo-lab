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

/**
 * 對焦分析用：解成長邊不超過 maxLong 的 RGBA。
 * RAW 優先用檔案內嵌的預覽 JPEG（快很多），太小才整張解（半尺寸）。
 */
export async function decodeForFocus(path, bytes, maxLong) {
  let blob = null;
  if (isRaw(path)) {
    const raw = new LibRaw();
    try {
      await raw.open(bytes, { halfSize: true, outputBps: 8, useCameraWb: true });
      const th = await raw.thumbnailData().catch(() => null);
      if (th && th.format === 'jpeg' && Math.max(th.width, th.height) >= 1000) blob = new Blob([th.data], { type: 'image/jpeg' });
      else {
        const img = await raw.imageData();
        if (!img || img.colors !== 3) throw new Error('RAW 解碼結果格式不符');
        const n = img.width * img.height, rgba = new Uint8ClampedArray(n * 4), d = img.data;
        for (let i = 0; i < n; i++) { rgba[i * 4] = d[i * 3]; rgba[i * 4 + 1] = d[i * 3 + 1]; rgba[i * 4 + 2] = d[i * 3 + 2]; rgba[i * 4 + 3] = 255; }
        return scaleRGBA(await createImageBitmap(new ImageData(rgba, img.width, img.height)), maxLong);
      }
    } finally { raw.dispose(); }
  } else {
    const type = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[extOf(path)];
    blob = new Blob([bytes], { type });
  }
  return scaleRGBA(await createImageBitmap(blob, { imageOrientation: 'from-image' }), maxLong);
}

async function scaleRGBA(bmp, maxLong) {
  const k = Math.min(1, maxLong / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const oc = new OffscreenCanvas(w, h), g = oc.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return { px: g.getImageData(0, 0, w, h).data, w, h };
}
