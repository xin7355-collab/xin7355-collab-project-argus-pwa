// ── 分享連結：把「這艘船／這個位置」變成一個網址 ──────────────────
//
// 用 LINE 傳給同事，對方點開就看到同一片海、同一艘船。
// 參考 gods-eye-view（MIT，見 docs/licenses/gods-eye-view-MIT.txt）的 src/share/viewCodec.js 與 follow.js
// 「位置＋模式＋追蹤的那艘船」的概念，但不用它的二進位編碼，改成看得懂的網址參數——
// 使用者自己看得出連結裡有什麼（例如座標），比較不會誤傳。
//
// 放在 # 後面：不會送到伺服器，也不會出現在 Cloudflare 的請求紀錄裡。
// 純函式，可離線測。

export interface ShareView {
  lat: number
  lng: number
  zoom: number
  /** 模式代號（ais、optical…）；沒給就不切換模式。 */
  mode?: string
  /** 要追蹤的船（9 碼 MMSI）。 */
  mmsi?: string
  /** 底圖代號。 */
  base?: string
}

const VERSION = '1'

/**
 * 組出分享網址。座標取 5 位小數（約 1 公尺），夠用又不會太長。
 * pageUrl 給目前頁面的完整網址（location.href）：只換掉 # 與 ? 的部分，
 * 這樣 App 放在子路徑（例如 /argus/）時連結也對——只拿 origin 會掉路徑。
 */
export function buildShareUrl(pageUrl: string, v: ShareView): string {
  const p = new URLSearchParams({ v: VERSION, c: `${v.lat.toFixed(5)},${v.lng.toFixed(5)},${Math.round(v.zoom)}` })
  if (v.mode) p.set('m', v.mode)
  if (v.mmsi) p.set('s', v.mmsi)
  if (v.base) p.set('b', v.base)
  const u = new URL(pageUrl)
  u.search = ''
  u.hash = p.toString()
  return u.toString()
}

/**
 * 讀分享網址的 # 部分。任何一項不合法就整個不採用（回 null），
 * 不要只套一半——例如座標壞了卻照樣切模式，使用者會以為連結有用。
 * modes／bases 由呼叫端給（App 實際有的代號），連結不能指定不存在的東西。
 */
export function parseShareHash(
  hash: string,
  allowed: { modes: readonly string[]; bases: readonly string[] },
): ShareView | null {
  const h = hash.replace(/^#/, '')
  if (!h) return null
  const p = new URLSearchParams(h)
  if (p.get('v') !== VERSION) return null
  const c = (p.get('c') ?? '').split(',').map(Number)
  if (c.length !== 3 || !c.every(Number.isFinite)) return null
  const [lat, lng, zoom] = c
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || zoom < 1 || zoom > 20) return null
  const out: ShareView = { lat, lng, zoom: Math.round(zoom) }
  const m = p.get('m')
  if (m !== null) {
    if (!allowed.modes.includes(m)) return null
    out.mode = m
  }
  const s = p.get('s')
  if (s !== null) {
    if (!/^\d{9}$/.test(s)) return null
    out.mmsi = s
  }
  const b = p.get('b')
  if (b !== null) {
    if (!allowed.bases.includes(b)) return null
    out.base = b
  }
  return out
}

/**
 * 交給手機的分享選單；不支援就複製到剪貼簿。回傳給人看的一句話。
 * 只帶 url、不帶 title：iOS 同時帶 title 時有些 App 只收到 title（見專案守則）。
 */
export async function shareUrl(url: string): Promise<string> {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined
  if (nav?.share) {
    try {
      await nav.share({ url })
      return '已開啟分享'
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return '已取消分享'
    }
  }
  try {
    await nav?.clipboard?.writeText(url)
    return '連結已複製，貼到 LINE 就能分享'
  } catch {
    return `分享不了，請手動複製：${url}`
  }
}
