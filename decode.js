// 照片解碼：RAW 走 LibRaw（WASM，在 Web Worker 裡跑），其餘交給 Chromium
import LibRaw from './vendor/libraw/index.js?v=mvhpsqfc';
import { readJpegExif, infoFromExif, infoFromLibRaw } from './exif.js?v=mvhpsqfc';
import { shrinkRGB16 } from './raster.js?v=mvhpsqfc';

export const RAW_EXT = ['cr3', 'cr2', 'nef', 'arw', 'dng', 'raf', 'orf', 'rw2', 'pef', 'srw'];
export const extOf = (p) => p.slice(p.lastIndexOf('.') + 1).toLowerCase();
export const isRaw = (p) => RAW_EXT.includes(extOf(p));

// 線性 16-bit、相機白平衡、不自動提亮：亮度與白平衡交給使用者在面板調
const RAW_SETTINGS = { useCameraWb: true, outputBps: 16, outputColor: 1, noAutoBright: true, gamm: [1, 1], userQual: 3, highlight: 0 };

const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif' };

/**
 * @param opts.maxLong 長邊上限（手機版用，省記憶體）。RAW 會先試半尺寸解碼（iPhone 的 DNG 不吃這個設定），
 *   解完超過上限再縮；整張解不開（多半是記憶體不夠）就改用檔案內嵌的預覽 JPEG，回傳 preview: true
 * @returns {{kind:'raw', width, height, data:Uint16Array, info} | {kind:'bitmap', bitmap:ImageBitmap|HTMLCanvasElement, width, height, info}}
 */
export async function decode(path, bytes, opts = {}) {
  if (isRaw(path)) {
    const raw = new LibRaw();
    try {
      await raw.open(bytes, opts.maxLong ? { ...RAW_SETTINGS, halfSize: true } : RAW_SETTINGS);
      const meta = await raw.metadata(true).catch(() => null);
      const img = await raw.imageData();
      if (!img || img.colors !== 3 || img.bits !== 16) throw new Error('RAW 解碼結果格式不符');
      let data = img.data instanceof Uint16Array ? img.data : new Uint16Array(img.data.buffer, img.data.byteOffset, img.data.byteLength / 2);
      let { width, height } = img;
      if (opts.maxLong && Math.max(width, height) > opts.maxLong) ({ data, width, height } = shrinkRGB16(data, width, height, opts.maxLong));
      return { kind: 'raw', width, height, data, info: infoFromLibRaw(meta) };
    } catch (e) {
      raw.dispose();
      if (opts.maxLong) {
        const pv = await decodeRawPreview(bytes, opts.maxLong).catch(() => null);
        if (pv) return pv;
      }
      throw new Error(`這個 RAW 檔解不開（${e.message || e}）`);
    } finally {
      raw.dispose();
    }
  }
  const type = MIME[extOf(path)];
  let bitmap = await decodeBitmap(new Blob([bytes], { type }), type);
  if (opts.maxLong && Math.max(bitmap.width, bitmap.height) > opts.maxLong) bitmap = await shrink(bitmap, opts.maxLong);
  const info = type === 'image/jpeg' ? infoFromExif(readJpegExif(bytes)) : null;
  return { kind: 'bitmap', bitmap, width: bitmap.width, height: bitmap.height, info };
}

/** 只取 RAW 檔內嵌的預覽 JPEG（整張解不開時的退路，畫質接近一般 JPEG） */
export async function decodeRawPreview(bytes, maxLong) {
  const raw = new LibRaw();
  try {
    await raw.open(bytes, { halfSize: true, outputBps: 8 });
    const meta = await raw.metadata(false).catch(() => null);
    const th = await raw.thumbnailData();
    if (!th || th.format !== 'jpeg' || Math.max(th.width, th.height) < 800) return null;
    let bitmap = await decodeBitmap(new Blob([th.data], { type: 'image/jpeg' }), 'image/jpeg');
    if (maxLong && Math.max(bitmap.width, bitmap.height) > maxLong) bitmap = await shrink(bitmap, maxLong);
    return { kind: 'bitmap', bitmap, width: bitmap.width, height: bitmap.height, info: infoFromLibRaw(meta), preview: true };
  } finally { raw.dispose(); }
}

/** 優先 createImageBitmap（照 EXIF 轉正）；不支援這些選項的瀏覽器（舊 Safari）改走 <img>，它預設也會照 EXIF 轉正 */
async function decodeBitmap(blob, type) {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image', colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  } catch { /* 往下試 */ }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return c;
  } catch {
    throw new Error(/hei[cf]/.test(type || '') ? '這個瀏覽器打不開 HEIC，請從 iPhone 相簿選（會自動轉成 JPEG）或改用 Safari' : '這張照片解不開，檔案可能損毀');
  } finally { URL.revokeObjectURL(url); }
}

async function shrink(src, maxLong) {
  const k = maxLong / Math.max(src.width, src.height);
  const c = document.createElement('canvas');
  c.width = Math.round(src.width * k); c.height = Math.round(src.height * k);
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, c.width, c.height);
  src.close?.();
  return c;
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
    blob = new Blob([bytes], { type: MIME[extOf(path)] });
  }
  return scaleRGBA(await decodeBitmap(blob, blob.type), maxLong);
}

async function scaleRGBA(bmp, maxLong) {
  const k = Math.min(1, maxLong / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const oc = new OffscreenCanvas(w, h), g = oc.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return { px: g.getImageData(0, 0, w, h).data, w, h };
}
