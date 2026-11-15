// Worker 各路由共用的小工具。

/** 回一個 JSON。錯誤訊息一律寫給人看（中文、講能做什麼），不放上游的原始錯誤。 */
export function json(obj, status, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  })
}

/** 同源呼叫其實不需要 CORS，但本機開發是不同 port，加上去才不用特例處理。 */
export function withCors(res) {
  const r = new Response(res.body, res)
  r.headers.set('access-control-allow-origin', '*')
  r.headers.set('access-control-expose-headers', 'x-tle-stale, x-fetched-at, x-adsb-stale, x-adsb-age, retry-after')
  return r
}

/** 只准自己的網頁用這些轉接，不然就是一個任人使用的免費代理。 */
export function originAllowed(origin, url) {
  if (!origin) return true // 非瀏覽器（例如探測腳本）、同源 GET 不帶 Origin
  try {
    const h = new URL(origin).host
    return h === url.host || /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(h)
  } catch {
    return false
  }
}
