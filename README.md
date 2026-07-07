# 游泳 FIT 趟數修正器

Garmin 游泳 `.fit` 檔的分趟（length）修正工具。手錶常把一次轉身誤判成「到達終點」，
把同一趟 25m 拆成兩筆記錄，導致趟數與距離被多算、單趟配速失真。本工具讓你把這些
被拆開的趟合併回去，重新計算速度與配速，並匯出一個可重新匯入 Garmin Connect / Strava 的
修正版 `.fit`。

靈感來自 swimdata.org，但**完全在本機瀏覽器執行，檔案不會上傳到任何伺服器**。

## 使用方式

完整圖文說明請見 **[docs/USAGE.md](docs/USAGE.md)**（含自動擷取的介面截圖）。

直接用瀏覽器（Chrome / Edge / Firefox）開啟 `index.html`（雙擊即可，不需架站）。

> ⚠ 不要在 Claude 的預覽面板裡操作 —— 那是沙箱，不會跳出「選擇檔案」視窗。請用一般瀏覽器開啟。

1. 把 `.fit` 檔拖進頁面，或點擊選檔。
2. 上方是 **Visual Editor**：統計卡 + 長條圖（每趟一根，高度＝秒數，顏色＝泳姿，
   虛線＝lap 開始）。
3. 按 **⚡ 自動合併短趟**：低於門檻（預設 30 秒）的趟自動併入時間最吻合的同泳姿鄰段。
4. 手動微調（在長條圖上**點選長條**可多選，Shift 可範圍選，再按工具列）：
   - **⇄ 合併選取**：把選取的相鄰趟合併成一趟。
   - **⤪ 分割選取**：把選取的每趟平均分成兩趟。
   - **🗑 刪除選取**：刪掉幽靈趟。
   - **🏊 改選取泳姿 / 🏊 全部改此泳姿**：先選左邊泳姿，再套用到選取或**一鍵全部**。
   - **↶ 復原 / ↺ 還原**：復原上一步 / 回到剛載入狀態。
5. 也可展開「逐趟明細表」做精確操作。
6. 按 **⬇ 下載修正檔**，得到 `原檔名_fixed.fit`。

## 檔案

- `index.html` — **直接開這個**（自足單檔，已內嵌引擎與 UI）。
- `template.html` / `fit_core.js` / `ui.js` — 原始碼（shell / 引擎 / UI）。
- `build.js` — 把上面三者組成 `index.html`：`node build.js`。
- `fit_core.js` 為 DOM-free，可用 Node 單獨測試與驗證。

## 打包成桌面應用程式（Electron）

已附 Electron 外殼（`main.js` / `preload.js` / `package.json`），可打包成 Windows
安裝檔，並把 `.fit` 關聯到本程式（雙擊 .fit 直接開啟）。

```bash
npm install          # 安裝 electron 與 electron-builder（首次較久）
npm start            # 開發模式直接執行（開一個視窗）
npm run pack         # 產生免安裝資料夾 dist-app/win-unpacked/SwimFitEditor.exe
npm run dist         # 產生 NSIS 安裝檔 dist-app/SwimFitEditor Setup x.y.z.exe
```

- 安裝後會在桌面建立「游泳FIT修正器」捷徑，並註冊 `.fit` 檔案關聯。
- 純本機、離線可用；不含任何網路連線。
- 註：安裝時會把 `.fit` 註冊成本程式可開啟的檔案類型。若你也用 Garmin
  官方軟體開 `.fit`，可在 Windows「開啟檔案的應用程式」自行選預設程式。

## 發佈檔（release）

[`release/`](release/) 資料夾提供兩種下載；**完整安裝與操作說明**見 **[docs/USAGE.md](docs/USAGE.md)** §1。

| 檔案 | 說明 |
|------|------|
| [SwimFitEditor-1.0.0-browser.zip](release/SwimFitEditor-1.0.0-browser.zip) | **瀏覽器版**（~17 KB）— 解壓後雙擊 `index.html` 或 `開啟.bat` |
| [SwimFitEditor-1.0.0-setup.zip](release/SwimFitEditor-1.0.0-setup.zip) | **Windows 安裝版**（~78 MB）— 含 `.fit` 檔案關聯與桌面捷徑 |

重新打包瀏覽器版：`npm run release:browser`

## 設計重點

- **逐位元保留**：重新編碼時，只改動必要欄位（每趟的 elapsed/timer 時間、划手數、
  平均速度、頻率、message_index，以及 lap/session 的總距離與趟數計數），其餘所有
  廠商專屬欄位（HR 記錄、裝置資訊等）都從原始位元組原封複製，並重算 header 與檔尾 CRC。
- 合併只是把時間與划手數相加，泳姿與起始時間沿用留存的那一趟；**總游動時間與總划手數守恆**。
- 距離＝有效趟數 × 泳池長度（自動讀取 session 的 pool_length）。

## 已知限制

- 針對「分趟游泳」（lap swimming）資料。開放水域（無 length 訊息）不適用。
- 自動合併是啟發式：找不到合適同泳姿鄰段的孤立短趟會標記 ⚠ 請你手動處理。
