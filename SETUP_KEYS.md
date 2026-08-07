# 🔑 金鑰申請一步步教學（手機就能做）

App 裡有個 **⚙️ 齒輪按鈕**（右上角），點開就能貼金鑰。金鑰只存在你手機瀏覽器，
不會上傳。以下三個都是**免費**的，申請到就貼進去、按「儲存並套用」即可。

> 提醒：🌬️ 風場、🌊 洋流、🆘 落海漂流預判**不需要任何金鑰**，本來就能用。

---

## 1. 🛰️ 真實衛星影像（Sentinel-2 光學 / Sentinel-1 雷達）

免費，用 Copernicus Data Space 帳號。

1. 手機瀏覽器開 **https://dataspace.copernicus.eu** → 右上 **Register** 註冊（免費）
2. 登入後開 **https://shapps.dataspace.copernicus.eu/dashboard/**
3. 左側 **Configuration Utility** → **＋ New configuration**（用 Python 或空白樣板都可）
4. 建好後，複製那一串 **Instance ID**（長得像 `12345678-abcd-...`）
5. 回 App → ⚙️ → 貼進 **Sentinel Hub Instance ID** → 儲存
6. 切到 🌤️ 沿岸光學 或 🚢 雷達盲搜，就會出現真實衛星影像

> WMS 位址欄留預設即可（CDSE 免費版）。

## 2. 📡 真實 AIS 船舶

免費，用 aisstream.io。

1. 手機瀏覽器開 **https://aisstream.io** → **Sign up**（免費）
2. 登入後在 **API Keys** 頁 **Create new API Key**，複製那串金鑰
3. 回 App → ⚙️ → 貼進 **AISStream 金鑰** → 儲存
4. 切到 📡 AIS 識別，就會顯示台灣周邊的真實船位

## 3. 🤖 邊緣 AI 船隻辨識（進階，需要電腦部署）

這個需要用電腦部署 Cloudflare Worker（見 `cloudflare/README.md`），
部署完會拿到一個網址，貼進 App ⚙️ 的 **邊緣 AI Worker 網址** 即可。
沒有的話，🚢 雷達盲搜的 AI 會用示範偵測，流程一樣能走。

## 4. 🌀 中央氣象署 CWA 颱風即時路徑（需要上面的 Worker）

用來讓 🌀 颱風模式顯示**中央氣象署官方「颱風路徑潛勢預報」**，取代示範颱風。

**為什麼要 Worker？** CWA Open Data API 沒有開放 CORS（瀏覽器無法直接呼叫），
而且授權碼不該暴露在前端。所以走你自己的 Cloudflare Worker 代理最安全。

步驟：
1. 去 https://opendata.cwa.gov.tw → 免費加入會員 → **會員資訊 → API 授權碼**，
   複製那串（長得像 `CWA-xxxxxxxx-xxxx-...` 或 `rdec-key-...`）。
2. 確認已完成第 3 項的 Worker 部署，且**重新部署最新的 `cloudflare/worker.js`**
   （這版才含 CWA 代理路由）：`cd cloudflare && wrangler deploy`。
3. 回 App → ⚙️ → 貼進 **中央氣象署 CWA 授權碼**（Worker 網址也要有）→ 儲存。
4. 切到 🌀 颱風路徑：有颱風時會自動抓真實路徑；無颱風時仍顯示示範資料。

> 進階（更安全）：把授權碼放 Worker secret —— `wrangler secret put CWA_KEY`，
> 這樣前端連貼都不用貼，Worker 會優先用 secret。

---

## 常見問題

- **貼了金鑰卻沒影像？** 該海域/日期可能沒衛星資料，換個日期或地點；或確認 Instance ID 沒貼錯。
- **要換手機？** 金鑰存在瀏覽器本機，換裝置要重貼一次。
- **安全嗎？** 金鑰不會傳到我們的伺服器，只存在你的裝置。真正機密的東西（如 CDSE 帳密）應放在 Cloudflare Worker，不要放前端。
