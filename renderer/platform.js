// 網頁版的檔案存取層：在瀏覽器裡（沒有 Electron 的 preload）提供跟 window.lab 一樣的介面。
// 網頁拿不到真正的檔案路徑，所以每個檔案給一個假路徑「web:<組別>/<檔名>」，對應到 File 物件。
// 調整設定、我的風格存在瀏覽器（localStorage）；照片永遠不離開這台裝置。

const IMAGE_RE = /\.(jpe?g|png|webp|heic|heif|cr3|cr2|nef|arw|dng|raf|orf|rw2|pef|srw)$/i;

function createWebLab() {
  const files = new Map();   // 假路徑 → File
  const groups = new Map();  // 組別 → [假路徑]
  let groupSeq = 0;
  const store = {
    get(k) { try { const v = localStorage.getItem(k); return v == null ? null : JSON.parse(v); } catch { return null; } },
    set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  };

  function register(list) {
    const g = `web:${++groupSeq}`;
    const ids = [];
    const used = new Set();
    for (const f of list) {
      if (!IMAGE_RE.test(f.name)) continue;
      let name = f.name, n = 1;
      while (used.has(name)) name = f.name.replace(/(\.[^.]+)$/, `-${n++}$1`); // 同名照片（不同資料夾）也分得開
      used.add(name);
      const id = `${g}/${name}`;
      files.set(id, f);
      ids.push(id);
    }
    ids.sort((a, b) => a.localeCompare(b, 'zh-Hant', { numeric: true }));
    groups.set(g, ids);
    return ids;
  }

  function pick({ dir = false, raw = false } = {}) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      // iPhone Safari 會把照片轉成 accept 清單裡的第一種格式；寫 image/* 開頭，RAW 就被轉成 JPEG。
      // 「選 RAW 原始檔」只列 RAW 類型、DNG 排第一，不放 image/*，讓它交出原檔（需真機驗證）
      input.accept = raw ? '.dng,image/x-adobe-dng,image/dng,.cr3,.cr2,.nef,.arw,.raf,.orf,.rw2,.pef,.srw'
        : 'image/*,.dng,.cr3,.cr2,.nef,.arw,.raf,.orf,.rw2,.pef,.srw,.heic';
      input.multiple = true;
      if (dir) input.webkitdirectory = true;
      input.style.display = 'none';
      document.body.append(input);
      input.addEventListener('change', () => { resolve(register([...input.files])); input.remove(); }, { once: true });
      input.addEventListener('cancel', () => { resolve([]); input.remove(); }, { once: true });
      input.click();
    });
  }

  const fileOf = (id) => { const f = files.get(id); if (!f) throw new Error('找不到這張照片，請重新開啟'); return f; };
  const sideKey = (id) => { const f = fileOf(id); return `photolab.side.${f.name}|${f.size}|${f.lastModified}`; };

  return {
    isWeb: true,
    canShareFiles: () => !!(navigator.canShare && navigator.canShare({ files: [new File([new Uint8Array(1)], 'x.jpg', { type: 'image/jpeg' })] })),
    openFiles: (opts) => pick(opts),
    async openFolder() {
      const ids = await pick({ dir: true });
      return ids.length ? { dir: ids[0].slice(0, ids[0].indexOf('/')), files: ids } : null;
    },
    listFolder: async (dir) => groups.get(dir) || [],
    readFile: async (id) => new Uint8Array(await fileOf(id).arrayBuffer()),
    sidecarRead: async (id) => store.get(sideKey(id)),
    sidecarWrite: async (id, data) => store.set(sideKey(id), data),
    chooseDir: async () => null,
    /** 網頁版匯出：能分享就叫出分享選單（手機可「儲存影像」），不行就下載 */
    async exportSave(_dir, base, ext, bytes) {
      const name = base + ext, type = ext === '.png' ? 'image/png' : 'image/jpeg';
      download(new Blob([bytes], { type }), name);
      return name;
    },
    reveal: async () => {},
    stylesRead: async () => store.get('photolab.styles') || [],
    stylesWrite: async (list) => { if (!store.set('photolab.styles', list)) throw new Error('瀏覽器空間不足'); return true; },
    focusRead: async () => ({}),
    focusWrite: async () => true,
    statFiles: async (ids) => ids.map((id) => { const f = files.get(id); return f ? { size: f.size, mtime: f.lastModified } : null; }),
    pathForFile: (file) => register([file])[0] || '',
    registerFiles: (list) => register(list),
    log: (msg) => console.warn('[photo-lab]', msg),
  };
}

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

if (!window.lab) window.lab = createWebLab();
