/**
 * 主 App 的 Cloudflare Worker。
 *
 * 原本這支 Worker 是「純靜態資源」（wrangler.jsonc 只有 assets，沒有程式碼）。
 * 加上程式碼是為了一件事：**幫瀏覽器代抓 celestrak 的軌道根數（TLE）**。
 *
 * 為什麼非代理不可：celestrak 沒有送 CORS 標頭，瀏覽器直連會被擋。
 * 沒有 TLE 就算不出衛星的地面軌跡，也就無法回答「這一趟會不會掃到我這片海」。
 * （這是先前只能畫 ISS、其他衛星一律不畫的原因。）
 *
 * 後來加了第二件：**幫瀏覽器代連 aisstream.io 的 AIS 即時船位**（/api/ais）。
 *
 * 之後陸續加了：氣象署代理（/api/cwa）、飛機 ADS-B 代理（/api/adsb，見 adsb.js）、
 * 給 Claude 等 AI 助理用的 MCP 伺服器（/mcp，見 mcp.js）、語音助理（/api/ai，見 ai.js）、
 * 無人機禁限航區靜態資料（/drone/，見 drone.js）。
 *
 * 其餘所有路徑原封不動交給靜態資源處理，行為跟改之前一樣。
 */

import { json, withCors, originAllowed } from './http.js'
import { proxyAdsb } from './adsb.js'
import { handleMcp } from './mcp.js'
import { handleAi } from './ai.js'
import { serveDrone } from './drone.js'

/**
 * 只准代理這幾個 celestrak 群組。
 *
 * 不做白名單的話，這支 Worker 就變成一個任人使喚的開放代理——
 * 別人可以拿你的網域去抓任何東西，流量算你的、被封鎖也算你的。
 */
const ALLOWED_GROUPS = new Set([
  'resource', // 地球觀測衛星（Sentinel、Landsat…）
  'weather', // 氣象衛星
  'science',
  'stations', // 含 ISS
  'sar', // 雷達衛星（Sentinel-1、ICEYE、Capella、RCM…）
])

/** TLE 一天大約只更新幾次，快取 6 小時；celestrak 也明確要求不要猛抓。 */
const TLE_CACHE_SECONDS = 6 * 60 * 60
/**
 * 備份留 7 天：celestrak 暫時連不到時拿上一份成功的頂著（標明是舊的）。
 * 7 天內的 TLE 推算誤差還在幾公里內；再舊就寧可講算不出來。
 * 做法參考 gods-eye-view（MIT）的 server/providers/space/celestrak.js。
 */
const TLE_BACKUP_SECONDS = 7 * 24 * 60 * 60
const CELESTRAK = 'https://celestrak.org/NORAD/elements/gp.php'

