# 🚀 部署指南（拿到可在手機開的 live 網址）

前端是純靜態 PWA，`npm run build` 後把 `dist/` 丟到任何靜態主機即可。
以下兩個都有免費額度，選一個。

## 方案 A：Vercel（最快）

專案已含 `vercel.json`，直接：

```bash
npm i -g vercel
vercel deploy --prod
```

第一次會問你登入與專案設定，一路 Enter 用預設即可（build 指令與輸出目錄
已在 `vercel.json` 設好）。完成後會給你一個 `https://xxx.vercel.app` 網址。

環境變數（Sentinel 金鑰、Edge AI 網址）在 Vercel dashboard →
Settings → Environment Variables 填入 `VITE_*` 那幾個。

## 方案 B：Cloudflare Pages（和邊緣 AI 同一家）

專案已含 `public/_redirects`（SPA fallback）。

1. Cloudflare dashboard → Workers & Pages → Create → Pages → 接上這個 Git repo。
2. Build 設定：
   - Build command：`npm run build`
   - Build output directory：`dist`
3. 環境變數填 `VITE_SENTINEL_INSTANCE_ID`、`VITE_EDGE_AI_URL` 等。
4. 部署完會給 `https://xxx.pages.dev` 網址。

> 邊緣 AI Worker 另外部署，見 [`cloudflare/README.md`](./cloudflare/README.md)。

## 部署後檢查清單

- [ ] 打開網址，三大戰術模式按鈕可切換
- [ ] 加到主畫面（PWA）：手機瀏覽器選單 → 加入主畫面
- [ ] 若要真實影像：Vercel/Pages 環境變數填好 `VITE_SENTINEL_INSTANCE_ID`
- [ ] 若要真實 AI：填好 `VITE_EDGE_AI_URL`（Worker 網址）
