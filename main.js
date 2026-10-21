// Photo Lab 主程序：視窗、app:// 協定、檔案存取 IPC
import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from 'electron';
import fs from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.cr3', '.cr2', '.nef', '.arw', '.dng', '.raf', '.orf', '.rw2', '.pef', '.srw'];
const SIDECAR = '.photolab.json';
// app:// 只開放這兩個目錄，其餘一律 404
const SERVED = [path.join(ROOT, 'renderer'), path.join(ROOT, 'node_modules', 'libraw-wasm', 'dist')];
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

const logFile = () => path.join(app.getPath('userData'), 'app.log');
function log(...a) {
  try { appendFileSync(logFile(), `[${new Date().toISOString()}] ${a.join(' ')}\n`); } catch { /* 寫不了 log 也不能讓程式掛 */ }
}
process.on('uncaughtException', (e) => {
  log('uncaughtException', e.stack || e);
  dialog.showErrorBox('Photo Lab 發生錯誤', String(e.stack || e));
});

const isImage = (p) => typeof p === 'string' && path.isAbsolute(p) && IMAGE_EXT.includes(path.extname(p).toLowerCase());
function mustImage(p) { if (!isImage(p)) throw new Error(`不支援的檔案：${p}`); return p; }

async function listFolder(dir) {
  const names = await fs.readdir(dir);
  return names.filter((n) => IMAGE_EXT.includes(path.extname(n).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, 'zh-Hant', { numeric: true }))
    .map((n) => path.join(dir, n));
}