async function proxyCelestrak(request, group, ctx, env) {
  if (!ALLOWED_GROUPS.has(group)) {
    return json({ error: `不支援的群組「${group}」` }, 400)
  }

  const upstream = `${env.CELESTRAK_BASE || CELESTRAK}?GROUP=${encodeURIComponent(group)}&FORMAT=tle`
  // 測試時可用環境變數把快取改短，才驗得到「過期＋上游壞掉 → 回備份」
  const ttl = Number(env.TLE_CACHE_SECONDS) || TLE_CACHE_SECONDS

  // 用 Cloudflare 的邊緣快取，避免每個使用者、每次開 App 都去敲 celestrak。
  const cacheKey = new Request(upstream, { method: 'GET' })
  const backupKey = new Request(`${upstream}&argus-backup=1`, { method: 'GET' })
  const cache = caches.default
  const hit = await cache.match(cacheKey)
  if (hit) return withCors(hit)

  // 上游失敗：有備份就回備份（標明是舊的），沒有才回錯誤
  const fallback = async (why, status) => {
    const old = await cache.match(backupKey)
    if (!old) return json({ error: why }, status)
    const r = new Response(old.body, old)
    r.headers.set('x-tle-stale', '1')
    r.headers.set('cache-control', 'no-store')
    return withCors(r)
  }

  let res
  try {
    res = await fetch(upstream, {
      headers: {
        // celestrak 要求帶可辨識的 UA；匿名猛抓會被擋。
        'user-agent': 'argus-pwa (maritime observation; contact via GitHub)',
      },
      // 邊緣再快取一層，連 subrequest 都省下來
      cf: { cacheTtl: ttl, cacheEverything: true },
    })
  } catch {
    // 不把底層錯誤原文丟給前端：使用者看不懂，也可能帶出內部細節
    return fallback('連不到 celestrak（網路或對方暫停服務），稍後再試', 502)
  }

  if (!res.ok) {
    // 把上游的狀態碼帶出去，前端才分得出「沒資料」和「被擋」。
    return fallback(`celestrak 回應 ${res.status}`, res.status === 404 ? 404 : 502)
  }

  const text = await res.text()
  // celestrak 出錯時會回 HTML 錯誤頁而不是 TLE，並且仍然是 200。
  // 不擋掉的話前端會把一整頁 HTML 當成軌道根數去解析。
  if (!text.startsWith('1 ') && !/\r?\n1 /.test(text)) {
    return fallback('celestrak 回傳的不是 TLE（多半是上游暫時故障）', 502)
  }

  const fetchedAt = new Date().toISOString()
  const out = new Response(text, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': `public, max-age=${ttl}`,
      'x-fetched-at': fetchedAt,
    },
  })
  ctx.waitUntil(cache.put(cacheKey, out.clone()))
  ctx.waitUntil(
    cache.put(
      backupKey,
      new Response(text, {
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': `public, max-age=${TLE_BACKUP_SECONDS}`,
          'x-fetched-at': fetchedAt,
        },
      }),
    ),
  )
  return withCors(out)
}

// ── AIS 即時船位轉接（/api/ais）────────────────────────────
//
// aisstream.io 官方文件明講：不支援從瀏覽器直接連線（不送 CORS），建議走伺服器端代理。
// App 原本就是從 iPhone 瀏覽器直連，這就是「AIS 不能用」的原因。
//
// 做法是「直接轉手」：把升級成 WebSocket 的請求換個地址送給 aisstream，
// 再把它的回應原樣交回瀏覽器。Cloudflare 會自己把兩條連線接起來，
// 之後每一筆船位都不經過這支程式——免費方案每次請求只有 10ms CPU，
// 如果每筆訊息都由 JS 轉發，船一多就會被砍。
//
// 金鑰照舊由 App 在連上後的第一則訊息送出（使用者在 ⚙️ 設定填的），這裡不碰。

/** 上游。測試時可用環境變數換成本機假伺服器。 */
const AIS_UPSTREAM = 'https://stream.aisstream.io/v0/stream'

async function proxyAis(request, url, env) {
  if ((request.headers.get('upgrade') || '').toLowerCase() !== 'websocket') {
    return json({ error: '這個網址只接受 WebSocket 連線' }, 426)
  }
  if (!originAllowed(request.headers.get('origin'), url)) {
    return json({ error: '不接受其他網站的連線' }, 403)
  }
  // 不帶瀏覽器的 Origin／Cookie 過去：對 aisstream 來說這是一條伺服器端連線
  const headers = new Headers({ upgrade: 'websocket' })
  const proto = request.headers.get('sec-websocket-protocol')
  if (proto) headers.set('sec-websocket-protocol', proto)
  try {
    const res = await fetch(env.AIS_UPSTREAM || AIS_UPSTREAM, { headers })
    if (res.status !== 101 || !res.webSocket) {
      return json({ error: `aisstream 拒絕連線（HTTP ${res.status}）` }, 502)
    }
    return res
  } catch {
    return json({ error: '連不到 aisstream（網路或對方暫停服務），稍後再試' }, 502)
  }
}

