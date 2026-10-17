# 專案工作守則（給 Claude Code）

## 1. 溝通
- 一律用繁體中文（台灣用語）回覆、寫註解、寫 commit 訊息。
- 我主要用 iPhone 操作，沒有電腦。步驟以手機能完成為準；要我去設定頁時直接給網址。
- 回報要誠實：哪些驗過、哪些沒驗到，分開講清楚。不確定的事實先查證再講。
- 我說「只是先問問題」時，只回答，不動手改東西。

## 2. 長期授權：以下不用再問我
- 做完直接合併到 main 並推上去，不需要我同意：
  在指定分支開發 → rebase 到最新 main → fast-forward 合併 → push main → 分支也同步推。
  網路失敗重試最多 4 次（間隔 2/4/8/16 秒）；遠端有新 commit 就 fetch + rebase 再推。
- 部署用的分支（例如 gh-pages）也可以直接推。
- 改工作流、加套件、新增檔案、重構——直接做。
- 不要開 Pull Request，除非我明確要求。

## 3. 連這些也直接做，不用先問
- 刪除：Issue、Release、分支、檔案；force push；改寫 git 歷史。
- 花錢：開付費方案、呼叫付費 API。
- 改公開程度：repo 公開／私人切換、網站權限。
- 做了不可逆的事（刪除、force push、會產生費用的動作），完成後在回覆裡明確列出來。

## 4. 隱私與安全
- 我說過「不要上傳 GitHub」的東西永遠不 commit，做好打包給我下載。
- 絕對不要把金鑰、Token 印出來（log、commit、回覆都不行）。金鑰放 repo Secrets；
  程式用 HTTP 標頭傳，不放網址（網址會出現在錯誤訊息和記錄裡）。
- repo 保持公開（公開 repo 的 Actions 分鐘數無上限；私人免費只有 2000 分鐘／月）。所以：
  - README 精簡，不詳述這個軟體在做什麼；詳細說明放 docs/。
  - 用 GitHub Issue 送的通知，標題和內文只寫數量，不寫內容——公開 Issue 會被搜尋引擎收錄。
  - 網站加 `<meta name="robots" content="noindex, nofollow">`。
- 用到付費 API 時提醒我設預算上限。

## 5. 做事的方式
- 先重現再修：修 bug 前用實際資料或真的瀏覽器（Playwright）重現，修完用同樣方法驗證。
- 新功能附離線可跑的自我測試（例如 `python xxx.py selftest`），涵蓋邊界情況。
- 不要默默失敗：
  - 全部失敗時不交出空檔案；部分失敗要講幾個、哪幾個。
  - 分清楚「還沒設定」（安靜等、不發失敗通知）和「真的壞掉」（紅燈、通知我）。
  - 錯誤訊息要說我能做什麼，不是只丟 HTTP 代碼。
- 註解寫「為什麼」與避開了什麼失敗情境，不重述程式在做什麼。
- commit 訊息寫：問題、根本原因、怎麼修、怎麼驗證。
- 不寫死外部 API 的模型名稱（常改名下架）；能自動挑就自動挑，也能用環境變數指定。
  呼叫 AI 時用 skl 的 `ai-model-router`（只寫等級 fast／smart／best／auto，下架自動換、不合格自動升級）。
- 範圍外的問題簡短提出，不擅自擴大範圍。
- 不留死碼；改名、搬檔後全專案搜一次舊名稱的殘留參照。

## 6. 選用：手機 PWA + GitHub Actions 類型的專案
（新專案是同一種架構才需要這段，不是的話整段刪掉）
- 前端每次改版都更新版本號（例如 `APP_VER`），手機上的舊頁面偵測到會自動重載。
- iPhone 下載檔案用 `navigator.share({files:[f]})`，不要同時帶 `title`
  （iOS 會只送出 title 文字、檔案被丟掉）；不支援再退回 `<a download>`。
- 大檔上傳直接把 File 當 body 送（XHR 有進度條），不要先讀成 ArrayBuffer——1GB 在 iPhone 上必當。
- 版面：一個分頁盡量一張卡；說明收進 `<details>`；選項多用下拉，不用一排排按鈕。
- GitHub Actions：
  - 長工作每做完一個就存進度，不要整批做完才存（被逾時砍掉會全部白做、無限重來）。
  - 發佈結果的步驟加 `if: always()`。
  - 設時間預算，估不下就留到下一輪。
  - 「抓下來」和「處理成功」分兩段記：成功才標記完成，失敗的下一輪自動重試。
  - 預設 shell 是 `bash -e -o pipefail`：`tee` 到的資料夾要先 `mkdir -p`。
