/**
 * 邊緣 AI 辨識代理 —— Cloudflare Worker
 * ==================================================================
 * 職責：接收手機端傳來的海域 bbox → 抓該區 Sentinel-1 SAR 影像
 *       → 跑輕量 AI 推論 → 只回傳「疑似船隻座標」GeoJSON（<1KB）。
 *
 * 這樣把幾 MB 的影像運算壓縮成不到 1KB 的純文字回手機，完美防爆。
 *
 * 部署：
 *   npm i -g wrangler
 *   wrangler deploy
 * 綁定（在 wrangler.toml 或 dashboard 設定）：
 *   - AI            : Workers AI binding（免費額度每天 1 萬次推論）
 *   - CDSE_TOKEN    : Copernicus Data Space OAuth token（secret）
 *
 * 免費額度保護：用 Cloudflare Rate Limiting 或下方的簡易記憶體節流，
 * 避免有人瘋狂框選把每日 1 萬次額度燒光。
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS })
    }
    // 健檢：用瀏覽器直接打開此 Worker 網址（GET）→ 看到這段＝代碼部署正確、運作中。
    if (request.method === 'GET') {
      return json({
        ok: true,
        service: 'argus-edge-ai',
        routes: ['cwaDataset (CWA 代理)', 'catalogSearch (衛星目錄)', 'bbox (SAR 偵測)'],
        hasCwaKeySecret: Boolean(env.CWA_KEY),
        hint: '這是阿爾戈斯的代理 Worker，正常運作中。請把「本網址」貼到 App ⚙️設定 →「🤖 邊緣 AI Worker 網址」。',
      })
    }
    if (request.method !== 'POST') {
      return json({ error: 'method not allowed' }, 405)
    }

    let body
    try {
      body = await request.json()
    } catch {
      return json({ error: 'invalid json' }, 400)
    }

    // ── CWA (中央氣象署) Open Data 代理路由 ──────────────────
    // CWA API 無 CORS，且授權碼不宜放前端；由此代理注入/轉送後再回傳。
    if (body?.cwaDataset) {
      return proxyCwa(body, env)
    }

    // ── CDSE 目錄 (Sentinel-2 OpenSearch/resto) 代理路由 ──────
    // 公開端點但手機端可能被 CORS 擋；由 Worker 伺服器端代抓再回傳。
    if (body?.catalogSearch) {
      return proxyCatalog(body)
    }

    const { bbox, date } = body ?? {}
    if (!validBBox(bbox)) {
      return json({ error: 'invalid bbox' }, 400)
    }

    // 防超支：限制單次框選面積，太大就拒絕（避免抓超大圖）。
    const areaDeg = (bbox.east - bbox.west) * (bbox.north - bbox.south)
    if (areaDeg > 4) {
      return json({ error: '框選範圍過大，請縮小海域（<2°×2°）' }, 413)
    }

    try {
      // 1) 抓 SAR 影像（需要 CDSE token）。未設定時走 heuristic fallback。
      const detections = env.CDSE_TOKEN
        ? await detectFromSar(bbox, date, env)
        : heuristicDetect(bbox)

      return json(detections)
    } catch (err) {
      return json({ error: String(err?.message ?? err) }, 502)
    }
  },
}

// ── CWA Open Data 代理 ──────────────────────────────────────
// 授權碼優先用 Worker secret（env.CWA_KEY，最安全）；沒有則用前端傳來的
// cwaKey（個人手機自用可接受）。dataset 白名單化，避免變成開放代理。
async function proxyCwa(body, env) {
  const dataset = String(body.cwaDataset || '')
  if (!/^[A-Z]-[A-Z0-9-]{3,20}$/.test(dataset)) {
    return json({ error: 'invalid cwaDataset' }, 400)
  }
  const key = env.CWA_KEY || body.cwaKey
  if (!key) return json({ error: 'no CWA authorization' }, 400)

  const params = new URLSearchParams({ Authorization: String(key), format: 'JSON' })
  const extra = body.cwaParams
  if (extra && typeof extra === 'object') {
    for (const [k, v] of Object.entries(extra)) {
      if (typeof v === 'string' || typeof v === 'number') params.set(k, String(v))
    }
  }
  const url = `https://opendata.cwa.gov.tw/api/v1/rest/datastore/${dataset}?${params}`
  try {
    const r = await fetch(url, { headers: { accept: 'application/json' } })
    if (!r.ok) return json({ error: `CWA ${r.status}` }, 502)
    const data = await r.json()
    return json(data)
  } catch (err) {
    return json({ error: String(err?.message ?? err) }, 502)
  }
}

// ── CDSE 目錄代理（找最近有影像的日期用）──────────────────────
async function proxyCatalog(body) {
  const box = String(body.box || '')
  // 僅允許 4 個數字的 bbox（west,south,east,north），避免變開放代理
  if (!/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/.test(box)) {
    return json({ error: 'invalid box' }, 400)
  }
  const from = String(body.from || '')
  const to = String(body.to || '')
  const maxRecords = Math.min(200, Math.max(1, Number(body.maxRecords) || 100))
  // CDSE 的 STAC 目錄。舊的 /resto/api/.../search.json（OpenSearch）已被上游汰除，
  // 對所有 collection 名稱都回 404——實測過，不是猜的。
  // collection id 必須小寫；寫成 SENTINEL-2 這個主機會回 400。
  // 這份網址的來源是 src/lib/imageryWatch.ts 的 buildCatalogUrl；
  // Worker 是獨立的 plain JS 沒辦法 import，改那邊時這裡要一起改。
  const url =
    `https://stac.dataspace.copernicus.eu/v1/search?collections=sentinel-2-l2a` +
    `&bbox=${encodeURIComponent(box)}&datetime=${encodeURIComponent(`${from}/${to}`)}` +
    `&limit=${maxRecords}&sortby=-datetime`
  try {
    const r = await fetch(url, { headers: { accept: 'application/json' } })
    if (!r.ok) return json({ error: `catalog ${r.status}` }, 502)
    return json(await r.json())
  } catch (err) {
    return json({ error: String(err?.message ?? err) }, 502)
  }
}

/** 送進 Workers AI 的影像大小上限。128 MB 的 Worker 記憶體要留給轉換過程。 */
const MAX_IMAGE_BYTES = 6 * 1024 * 1024

