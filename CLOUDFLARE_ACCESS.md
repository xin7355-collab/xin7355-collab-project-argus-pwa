# 阿爾戈斯 — 存取控制（Cloudflare Access）設定指南

目標：只有你「核准名單」上的 Email 才能打開 App；名單由你在 Cloudflare 後台
自己增刪（＝你要的後端管理）。免費（50 人內）、不用買網域。

> 敏感資料（雷達站、檢查據點）維持只存各自手機（localStorage），不上任何伺服器。
> Cloudflare Access 只負責「擋人進 App」，不碰你的資料。

---

## Part A — 把 App 掛上去（免費）

> [!WARNING]
> **本節的 Pages 做法已被取代。** 後來改為部署成 Cloudflare **Worker**，原因是
> Access 鎖得住 Worker、卻鎖不住免網域的 `pages.dev`（見 `wrangler.jsonc` 註解）。
> 現行做法是合併進 `main` 由 GitHub Actions 自動部署 Worker，見 `DEPLOY.md`。
> 下面的 Pages 步驟保留供對照，**若你走 Worker 就跳過 Part A，直接看 Part B**。

### （已取代）Cloudflare Pages 做法

1. 登入 **dash.cloudflare.com** → 左側 **Workers & Pages**
2. **Create** → **Pages** 頁籤 → **Connect to Git**
3. 授權 GitHub，選 repo：`project-argus-pwa`
4. **Production branch**：`main`
5. **Build settings**：
   - Framework preset：**Vite**（或 None）
   - Build command：`npm run build`
   - Build output directory：`dist`
6. **Save and Deploy** → 等它 build 完，會給你一個網址：
   `專案名.pages.dev`（例如 `project-argus-pwa.pages.dev`）

之後我每次推到 `main`，Cloudflare Pages 會自動重新 build（跟現在 Vercel 一樣）。

---

## Part B — 開通 Cloudflare Access（把 pages.dev 上鎖）

1. dash.cloudflare.com → 左側 **Zero Trust**
   - 第一次會要你取一個 team 名稱（例如 `argus`）→ 產生 `argus.cloudflareaccess.com`
   - 方案選 **Free**（50 人內，免填卡）
2. Zero Trust → **Access** → **Applications** → **Add an application** → **Self-hosted**
3. 設定：
   - Application name：`阿爾戈斯`
   - Session duration：`24 hours`（多久要重新驗證一次，可選 1 週）
   - **Application domain**：填你的 pages.dev（例：`project-argus-pwa.pages.dev`）
4. **Add policy（允許名單）**：
   - Policy name：`允許名單`
   - Action：**Allow**
   - Configure rules → **Include** → 選 **Emails** → 一個一個加你要放行的人的 Email
     （或用 **Emails ending in** 放行整個機關網域）
5. **Login methods**：預設 **One-time PIN**（Email 收驗證碼）就能用，不用額外設定。
   想更快可加 **Google** 登入。
6. **Save**。

完成後：任何人開 `pages.dev` 網址，會先跳出「輸入 Email → 收驗證碼」；
**只有名單上的 Email 驗證得過**，才進得了 App。

---

## 管理（你的後端）

- **加人／踢人**：Zero Trust → Access → Applications → 你的 App → Policies → 改 Email 清單。即時生效。
- **看誰登入過**：Zero Trust → **Logs** → **Access**。

---

## ⚠️ 最重要一步：關掉舊的 Vercel 公開網址

Cloudflare Access 只保護 `pages.dev`。**原本的 Vercel 網址仍是公開、沒上鎖的**。
所以 Pages 確認可用後，務必：

- 停用／刪除 Vercel 專案（Vercel Dashboard → 專案 → Settings → 最下方 Delete），
  或至少**不再分享/使用那個 Vercel 網址**。
- 之後你和同仁**只用受保護的 `pages.dev` 網址**。

否則等於前門上鎖、後門大開。

---

## 常見問題

- **免費嗎？** Pages 免費、Access Free 方案 50 人內免費、Email OTP 免費。
- **要買網域嗎？** 不用，`pages.dev` 就能套 Access。（想用自訂網域也行，另接 CF DNS。）
- **資料會上傳嗎？** 不會。雷達站/檢查據點只存手機。換手機用 App 內「備份/還原」搬。
- **PWA 加到主畫面還能用嗎？** 可以；第一次開會走一次 Email 驗證，session 內免重複。
