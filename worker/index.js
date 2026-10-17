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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)

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