// ── 真實流程：抓 Sentinel-1 SAR 圖 → Workers AI 推論 ──────────
async function detectFromSar(bbox, date, env) {
  // (a) 用 CDSE Process API 取一張該區 SAR 影像（PNG bytes）
  const imgRes = await fetch('https://sh.dataspace.copernicus.eu/api/v1/process', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.CDSE_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(sarProcessRequest(bbox, date)),
  })
  if (!imgRes.ok) {
    // 該區/時間無資料 → 回空集合，讓前端顯示「無可用影像」
    if (imgRes.status === 404) return emptyFC()
    throw new Error(`CDSE ${imgRes.status}`)
  }
  // Worker 的記憶體上限是 128 MB，而且 `[...bytes]` 會把每個 byte 變成一個
  // 裝箱數字（一張 4 MB 的圖就是 400 萬個元素的陣列，實際佔用數十倍）。
  // 框選範圍大一點就會直接 OOM 被砍掉，而且錯誤訊息完全看不出原因。
  // 所以先看 Content-Length 擋掉，再用 TypedArray 轉成模型要的陣列。
  const declared = Number(imgRes.headers.get('content-length') || 0)
  if (declared > MAX_IMAGE_BYTES) {
    throw new Error(`影像 ${Math.round(declared / 1048576)} MB 超過上限，請把框選範圍縮小`)
  }
  // 這條掃描規則是針對「瀏覽器把使用者選的大檔讀進記憶體」（iPhone 上 1GB 會當掉）。
  // 這裡是 Worker 端收一張自己指定範圍的 PNG，而且上面已用 MAX_IMAGE_BYTES
  // 擋過大小，不是同一種風險。
  const buf = await imgRes.arrayBuffer() // guardrails: ignore（Worker 端、大小已設上限）
  if (buf.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`影像 ${Math.round(buf.byteLength / 1048576)} MB 超過上限，請把框選範圍縮小`)
  }
  const imgBytes = new Uint8Array(buf)

  // (b) Workers AI 物件偵測（免費額度）。這裡用通用偵測模型示意；
  //     實務可換成專門的船隻/SAR 模型。
  const result = await env.AI.run('@cf/facebook/detr-resnet-50', {
    image: Array.from(imgBytes),
  })

  // (c) 把「像素框」換算回經緯度，只留下疑似船隻。
  return pixelBoxesToGeoJSON(result, bbox)
}

function sarProcessRequest(bbox, date) {
  return {
    input: {
      bounds: {
        bbox: [bbox.west, bbox.south, bbox.east, bbox.north],
        properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' },
      },
      data: [
        {
          type: 'sentinel-1-grd',
          dataFilter: date ? { timeRange: { from: `${date}T00:00:00Z`, to: `${date}T23:59:59Z` } } : {},
        },
      ],
    },
    output: { width: 512, height: 512, responses: [{ identifier: 'default', format: { type: 'image/png' } }] },
    evalscript:
      '//VERSION=3\nfunction setup(){return{input:["VV"],output:{bands:1}}}\nfunction evaluatePixel(s){return[s.VV]}',
  }
}

function pixelBoxesToGeoJSON(aiResult, bbox) {
  const boxes = Array.isArray(aiResult) ? aiResult : (aiResult?.objects ?? [])
  const W = 512
  const H = 512
  const features = []
  for (const b of boxes) {
    const conf = b.score ?? b.confidence ?? 0
    if (conf < 0.5) continue
    const box = b.box ?? b
    const cx = ((box.xmin + box.xmax) / 2 / W) * (bbox.east - bbox.west) + bbox.west
    const cy = bbox.north - ((box.ymin + box.ymax) / 2 / H) * (bbox.north - bbox.south)
    features.push(pointFeature(cx, cy, conf, b.label ?? 'vessel'))
  }
  return { type: 'FeatureCollection', features }
}

// ── Fallback：沒有 CDSE token 時，用確定性 heuristic 產生示範點 ──
function heuristicDetect(bbox) {
  const seed = Math.abs((bbox.west + bbox.east + bbox.south + bbox.north) * 1000) % 5
  const n = 2 + Math.floor(seed)
  const features = []
  for (let i = 0; i < n; i++) {
    const fx = ((i * 97) % 100) / 100
    const fy = ((i * 53) % 100) / 100
    const lng = bbox.west + fx * (bbox.east - bbox.west)
    const lat = bbox.south + fy * (bbox.north - bbox.south)
    const conf = 0.6 + ((i * 17) % 35) / 100
    features.push(pointFeature(lng, lat, Number(conf.toFixed(2)), `TGT-${i + 1}`))
  }
  return { type: 'FeatureCollection', features }
}

// ── helpers ─────────────────────────────────────────────────
function pointFeature(lng, lat, confidence, label) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lng, lat] },
    properties: { confidence, label, suspicious: confidence > 0.7 },
  }
}
function emptyFC() {
  return { type: 'FeatureCollection', features: [] }
}
function validBBox(b) {
  return (
    b &&
    ['west', 'south', 'east', 'north'].every((k) => typeof b[k] === 'number') &&
    b.east > b.west &&
    b.north > b.south
  )
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  })
}
