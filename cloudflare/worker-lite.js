/**
 * 阿爾戈斯 精簡代理 Worker（手機貼上用）
 * 只做兩件事：① CWA 中央氣象署 API 代理（颱風/潮汐/海面，繞過瀏覽器 CORS）
 *            ② Sentinel 衛星目錄代理（自動找最近影像日期）
 * 部署後：把此 Worker 網址貼到 App ⚙️設定→「🤖 邊緣 AI Worker 網址」。
 * CWA 授權碼：App 會隨請求帶上（body.cwaKey），故 Worker 端可不必另設。
 * 用瀏覽器打開此 Worker 網址（GET）看到 {"ok":true...} 即代表部署正確。
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
}
const json = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', ...CORS } })

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS })
    if (request.method === 'GET')
      return json({ ok: true, service: 'argus-edge-ai', routes: ['cwaDataset', 'catalogSearch'], hasCwaKeySecret: Boolean(env.CWA_KEY) })
    if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405)

    let body
    try { body = await request.json() } catch { return json({ error: 'invalid json' }, 400) }

    // ① CWA 代理
    if (body?.cwaDataset) {
      const ds = String(body.cwaDataset || '')
      if (!/^[A-Z]-[A-Z0-9-]{3,20}$/.test(ds)) return json({ error: 'invalid cwaDataset' }, 400)
      const key = env.CWA_KEY || body.cwaKey
      if (!key) return json({ error: 'no CWA key' }, 400)
      const p = new URLSearchParams({ Authorization: String(key), format: 'JSON' })
      if (body.cwaParams && typeof body.cwaParams === 'object')
        for (const [k, v] of Object.entries(body.cwaParams))
          if (typeof v === 'string' || typeof v === 'number') p.set(k, String(v))
      try {
        const r = await fetch(`https://opendata.cwa.gov.tw/api/v1/rest/datastore/${ds}?${p}`, { headers: { accept: 'application/json' } })
        if (!r.ok) return json({ error: `CWA ${r.status}` }, 502)
        return json(await r.json())
      } catch (e) { return json({ error: String(e) }, 502) }
    }

    // ② 衛星目錄代理（找最近有影像的日期）
    if (body?.catalogSearch) {
      const box = String(body.box || '')
      if (!/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/.test(box)) return json({ error: 'invalid box' }, 400)
      const from = String(body.from || ''), to = String(body.to || '')
      const max = Math.min(200, Math.max(1, Number(body.maxRecords) || 100))
      const url = `https://catalogue.dataspace.copernicus.eu/resto/api/collections/Sentinel2/search.json?box=${encodeURIComponent(box)}&startDate=${encodeURIComponent(from)}&completionDate=${encodeURIComponent(to)}&productType=S2MSI2A&sortParam=startDate&sortOrder=descending&maxRecords=${max}`
      try {
        const r = await fetch(url, { headers: { accept: 'application/json' } })
        if (!r.ok) return json({ error: `catalog ${r.status}` }, 502)
        return json(await r.json())
      } catch (e) { return json({ error: String(e) }, 502) }
    }

    return json({ error: 'unknown route' }, 400)
  },
}
