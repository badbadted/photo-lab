// Photo Lab 主程序：視窗、app:// 協定、檔案存取 IPC
import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from 'electron';
import fs from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
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

async function uniquePath(dir, base, ext) {
  for (let i = 0; ; i++) {
    const p = path.join(dir, `${base}${i ? `-${i}` : ''}${ext}`);
    try { await fs.access(p); } catch { return p; }
  }
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1000, minHeight: 640,
    backgroundColor: '#1e1f22', title: 'Photo Lab', autoHideMenuBar: true,
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
    ipcMain.handle('stat-file', async (_e, p) => (await fs.stat(mustImage(p))).size);
    ipcMain.handle('sidecar-read', async (_e, p) => {
      try { return JSON.parse(await fs.readFile(mustImage(p) + SIDECAR, 'utf8')); } catch { return null; }
    });
    ipcMain.handle('sidecar-write', async (_e, p, data) => {
      const target = mustImage(p) + SIDECAR;
      if (data == null) { await fs.rm(target, { force: true }); return true; } // 全部回到預設就不留設定檔
      const tmp = target + '.tmp';
      await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
      await fs.rename(tmp, target);
      return true;
    });
    ipcMain.handle('choose-dir', async (_e, defaultPath) => {
      const r = await dialog.showOpenDialog(win, { title: '選擇匯出資料夾', defaultPath, properties: ['openDirectory', 'createDirectory'] });
      return r.canceled ? null : r.filePaths[0];
    });
    ipcMain.handle('export-save', async (_e, dir, base, ext, bytes) => {
      if (!path.isAbsolute(dir) || !['.jpg', '.png'].includes(ext) || /[\\/:*?"<>|]/.test(base)) throw new Error('匯出參數不正確');
      await fs.mkdir(dir, { recursive: true });
      const out = await uniquePath(dir, base, ext);
      await fs.writeFile(out, Buffer.from(bytes));
      return out;
    });
    ipcMain.handle('reveal', (_e, p) => shell.showItemInFolder(p));
    ipcMain.on('log', (_e, msg) => log('renderer', msg));

    createWindow();
  });

  app.on('window-all-closed', () => app.quit());
}
