# Changelog

## v1.6.0-beta.1 — 版面適配與離線

### 修正
- 📱 **iPhone 瀏海／底部安全區**：狀態列與浮動按鈕避開瀏海，底部面板避開
  Home 指示條（safe-area-inset）。
- 📐 **版面溢出**：模式控制面板超高時本身可捲動（max-height），模式按鈕永遠可見，
  不再被擠出畫面。移除佔版面的縮放按鈕（改雙指縮放）。

### 新增
- 💾 **離線地圖包**：一鍵下載目前畫面範圍的底圖圖磚進快取（目前層級 +2 層、
  上限 500 磚），沒訊號的海域也能看地圖，含下載進度。
  底圖固定 subdomain/非 retina，確保離線 URL 命中快取。

## v1.5.0-beta.1 — 阿爾戈斯 (Argos)

### 變更
- 🏷️ PWA 正式命名為 **阿爾戈斯**（manifest name/short_name、標題、HUD）。
  安裝到主畫面即顯示「阿爾戈斯」。

### 新增
- 🎯 **漂流預判多物體類型**：落海人 / 救生衣浮者 / 救生筏 / 小船，
  各有不同風壓係數 (leeway 0.014 / 0.02 / 0.03 / 0.05)。切換類型即時重算漂流
  （物體受風越大、漂越遠）。
- 📊 **AIS 異常行為偵測**：無船名/身分不明、航速異常 (>25 kn)、駛入限制水域
  三類示警；地圖畫出限制水域方框，異常船隻紅色脈動，面板列出警示清單。

## v1.4.0-beta.1 — Field Operations

### 新增
- ⚙️ **App 內金鑰設定面板**：直接在 App 貼 Sentinel / AIS / 邊緣 AI 金鑰
  （存 localStorage），免改 Vercel 環境變數、免重新部署。手機也能設。
- 📍 **GPS「我的位置」**：定位自身、畫藍點與精度圈；搜救模式顯示與落海點距離（浬）。
- ⏱️ **漂流時間軸拉桿**：0–6 小時連續拉動，即時看任意時刻的漂流位置（琥珀色）。
- 📋 **搜救報告產生與分享**：一鍵產生含落海點、海象、各時段漂流的文字報告，
  用 Web Share 分享或複製到剪貼簿（度分海事座標格式）。
- SETUP_KEYS.md：手機就能跟做的免費金鑰申請教學。

### 重構
- 資料源金鑰改為 runtime 讀取（localStorage 優先，env fallback），
  存檔後重載即套用，不需重新部署。

## v1.3.0-beta.1 — Maritime SAR & Environment

### 新增
- 🆘 **搜救推演模式 (Rescue)**：落海漂流預判。點地圖標記落海點，系統用
  風場＋洋流以 leeway 模型算出 1/3/6 小時後的漂流位置與搜索半徑（浬），
  畫出漂流軌跡與擴大的搜索圈。含 15 項數學單元測試。
- 🌬️ **風場箭頭** 與 🌊 **洋流箭頭**：整個視野的向量場（Open-Meteo 免金鑰）。
- 📡 **AIS 船舶識別模式**：即時船位（依航向旋轉），點擊看船名/MMSI/航速/船種；
  無船名/不明船隻紅色標示。預設模擬船隻，設 `VITE_AISSTREAM_KEY` 接真實 AIS。
- 海象摘要面板：即時風速風向、洋流速向、浪高。
- 底部模式列擴充為 5 種，手機可橫向滑動切換。

### 資料源
- 風/流/浪：Open-Meteo（免金鑰、免費、CORS 直連），含離線 fallback。
- AIS：aisstream.io WebSocket（免費金鑰）／內建模擬。

### 防爆
- AIS 離開模式即取消訂閱（關 WebSocket／清 interval）。
- 搜救圖層卸載即清除箭頭場與漂流圖層，moveend 抓資料有 debounce。

## v1.2.0-beta.1 — Tactical Earth Observation & Edge AI

### 新增
- Sentinel Hub / CDSE WMS 圖磚串接模組（支援 Sentinel-1 SAR 與 Sentinel-2 光學）。
- UI 面板：雲量篩選滑桿 (0%~100%) 與歷史觀測日期選擇器。
- 邊緣 AI 辨識架構（Cloudflare Worker proxy），接收 bbox 影像並回傳目標物件 GeoJSON。
- 三大「一鍵戰術模式」：軌道預警 / 雷達盲搜 / 沿岸光學（互斥切換）。
- Web Worker 軌道運算 + Canvas 動態層（即時衛星白點與軌跡）。
- PWA 支援（manifest + service worker，OSM 底圖離線快取）。

### 優化
- LayerManager 記憶體回收：圖層關閉時強制 `remove()` 並清空 `_tiles` 快取，防手機發燙。
- Canvas 防爆：切離軌道模式呼叫 `cancelAnimationFrame()` + `worker.terminate()`，
  徹底中止渲染迴圈與背景執行緒（非 `display:none`）。
- 雲量過濾改為注入 WMS `MAXCC` 參數，交給 ESA 伺服器篩選。

### 修正 / 防錯
- 圖磚載入失敗（該區/時間無資料）加上 error handling 與透明替代圖，
  顯示「此區域/時間無可用影像」，不再出現破圖灰塊。
- 邊緣 AI 呼叫加上 8 秒 timeout 與錯誤回饋，海上網路不穩時 UI 不卡死。
- 未設定金鑰時顯示明確提示，而非嘗試載入而失敗。

### 設計決策（修正原規格的邏輯衝突）
- **互斥模式取代「60→10fps 降頻共存」**：原規格一邊要降頻共存、一邊要互斥關閉，
  兩者衝突。改採「同一時間只有一種重度資源」的互斥模式，更省電、邏輯更單純。
- **CDSE 需金鑰**：新版 Copernicus Data Space 的 WMS 需要 instance ID，
  改為 env 設定並提供 mock fallback，確保開箱即用。
- **輕量軌道模型**：Worker 內用圓軌道近似取代完整 SGP4，可無痛換成 satellite.js + 真 TLE。
