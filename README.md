# Photo Lab

自用修圖工具（類 Lightroom 編輯模組）。Electron + WebGL2，支援 JPEG／PNG 與相機 RAW。功能與架構見 [SPEC.md](SPEC.md)。

## 安裝（一般使用）

執行 `PhotoLab-安裝版-<版本>.exe`（放在 `C:\Ted\共用\AI產出\工具\`），不需管理員權限，會建立桌面捷徑。
不想安裝就直接雙擊 `PhotoLab-免安裝-<版本>.exe`。

## 網頁版（手機也能用）

https://badbadted.github.io/photo-lab/ ——手機打開是精簡版（套風格、裁切、存到相簿），電腦打開是完整版。照片只在自己的裝置上處理，不會上傳。
發佈新版：`npm run deploy:web`。

## 開發

```bash
npm install
npm start
```

或雙擊 `啟動 Photo Lab.bat`。打包：`npm run dist`，產出在 `dist\`。

## 測試

```bash
npm test
```

## 快捷鍵

| 鍵 | 動作 |
|---|---|
| Ctrl+O／Ctrl+Shift+O | 開啟照片／開啟資料夾 |
| ← → | 上一張／下一張 |
| R | 進出裁切；Enter／Esc 完成 |
| X | 裁切時直橫互換 |
| `\`（按住） | 看原圖 |
| Ctrl+Z／Ctrl+Y | 復原／重做 |
| Ctrl+Shift+E | 匯出 |
| 1／2／3 | 對焦分類手動改成準焦／待確認／失焦 |
| Ctrl+Shift+I | 開發者工具 |

雙擊拉桿或項目名稱可歸零。錯誤紀錄在 `%APPDATA%\photo-lab\app.log`。
