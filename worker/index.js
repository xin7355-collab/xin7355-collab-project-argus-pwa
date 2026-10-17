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
 * 其餘所有路徑原封不動交給靜態資源處理，行為跟改之前一樣。
 */

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
])

/** TLE 一天大約只更新幾次，快取 6 小時；celestrak 也明確要求不要猛抓。 */
const TLE_CACHE_SECONDS = 6 * 60 * 60

async function proxyCelestrak(request, group, ctx) {
  if (!ALLOWED_GROUPS.has(group)) {
    return json({ error: `不支援的群組「${group}」` }, 400)
  }

  const upstream =
    `https://celestrak.org/NORAD/elements/gp.php` +
    `?GROUP=${encodeURIComponent(group)}&FORMAT=tle`

  // 用 Cloudflare 的邊緣快取，避免每個使用者、每次開 App 都去敲 celestrak。
  const cacheKey = new Request(upstream, { method: 'GET' })
  const cache = caches.default
  const hit = await cache.match(cacheKey)
  if (hit) return withCors(hit)

  let res
  try {
    res = await fetch(upstream, {
      headers: {
        // celestrak 要求帶可辨識的 UA；匿名猛抓會被擋。
        'user-agent': 'argus-pwa (maritime observation; contact via GitHub)',
      },
      // 邊緣再快取一層，連 subrequest 都省下來
      cf: { cacheTtl: TLE_CACHE_SECONDS, cacheEverything: true },
    })
  } catch (e) {
    return json({ error: `連不到 celestrak：${e.message}` }, 502)
  }

  if (!res.ok) {
    // 把上游的狀態碼帶出去，前端才分得出「沒資料」和「被擋」。
    return json({ error: `celestrak 回應 ${res.status}` }, res.status === 404 ? 404 : 502)
  }

  const text = await res.text()
  // celestrak 出錯時會回 HTML 錯誤頁而不是 TLE，並且仍然是 200。
  // 不擋掉的話前端會把一整頁 HTML 當成軌道根數去解析。
  if (!text.startsWith('1 ') && !/\r?\n1 /.test(text)) {
    return json({ error: 'celestrak 回傳的不是 TLE（多半是上游暫時故障）' }, 502)
  }

  const out = new Response(text, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': `public, max-age=${TLE_CACHE_SECONDS}`,
    },
  })
  ctx.waitUntil(cache.put(cacheKey, out.clone()))
  return withCors(out)
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

/** 同源呼叫其實不需要 CORS，但本機開發是不同 port，加上去才不用特例處理。 */
function withCors(res) {
  const r = new Response(res.body, res)
  r.headers.set('access-control-allow-origin', '*')
  return r
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

/** 只准自己的網頁用這個轉接，不然就是一個任人使用的 aisstream 免費代理。 */
function originAllowed(origin, url) {
  if (!origin) return true // 非瀏覽器（例如探測腳本）不帶 Origin
  try {
    const h = new URL(origin).host
    return h === url.host || /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(h)
  } catch {
    return false
  }
}

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
  } catch (e) {
    return json({ error: `連不到 aisstream：${e.message}` }, 502)
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)

    if (url.pathname === '/api/ais') return proxyAis(request, url, env)

    const m = url.pathname.match(/^\/api\/celestrak\/([A-Za-z0-9_-]+)\/?$/)
    if (m) {
      if (request.method !== 'GET') return json({ error: '只接受 GET' }, 405)
      return proxyCelestrak(request, m[1], ctx)
    }

    if (url.pathname.startsWith('/api/')) {
      return json({ error: '沒有這個 API' }, 404)
    }

    // 其餘一律照舊交給靜態資源（含 SPA 的 not_found_handling）。
    return env.ASSETS.fetch(request)
  },
}
