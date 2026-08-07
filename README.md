# 🛰️ Project Argus · 海域觀測 PWA

> **v1.2.0-beta.1** — Tactical Earth Observation & Edge AI

一個給海上人員用的**終極 PWA 戰術面板**。前端只當「純粹的展示層」，
所有重度運算（軌道、影像、AI）全部丟給 **Web Worker** 或 **Cloudflare Edge**。
在搖晃的船艙裡也能一鍵操作。

## 🎯 三大「一鍵戰術模式」（互斥設計）

同一時間只有一種重度資源在運行，確保手機不卡、不發燙：

| 模式             | 開啟                                          | 關閉（釋放資源）        |
| ---------------- | --------------------------------------------- | ----------------------- |
| 🛰️ **軌道預警**  | OSM 暗色底圖 + Web Worker 算軌跡 + Canvas 亮點 | 所有 WMS 影像層         |
| 🚢 **雷達盲搜**  | Sentinel-1 SAR 圖磚 + 邊緣 AI 紅色警示框       | Canvas 軌跡（釋放 RAM） |
| 🌤️ **沿岸光學**  | Sentinel-2 光學 + 雲量<20% + 日期選擇器        | 雷達圖與 AI 辨識        |

## 🧩 架構（拒絕邏輯打架）

```
使用者操作 → Zustand store（唯一真相來源）
                    │
                    ▼
   ┌────────────────────────────────────┐
   │ MapContainer（唯一地圖實體）        │
   │  └ LayerControl（監聽模式 add/remove）│
   │       1. Base   Layer  OSM 暗色底圖  │
   │       2. Tile   Layer  Sentinel WMS │
   │       3. Vector Layer  AI 紅框 GeoJSON│
   │       4. Canvas Layer  即時衛星（Worker 驅動）│
   └────────────────────────────────────┘
```

- **UI 元件只改狀態**，圖層增減全交給 `LayerControl` 監聽 → 不會兩處同時動 Leaflet。
- **地圖組件解耦**：邏輯不塞進同一個 `Map.tsx`。

## 💰 防爆 / 防超支機制

- **Canvas 防爆**：切離軌道模式時呼叫 `cancelAnimationFrame()` + `worker.terminate()`
  徹底停機，不是 `display:none`（見 `SatelliteCanvasLayer.ts`）。
- **圖磚記憶體回收**：卸載 WMS 層時強制清空 `_tiles` 快取，防 Leaflet memory leak。
- **AI 防超支**：手機端**絕不**載入 YOLO；只把 bbox 丟給 Cloudflare Worker，
  回傳 `<1KB` GeoJSON。Worker 端再限制框選面積、可加 Rate Limiting。
- **雲量過濾**：不自己寫演算法，直接注入 WMS 的 `MAXCC` 參數交給 ESA 伺服器篩。
- **錯誤處理**：圖磚載入失敗（該區/時間無資料）顯示「此區域/時間無可用影像」，
  不出現破圖灰塊。

## 🚀 快速開始

```bash
npm install
cp .env.example .env   # 填入你的金鑰（可先不填，用 mock 跑）
npm run dev            # 開發
npm run build          # 產出 PWA
npm run preview        # 預覽 production build
```

**開箱即用**：不填任何金鑰也能跑——底圖、即時衛星軌跡、mock AI 偵測全部可用。
填入 `.env` 後即接上真實 Sentinel 影像與邊緣 AI。

## 🔑 環境變數（見 `.env.example`）

| 變數                        | 用途                                    |
| --------------------------- | --------------------------------------- |
| `VITE_SENTINEL_INSTANCE_ID` | Sentinel Hub / CDSE WMS instance ID     |
| `VITE_SENTINEL_WMS_URL`     | WMS 服務位址（預設 CDSE 免費版）        |
| `VITE_EDGE_AI_URL`          | Cloudflare 邊緣 AI Worker 網址          |

> 真正的機密（CDSE 帳密、AI 推論）放在 **Cloudflare Worker secret**，
> 不進前端 bundle。部署見 [`cloudflare/README.md`](./cloudflare/README.md)。

## 🎨 視覺語彙

極致黑 `slate-900` 底 · 螢光綠 `emerald-400` / 科技藍 `cyan-400` 文字 ·
警示紅 `rose-500` AI 框 —— 軍事雷達幕沉浸感。

## 技術棧

Vite · React · TypeScript · Leaflet · Zustand · Tailwind CSS · vite-plugin-pwa ·
Web Worker · Cloudflare Workers AI
