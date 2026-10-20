# Photo Lab

自用修圖工具（類 Lightroom 編輯模組）。Electron + WebGL2，支援 JPEG／PNG 與相機 RAW。功能與架構見 [SPEC.md](SPEC.md)。

## 啟動

```bash
npm install
npm start
```

或雙擊 `啟動 Photo Lab.bat`。

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
| Ctrl+Shift+I | 開發者工具 |

雙擊拉桿或項目名稱可歸零。錯誤紀錄在 `%APPDATA%\photo-lab\app.log`。
