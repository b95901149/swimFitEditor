# Release 發佈檔說明

本資料夾提供兩種預先打包好的發佈版本。完整圖文操作說明見 **[docs/USAGE.md](../docs/USAGE.md)**（§1 Release 發佈版下載）。

## 下載對照

| 檔案 | 類型 | 大小（約） | 直接下載 |
|------|------|------------|----------|
| **SwimFitEditor-1.0.0-browser.zip** | 瀏覽器版（免安裝） | ~17 KB | [下載](https://github.com/b95901149/swimFitEditor/raw/master/release/SwimFitEditor-1.0.0-browser.zip) |
| **SwimFitEditor-1.0.0-setup.zip** | Windows 安裝版 | ~78 MB | [下載](https://github.com/b95901149/swimFitEditor/raw/master/release/SwimFitEditor-1.0.0-setup.zip) |

## 瀏覽器版 — SwimFitEditor-1.0.0-browser.zip

**適合：** 不想安裝、偶爾使用、磁碟空間有限。

1. 解壓縮
2. 雙擊 `index.html` 或 `開啟.bat`（Chrome / Edge / Firefox）
3. 閱讀 `使用方式.txt`（可選）
4. 拖入 `.fit` 檔開始編輯

壓縮包內容：

| 檔案 | 說明 |
|------|------|
| `index.html` | 主程式（自足單檔） |
| `開啟.bat` | 一鍵用預設瀏覽器開啟 |
| `使用方式.txt` | 簡短操作說明 |

- ✅ 免安裝、體積極小、功能與桌面版相同
- ❌ 無 `.fit` 檔案關聯、需自行用瀏覽器開啟

## 安裝版 — SwimFitEditor-1.0.0-setup.zip

**適合：** 經常修正、需要雙擊 `.fit` 開啟、桌面捷徑。

1. 解壓縮後執行 `SwimFitEditor Setup 1.0.0.exe`
2. 依安裝精靈完成安裝
3. 從桌面捷徑「游泳FIT修正器」啟動，或直接雙擊 `.fit` 檔

- ✅ 桌面捷徑、`.fit` 檔案關聯、完整離線桌面體驗
- ❌ 安裝檔較大（內含 Chromium，下載 ~78 MB / 安裝後 ~270 MB）

## 開發者：重新打包

```bash
npm run release:browser          # 瀏覽器版 zip → release/
npm run dist                     # 安裝程式 → dist-app/
# 再手動將 dist-app 內 Setup exe 壓成 setup.zip 放入 release/
```

---

版本：1.0.0