- 大檔暫存用 GitHub Release 附件（單檔上限 2 GiB、不進 git 歷史），repo 只放小標記檔觸發工作流。

## 7. 本專案資訊

- **用途**：海域觀測 PWA（阿爾戈斯 Argus）。給海上人員在手機上看衛星影像、
  判斷船隻、算無線電/雷達涵蓋與遮蔽、做搜救漂流推演。
- **技術**：React 18 + TypeScript + Vite + Leaflet（`preferCanvas: true`）+ Zustand +
  Tailwind + vite-plugin-pwa。前端只當展示層，不背推論成本。
- **主要檔案**：
  - `src/store/tacticalStore.ts` — 唯一真相來源（Zustand，手刻 localStorage 持久化，
    不用 persist middleware；每個欄位用自己的 `src/lib/<feature>.ts` 的 load/persist）
  - `src/map/MapContainer.tsx` — 唯一的 `L.Map` 實體，所有圖層都是收 `map` prop、
    回傳 `null` 的純副作用元件
  - `src/map/LayerControl.tsx` — 重度影像圖層的唯一擁有者（「同時只掛一層」原則，
    例外：`CompareLayer` 開啟時由它接管）
  - `src/lib/` — 60 個純函式模組（RF 傳播、雷達方程、地形剖面、漂流、亮點偵測…）
- **測試**：`npm test` 用 Node 內建 test runner（`node --experimental-strip-types --test`），
  **零測試框架相依**。`node:test` 的型別在 `src/types/nodeTest.d.ts` 自己宣告——
  不要裝 `@types/node`，否則全域 `setTimeout` 會變成 `NodeJS.Timeout`，
  專案裡的 `useRef<number>()` 計時器會全部型別不符。
  被測模組要能在純 Node 跑。Node 的 ESM **要求相對 import 帶副檔名**，
  但專案其他地方的 import 都不帶，所以規則是：
  - **有單元測試的模組**，相對 import 一律寫成 `./x.ts`（tsconfig 已開
    `allowImportingTsExtensions`，Vite 也吃這種寫法）。
  - `import type` 會被型別抹除，不帶副檔名也沒關係。
  - npm 套件（如 `satellite.js`）是 bare specifier，正常解析。
  踩過兩次：`ERR_MODULE_NOT_FOUND: Cannot find module '.../tle'`。
- **需要的 Secrets**（GitHub → Settings → Secrets → Actions）：
  - `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`（部署用）
  - `VITE_*` 前端金鑰為 build 期打包，沒設也能跑（會退回免金鑰來源與模擬資料）
- **部署在哪**：Cloudflare Worker（靜態資源），網址
  `https://argus-app.xin7355.workers.dev`。`main` 有 push 就自動部署。
  Worker 沒有 Git 整合，所以一定要靠 `.github/workflows/deploy.yml` 推上去。
- **特別注意**：
  - **使用者只有 iPhone、沒有電腦**，回覆一律繁體中文。改完 UI 要想「手機上按不按得到」——
    手機版 Dashboard 面板從畫面約 37% 處升起（z-index 1000），會蓋住地圖下半部。
  - **看不到的部分要說「沒驗到」，不要猜。** 這個沙箱擋掉大部分對外網路
    （open-meteo、overpass、wheretheiss 等 CONNECT 403），所以外部 API 的實際回傳
    多半驗不到，要用攔截/假資料驗，並誠實標註。
  - 距離單位預設是**浬**（`src/lib/units.ts` 的 `formatDist`），不要印 km。
  - 地圖是 `preferCanvas: true`，向量都畫進 canvas——驗證時要取 canvas 像素，
    不要數 SVG path。Leaflet 的 `.leaflet-tile-container` 是 `pointer-events: none`，
    `elementFromPoint` 命中測試會跳過圖磚。
  - 第三方圖磚來源會變（CARTO 已出現 API KEY REQUIRED 浮水印），不要只依賴單一供應商。
