// ── 飛機 ADS-B 代理（/api/adsb?lat=&lon=&dist=）──────────────────
//
// adsb.lol 沒送 CORS 標頭，瀏覽器不能直連，所以由這裡轉手。
// 做法參考 gods-eye-view（MIT，見 docs/licenses/gods-eye-view-MIT.txt）的
// server/providers/aircraft/adsb-lol.js 與 server/providers/gnssIntegrity.js：
//   - 位置對齊格點、半徑只用幾種，附近的人共用同一份快取（對齊規則和 App 共用 src/lib/adsb.ts）。
//   - 快取 12 秒：飛機一直在動，再久就不準；也不讓每支手機各打一次 adsb.lol。
//   - 另外留一份 30 分鐘的備份：adsb.lol 限流或掛掉時拿它頂著並標明是舊的（x-adsb-stale），
//     GPS 干擾推估本來就是看 30 分鐘內的資料，舊一點仍有用。
//   - 只轉 App 用得到的欄位（約省一半以上流量，海上訊號差時差很多）。
//   - 回應帶 x-adsb-age：快照在伺服器端已經多舊（用伺服器時鐘算，手機時間不準也不影響）。

import { adsbAnchor, trimAdsb, snapshotMs } from '../src/lib/adsb.ts'
import { json, withCors, originAllowed } from './http.js'

const ADSB_BASE = 'https://api.adsb.lol/v2'
const FRESH_SECONDS = 12
const BACKUP_SECONDS = 30 * 60
const TIMEOUT_MS = 10_000

/** 把快取裡的回應交出去：補上「現在已經多舊」，給瀏覽器的一律不快取。 */
function serve(res, stale) {
  const r = new Response(res.body, res)
  const sourceMs = Number(r.headers.get('x-source-now'))
  if (Number.isFinite(sourceMs) && sourceMs > 0) {
    r.headers.set('x-adsb-age', String(Math.max(0, Math.round((Date.now() - sourceMs) / 1000))))
  }
  r.headers.delete('x-source-now')
  r.headers.set('cache-control', 'no-store')
  if (stale) r.headers.set('x-adsb-stale', '1')
  return withCors(r)
}

export async function proxyAdsb(request, url, env, ctx) {
  if (request.method !== 'GET') return json({ error: '只接受 GET' }, 405)
  if (!originAllowed(request.headers.get('origin'), url)) return json({ error: '不接受其他網站的請求' }, 403)
  const q = url.searchParams
  const anchor = adsbAnchor(Number(q.get('lat')), Number(q.get('lon')), Number(q.get('dist')))
  if (!anchor) return json({ error: '位置或範圍不對（lat 緯度、lon 經度、dist 半徑浬）' }, 400)

  const upstream = `${env.ADSB_BASE || ADSB_BASE}/lat/${anchor.lat}/lon/${anchor.lon}/dist/${anchor.dist}`
  const cache = caches.default
  const freshKey = new Request(upstream)
  const backupKey = new Request(`${upstream}?argus-backup=1`)
  const hit = await cache.match(freshKey)
  if (hit) return serve(hit, false)

  // 上游失敗：有備份就回備份（標明是舊的），沒有才回錯誤
  const fallback = async (why, status, retryAfter) => {
    const old = await cache.match(backupKey)
    if (old) return serve(old, true)
    return withCors(json({ error: why }, status, retryAfter ? { 'retry-after': String(retryAfter) } : {}))
  }

  let res
  try {
    res = await fetch(upstream, {
      headers: { accept: 'application/json', 'user-agent': 'argus-pwa (maritime observation; contact via GitHub)' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    // 不把底層錯誤原文丟給前端：使用者看不懂，也可能帶出內部細節
    return fallback('連不到 adsb.lol（網路或對方暫停服務），稍後自動再試', 502)
  }
  if (res.status === 429) {
    const ra = Number(res.headers.get('retry-after'))
    const wait = Number.isFinite(ra) && ra > 0 ? Math.min(600, Math.ceil(ra)) : 60
    return fallback(`adsb.lol 限流中，約 ${wait} 秒後自動再試`, 429, wait)
  }
  if (!res.ok) return fallback(`adsb.lol 回應 ${res.status}，稍後自動再試`, 502)
  let payload
  try {
    payload = await res.json()
  } catch {
    return fallback('adsb.lol 回傳的不是資料（多半是對方暫時故障），稍後自動再試', 502)
  }
  const trimmed = trimAdsb(payload)
  if (!trimmed) return fallback('adsb.lol 回傳的格式不對（多半是對方暫時故障），稍後自動再試', 502)

  const body = JSON.stringify(trimmed)
  const sourceMs = snapshotMs(trimmed.now) ?? Date.now()
  const stored = (ttl) =>
    new Response(body, {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': `public, max-age=${ttl}`,
        'x-fetched-at': new Date().toISOString(),
        'x-source-now': String(sourceMs),
      },
    })
  ctx.waitUntil(cache.put(freshKey, stored(FRESH_SECONDS)))
  ctx.waitUntil(cache.put(backupKey, stored(BACKUP_SECONDS)))
  return serve(stored(FRESH_SECONDS), false)
}
