# Argus 邊緣 AI Worker

手機端「絕對禁止」載入 YOLO。這個 Cloudflare Worker 負責重度運算：
接收海域 `bbox` → 抓 Sentinel-1 SAR 影像 → 跑輕量 AI 推論 →
只回傳 `<1KB` 的 GeoJSON 給手機。

## 部署

```bash
npm i -g wrangler
cd cloudflare
wrangler login
wrangler deploy
```

部署後會得到一個網址，例如 `https://argus-edge-ai.<you>.workers.dev`。
把它填進前端專案根目錄的 `.env`：

```
VITE_EDGE_AI_URL=https://argus-edge-ai.<you>.workers.dev
```

## 綁定與 secret

| 名稱         | 用途                                   | 設定方式                          |
| ------------ | -------------------------------------- | --------------------------------- |
| `AI`         | Workers AI（免費額度每天 1 萬次推論）  | 已在 `wrangler.toml` 綁定         |
| `CDSE_TOKEN` | Copernicus Data Space OAuth token      | `wrangler secret put CDSE_TOKEN`  |

**沒設定 `CDSE_TOKEN` 也能跑**：Worker 會走 heuristic fallback 回傳示範點，
方便你先驗證「框選 → 打 API → 畫紅框」的完整流程，之後再接真實影像。

## 防超支機制

- 單次框選面積上限 `2°×2°`，超過直接拒絕（避免抓超大圖燒額度）。
- 建議在 Cloudflare dashboard 再加一層 **Rate Limiting**（如每 IP 每分鐘 10 次）。
- 影像抓不到（該區/時間無資料）回空集合，前端顯示「無可用影像」。