// 'wx'＝只能新建：路徑已存在（含別人放的符號連結）就失敗，不會順著連結寫到別處
async function writeNew(dir, base, ext, bytes) {
  for (let i = 0; i < 1000; i++) {
    const p = path.join(dir, `${base}${i ? `-${i}` : ''}${ext}`);
    try { await fs.writeFile(p, bytes, { flag: 'wx' }); return p; } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  throw new Error('同名檔太多，請換個檔名後綴');
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1000, minHeight: 640,
    backgroundColor: '#1e1f22', title: 'Photo Lab', autoHideMenuBar: true, icon: path.join(ROOT, 'build', 'icon.png'),
    webPreferences: { preload: path.join(ROOT, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.removeMenu();
  win.loadURL('app://local/renderer/index.html');
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.control && input.shift && input.key.toLowerCase() === 'i') win.webContents.toggleDevTools();
  });
  // 外部連結一律不在 app 內開
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://local/')) e.preventDefault(); });
  win.webContents.on('render-process-gone', (_e, d) => log('render-process-gone', JSON.stringify(d)));
  win.webContents.on('console-message', (e) => { if (e.level === 'error') log('renderer', e.message); });
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

  app.whenReady().then(() => {
    protocol.handle('app', async (req) => {
      const url = new URL(req.url);
      const file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
      if (url.host !== 'local' || !SERVED.some((d) => file.startsWith(d + path.sep))) return new Response('Not found', { status: 404 });
      try {
        const buf = await fs.readFile(file);
        return new Response(buf, { headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' } });
      } catch {
        return new Response('Not found', { status: 404 });
      }
    });

    ipcMain.handle('open-files', async () => {
      const r = await dialog.showOpenDialog(win, {
        title: '開啟照片', properties: ['openFile', 'multiSelections'],
        filters: [{ name: '照片', extensions: IMAGE_EXT.map((e) => e.slice(1)) }],
      });
      return r.canceled ? [] : r.filePaths.filter(isImage);
    });
    ipcMain.handle('open-folder', async () => {
      const r = await dialog.showOpenDialog(win, { title: '開啟資料夾', properties: ['openDirectory'] });
      return r.canceled ? null : { dir: r.filePaths[0], files: await listFolder(r.filePaths[0]) };
    });
    ipcMain.handle('list-folder', (_e, dir) => listFolder(dir));
    ipcMain.handle('read-file', async (_e, p) => {
      const buf = await fs.readFile(mustImage(p));
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    });
    ipcMain.handle('sidecar-read', async (_e, p) => {
      try { return JSON.parse(await fs.readFile(mustImage(p) + SIDECAR, 'utf8')); } catch { return null; }
    });
    ipcMain.handle('sidecar-write', async (_e, p, data) => {
      const target = mustImage(p) + SIDECAR;
      if (data == null) { await fs.rm(target, { force: true }); return true; } // 全部回到預設就不留設定檔
      try { if ((await fs.lstat(target)).isSymbolicLink()) throw new Error('設定檔是符號連結，拒絕覆寫'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      const tmp = `${target}.${randomUUID()}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', flag: 'wx' });
      try { await fs.rename(tmp, target); } catch (e) { await fs.rm(tmp, { force: true }); throw e; }
      return true;
    });
    ipcMain.handle('choose-dir', async (_e, defaultPath) => {
      const r = await dialog.showOpenDialog(win, { title: '選擇匯出資料夾', defaultPath, properties: ['openDirectory', 'createDirectory'] });
      return r.canceled ? null : r.filePaths[0];
    });
    ipcMain.handle('export-save', async (_e, dir, base, ext, bytes) => {
      if (!path.isAbsolute(dir) || !['.jpg', '.png'].includes(ext) || /[\\/:*?"<>|]/.test(base)) throw new Error('匯出參數不正確');
      await fs.mkdir(dir, { recursive: true });
      return writeNew(dir, base, ext, Buffer.from(bytes));
    });
    // 我的風格：存在 App 自己的資料夾（%APPDATA%\photo-lab\styles.json），內容由畫面端清洗
    const stylesFile = () => path.join(app.getPath('userData'), 'styles.json');
    ipcMain.handle('styles-read', async () => {
      try { const d = JSON.parse(await fs.readFile(stylesFile(), 'utf8')); return Array.isArray(d?.styles) ? d.styles : []; } catch { return []; }
    });
    ipcMain.handle('styles-write', async (_e, list) => {
      if (!Array.isArray(list) || list.length > 500) throw new Error('風格清單格式不正確');
      const target = stylesFile(), tmp = `${target}.${randomUUID()}.tmp`;
      await fs.writeFile(tmp, JSON.stringify({ app: 'photo-lab', version: 1, styles: list }, null, 2), { encoding: 'utf8', flag: 'wx' });
      try { await fs.rename(tmp, target); } catch (e) { await fs.rm(tmp, { force: true }); throw e; }
      return true;
    });
    // 對焦分析結果：每個資料夾一個快取檔，放在 App 自己的資料夾，不在照片資料夾留東西
    const focusFile = (dir) => {
      if (typeof dir !== 'string' || !path.isAbsolute(dir)) throw new Error('資料夾路徑不正確');
      return path.join(app.getPath('userData'), 'focus', createHash('sha1').update(path.normalize(dir).toLowerCase()).digest('hex') + '.json');
    };
    ipcMain.handle('focus-read', async (_e, dir) => {
      try { const d = JSON.parse(await fs.readFile(focusFile(dir), 'utf8')); return d && typeof d.entries === 'object' ? d.entries : {}; } catch { return {}; }
    });
    ipcMain.handle('focus-write', async (_e, dir, entries) => {
      if (!entries || typeof entries !== 'object') throw new Error('對焦資料格式不正確');
      const target = focusFile(dir), tmp = `${target}.${randomUUID()}.tmp`;
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(tmp, JSON.stringify({ app: 'photo-lab', version: 1, dir, entries }), { encoding: 'utf8', flag: 'wx' });
      try { await fs.rename(tmp, target); } catch (e) { await fs.rm(tmp, { force: true }); throw e; }
      return true;
    });
    ipcMain.handle('stat-files', async (_e, paths) => Promise.all((Array.isArray(paths) ? paths : []).map(async (p) => {
      try { const s = await fs.stat(mustImage(p)); return { size: s.size, mtime: Math.round(s.mtimeMs) }; } catch { return null; }
    })));
    ipcMain.handle('reveal', (_e, p) => shell.showItemInFolder(p));
    ipcMain.on('log', (_e, msg) => log('renderer', msg));

    createWindow();
  });

  app.on('window-all-closed', () => app.quit());
}
