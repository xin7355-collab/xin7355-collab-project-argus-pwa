// ── 機敏功能鎖（縱深防禦第二層）──────────────────────────────
//
// Cloudflare Access 擋「誰能進 App」；這一層再擋「進來的人能不能看到機敏功能」。
// 設了 PIN 後，雷達等機敏功能預設完全隱藏（無按鈕/無圖層/無痕跡），用不明顯手勢
// 輸入 PIN 才解鎖，重開即自動鎖回。
//
// 誠實限制：這是前端 PIN，程式碼仍在瀏覽器裡；懂技術又拿到你「已解鎖」裝置的人
// 有可能繞過。它的價值是「肩窺、借手機、同仁誤觸」都看不到——搭配裝置鎖＋
// Cloudflare Access，對『只有我自己用』已足夠。真正機密請勿存於任何前端 App。

const LS = 'argus.secure.v1'

/** SHA-256（十六進位）。secure context(HTTPS/localhost) 才有 crypto.subtle。 */
export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function getSecureHash(): string {
  try {
    return localStorage.getItem(LS) || ''
  } catch {
    return ''
  }
}

/** 是否已設定機敏 PIN。 */
export function isSecureLockSet(): boolean {
  return Boolean(getSecureHash())
}

/** 設定 PIN；成功回 true。失敗（無 crypto.subtle、localStorage 滿）回 false，
 *  呼叫端據此才更新 UI，避免「以為設好、其實沒鎖」。 */
export async function setSecurePin(pin: string): Promise<boolean> {
  try {
    const hash = await sha256Hex(pin)
    localStorage.setItem(LS, hash)
    return getSecureHash() === hash
  } catch {
    return false
  }
}

export function clearSecurePin(): void {
  try {
    localStorage.removeItem(LS)
  } catch {
    /* ignore */
  }
}

export async function verifySecurePin(pin: string): Promise<boolean> {
  const h = getSecureHash()
  if (!h) return false
  return (await sha256Hex(pin)) === h
}