// ── 中央氣象署 Open Data 代理（/api/cwa/{資料集}）──────────────────
//
// 以前 App 直接從瀏覽器打氣象署，授權碼放在網址（?Authorization=…）——網址會出現在
// 瀏覽紀錄、錯誤訊息、各種記錄裡，違反「金鑰只走標頭」；而且氣象署沒給 CORS（實測 401 回應
// 沒有 Access-Control-Allow-Origin），瀏覽器直連多半本來就不通。
// 改成：App 把授權碼放在 x-cwa-key 標頭交給同網域的這支 Worker，由這裡去問氣象署。
// 氣象署文件與教學只寫了放網址的用法（放標頭是否支援沒查到官方說明），所以伺服器這段仍放網址，
// 但只在 Cloudflare 內部，不回給瀏覽器、也不寫進錯誤訊息。
// 有設 Worker secret CWA_KEY 的話優先用它（App 那邊就不用填）。

const CWA_BASE = 'https://opendata.cwa.gov.tw/api/v1/rest/datastore'

async function proxyCwa(request, url, env, dataset) {
  if (request.method !== 'GET') return json({ error: '只接受 GET' }, 405)
  if (!originAllowed(request.headers.get('origin'), url)) return json({ error: '不接受其他網站的請求' }, 403)
  // 資料集代碼長這樣：F-C0032-001、W-C0034-005、O-A0001-001
  if (!/^[A-Z]-[A-Z0-9]{1,6}-\d{3}$/.test(dataset)) return json({ error: `資料集代碼「${dataset}」格式不對` }, 400)
  const key = env.CWA_KEY || request.headers.get('x-cwa-key') || ''
  if (!key) return json({ error: '還沒設定氣象署授權碼（⚙️ 設定 → CWA 授權碼）' }, 400)
  const params = new URLSearchParams({ format: 'JSON' })
  for (const [k, v] of url.searchParams) {
    // 只轉送一般查詢參數；授權碼一律由標頭／secret 帶，網址上的不收
    if (/^[A-Za-z]{1,30}$/.test(k) && k.toLowerCase() !== 'authorization') params.set(k, v.slice(0, 200))
  }
  params.set('Authorization', key)
  let res
  try {
    res = await fetch(`${env.CWA_BASE || CWA_BASE}/${dataset}?${params}`, { headers: { accept: 'application/json' } })
  } catch {
    return json({ error: '連不到氣象署（網路或對方暫停服務），稍後再試' }, 502)
  }
  if (res.status === 401 || res.status === 403) {
    return json({ error: '氣象署說授權碼不對：到氣象署開放資料平台確認授權碼，重新複製貼到 ⚙️ 設定' }, 401)
  }
  if (!res.ok) return json({ error: `氣象署回應 ${res.status}，稍後再試` }, 502)
  return new Response(res.body, {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)

    if (url.pathname === '/api/ais') return proxyAis(request, url, env)

    if (url.pathname === '/api/adsb') return proxyAdsb(request, url, env, ctx)

    if (url.pathname === '/mcp') return handleMcp(request, url, env, ctx)

    if (url.pathname === '/api/ai') return handleAi(request, url, env, ctx)

    const cwa = url.pathname.match(/^\/api\/cwa\/([A-Za-z0-9-]+)\/?$/)
    if (cwa) return proxyCwa(request, url, env, cwa[1])

    const m = url.pathname.match(/^\/api\/celestrak\/([A-Za-z0-9_-]+)\/?$/)
    if (m) {
      if (request.method !== 'GET') return json({ error: '只接受 GET' }, 405)
      return proxyCelestrak(request, m[1], ctx, env)
    }

    if (url.pathname.startsWith('/api/')) {
      return json({ error: '沒有這個 API' }, 404)
    }

    // 無人機禁限航區資料（靜態檔；缺檔回 404 not_ready，不要被 SPA 模式換成 index.html）
    if (url.pathname.startsWith('/drone/')) return serveDrone(request, env)

    // 其餘一律照舊交給靜態資源（含 SPA 的 not_found_handling）。
    return env.ASSETS.fetch(request)
  },
}
