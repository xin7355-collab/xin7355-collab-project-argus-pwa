# MCP 連接器：在 Claude 裡用阿爾戈斯的計算

把這個 App 加成 Claude 的「自訂連接器」後，在 Claude（網頁、iPhone App）的對話裡可以直接請它算：

- 「基隆港 25°09'N 121°45'E 到彭佳嶼 25°38'N 122°04'E 多遠、方位多少？」
- 「我在 24.5, 121.9，20 節；目標在 24.7, 122.1，往 200° 走 9 節，要怎麼攔？」
- 「今晚 25.04, 121.56 幾點完全天黑？月亮多亮？什麼時候最暗？」
- 「這附近 50 浬內有沒有發緊急代碼的飛機？」

答案用的是 App 裡同一套公式（距離預設浬）。

## 怎麼加（iPhone 也可以，用 Safari）

1. App 裡 **⚙️ 設定 → 🤖 在 Claude 裡用這個 App 的計算**，按「複製」拿到網址
   （`https://argus-app.xin7355.workers.dev/mcp`）
2. 用 **Safari 開 claude.ai** 並登入。**Claude iPhone App 裡不能新增連接器**，只能用已經在網頁加好的
3. 設定 → **連接器（Connectors）** → **新增自訂連接器（Add custom connector）**
4. 名稱填「阿爾戈斯」，網址貼上，**不用填任何登入資料** → 新增
5. 之後在 Claude App 的對話裡，從工具／連接器選單打開「阿爾戈斯」就能用（網頁加的會同步到手機）

方案限制以 Claude 官方說明為準：說明頁寫免費方案最多一個自訂連接器，
另一頁 FAQ 寫免費方案不能用連接器，兩邊不一致；付費方案（Pro 以上）可以用。

## 有哪些工具

| 工具 | 做什麼 | 連網？ |
| --- | --- | --- |
| `parse_position` | 各種座標寫法 → 十進位、度分 | 不連網 |
| `distance_bearing` | 兩點大圓距離（浬）與真方位、反方位 | 不連網 |
| `dead_reckoning` | 依航向航速推算 N 分鐘後（或回推）的位置 | 不連網 |
| `intercept_course` | 該操的航向、幾分鐘追上、攔截點；追不上會說 | 不連網 |
| `horizon_range` | 雷達／無線電／目視的最遠距離（含大氣折射 k） | 不連網 |
| `sun_moon` | 日出日落、航海與天文暮光、月相照明、月亮在地平線下的黑暗時段 | 不連網 |
| `search_pattern` | 平行梳掃搜索航點與總航程 | 不連網 |
| `nearby_aircraft` | 附近飛機（adsb.lol 公開 ADS-B，ODbL）：呼號、高度、距離方位、緊急代碼、軍機 | 查 adsb.lol |

位置可以寫「25.13, 121.74」、「25°07.8'N 121°44.5'E」或「N25 07.8 E121 44.5」（WGS84）。
寫錯時工具會回「看不懂，可以這樣寫…」讓 Claude 自己改了再試。

## 隱私與安全

- **預設不用登入**：工具只做計算，加上查 adsb.lol 的公開飛機資料；
  不讀任何金鑰，也碰不到你存在手機裡的點位、航跡、最愛（那些只在手機上，伺服器拿不到）。
  所以就算別人知道網址，也拿不到你的東西
- 擋濫用：只收 POST、限制請求大小、每個 IP 每分鐘最多 120 次（盡力而為）
- 想鎖起來：到 Cloudflare 的 Worker 設定加一個 secret `MCP_TOKEN`，之後要帶
  `Authorization: Bearer <那串>` 才能用。**注意**：claude.ai 的自訂連接器只支援「免登入」或 OAuth，
  設了這個 token，claude.ai 就連不上了（只剩能自訂標頭的用戶端，例如電腦上的 Claude Code）

## 技術細節（給維護的人）

- 端點 `/mcp`，Streamable HTTP、無狀態、只有工具。程式在 `src/lib/mcpServer.ts`（協定）、
  `src/lib/mcpTools.ts`（工具）、`worker/mcp.js`（HTTP 入口）
- 同時接兩個世代的用戶端：新版 **2026-07-28**（沒有 initialize；每個請求帶 `_meta` 與
  `MCP-Protocol-Version`／`Mcp-Method`／`Mcp-Name` 標頭；實作 `server/discover`）與舊版
  **2025-11-25／2025-06-18／2025-03-26**（initialize 握手）。不發 session，GET／DELETE 回 405
- 驗證：單元測試涵蓋兩個世代的流程與錯誤碼（-32020 標頭不一致、-32022 版本不支援、-32601、-32602、-32700）；
  本機用官方 MCP TypeScript SDK（1.32.2，最新支援到 2025-11-25）當用戶端實際連過；
  新版路徑用原始 HTTP 請求逐項檢查。部署後的實際連線可以跑 GitHub Actions「檢查 MCP 連接器」
- **沒驗到**：Claude 網頁／App 實際加這個連接器後的使用情形（要在你的 Claude 帳號裡操作）
