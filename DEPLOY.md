# 🚀 部署指南（拿到可在手機開的 live 網址）

> [!CAUTION]
> **舊網址 `https://project-argus-pwa.pages.dev` 已停用，不要再看那個。**
> 那是接在「已失效的舊 GitHub repo」上的 Cloudflare **Pages** 專案，
> 不會再更新，內容永遠停在舊版。
>
> **現行網址：`https://argus-app.<你的子網域>.workers.dev`**（Cloudflare Worker）
>
> Pages 與 Worker 在 Cloudflare 上是兩個獨立產品：部署 Worker **不會**讓
> pages.dev 跟著更新。之所以選 Worker，是因為 Cloudflare Access 鎖得住
> Worker、但鎖不住免費的 pages.dev（見 `wrangler.jsonc` 註解）。

> [!IMPORTANT]
> **目前正式部署方式：Cloudflare Worker，且已自動化。**
> 合併進 `main` 後 GitHub Actions 會自動 build 並部署（見
> `.github/workflows/deploy.yml`），不需要手動跑任何指令。
>
> 需要在 repo 設好兩個 secret 才會動：`CLOUDFLARE_API_TOKEN`、
> `CLOUDFLARE_ACCOUNT_ID`（Settings → Secrets and variables → Actions）。
> 沒設的話部署會紅燈失敗並印出說明——刻意不靜默跳過，否則會變成
> 「合併了但手機還是舊版」而不自知。
>
> 想手動部署（例如本機臨時測）：`npm run build && npx wrangler deploy`
>
> 選 Worker 而非 Pages 的原因見 `wrangler.jsonc` 註解：Cloudflare Access
> 鎖得住 Worker，但鎖不住免網域的 `pages.dev`。
>
> 以下 Vercel／Pages 兩節為早期做法，保留供參考，非現行方式。

前端是純靜態 PWA，`npm run build` 後把 `dist/` 丟到任何靜態主機即可。

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
