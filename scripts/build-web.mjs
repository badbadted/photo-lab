// 產生網頁版：renderer/ 原樣複製，RAW 解碼模組放 vendor/libraw，改掉 Electron 專用的匯入路徑
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'web-dist');
const LIBRAW = path.join(ROOT, 'node_modules', 'libraw-wasm', 'dist');
const ELECTRON_IMPORT = "'/node_modules/libraw-wasm/dist/index.js'";
const WEB_IMPORT = "'./vendor/libraw/index.js'";

// 清空內容但保留資料夾本身（本機測試伺服器可能正開在這個資料夾裡，刪不掉它）
await fs.mkdir(OUT, { recursive: true });
for (const f of await fs.readdir(OUT)) await fs.rm(path.join(OUT, f), { recursive: true, force: true });
await fs.mkdir(path.join(OUT, 'vendor', 'libraw'), { recursive: true });
for (const f of await fs.readdir(path.join(ROOT, 'renderer'))) await fs.copyFile(path.join(ROOT, 'renderer', f), path.join(OUT, f));
for (const f of await fs.readdir(LIBRAW)) if (!f.endsWith('.map') && !f.endsWith('.d.ts')) await fs.copyFile(path.join(LIBRAW, f), path.join(OUT, 'vendor', 'libraw', f));
await fs.copyFile(path.join(ROOT, 'build', 'icon.png'), path.join(OUT, 'icon.png'));
await fs.writeFile(path.join(OUT, '.nojekyll'), '');

const dec = path.join(OUT, 'decode.js');
const src = await fs.readFile(dec, 'utf8');
if (src.split(ELECTRON_IMPORT).length !== 2) throw new Error(`decode.js 裡找不到唯一一處 ${ELECTRON_IMPORT}，網頁版匯入路徑沒改到`);
await fs.writeFile(dec, src.replace(ELECTRON_IMPORT, WEB_IMPORT));

const files = await fs.readdir(OUT, { recursive: true });
console.log(`網頁版已產生：${OUT}（${files.length} 個檔案）`);
