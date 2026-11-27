// 探測無人機功能用到的外部來源（手動觸發，見 .github/workflows/drone-probe.yml）。
// 開發沙箱連不到這些主機，所以從 GitHub 伺服器實測：
// 1. 民航局 GIS（dronegis.caa.gov.tw）：連得到嗎、憑證鏈完不完整（缺中繼憑證時印出 AIA 網址與指紋）、
//    各圖層筆數與單次上限、有沒有 CORS。
// 2. GitHub 上的每日鏡像（民航局擋掉時的備援）：最新版本與筆數。
// 3. Open-Meteo：10／80／120 公尺風、陣風、降雨、能見度欄位都在不在。
// 4. NOAA SWPC 地磁 Kp：格式與 CORS。
// 只用公開地標（桃園國際機場）；不讀任何 Secret；紀錄只印結構與數量。
import tls from 'node:tls'
import https from 'node:https'
import http from 'node:http'
import crypto from 'node:crypto'

const HOST = 'dronegis.caa.gov.tw'
const BASE = `https://${HOST}/server/rest/services`
const LAYERS = [
  ['主空域', 'Hosted/UAV_fs/FeatureServer/3'],
  ['臨時空域', 'Hosted/Temporary_Area/FeatureServer/19'],
  ['商港區', 'Hosted/Commercial_Port_fs/FeatureServer/4'],
  ['國家公園', 'Hosted/National_Park_fs/FeatureServer/0'],
]
const ORIGIN = 'https://argus-app.xin7355.workers.dev'
const LAT = 25.0777
const LNG = 121.2328
const line = (s = '') => console.log(s)
const errCode = (e) => e?.cause?.code || e?.code || e?.name || String(e)

/** 只讀憑證資訊、不送任何資料：rejectUnauthorized 關掉才拿得到「驗不過」的鏈來看缺什麼。 */
function inspectChain() {
  return new Promise((resolve) => {
    const sock = tls.connect({ host: HOST, port: 443, servername: HOST, rejectUnauthorized: false, timeout: 20000 }, () => {
      const chain = []
      let c = sock.getPeerCertificate(true)
      const seen = new Set()
      while (c && c.fingerprint256 && !seen.has(c.fingerprint256)) {
        seen.add(c.fingerprint256)
        chain.push({
          subject: c.subject?.CN || c.subject?.O,
          issuer: c.issuer?.CN || c.issuer?.O,
          validTo: c.valid_to,
          aia: c.infoAccess?.['CA Issuers - URI']?.[0],
        })
        c = c.issuerCertificate
      }
      resolve({ authorized: sock.authorized, error: sock.authorizationError, chain })
      sock.end()
    })
    sock.on('error', (e) => resolve({ error: errCode(e), chain: [] }))
    sock.on('timeout', () => {
      sock.destroy()
      resolve({ error: 'TIMEOUT', chain: [] })
    })
  })
}

function getBuffer(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http
    mod
      .get(url, { timeout: 20000 }, (res) => {
        const parts = []
        res.on('data', (d) => parts.push(d))
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(parts) }))
      })
      .on('error', reject)
      .on('timeout', function () {
        this.destroy(new Error('TIMEOUT'))
      })
  })
}

const derToPem = (der) => `-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`

/** 用補上的中繼憑證、照常驗證去要 JSON。 */
function getJsonWithCa(url, ca) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { ca: [...tls.rootCertificates, ...ca], timeout: 30000, headers: { origin: ORIGIN } }, (res) => {
        const parts = []
        res.on('data', (d) => parts.push(d))
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, headers: res.headers, json: JSON.parse(Buffer.concat(parts).toString('utf8')) })
          } catch (e) {
            reject(new Error(`HTTP ${res.statusCode}，回的不是 JSON`))
          }
        })
      })
      .on('error', reject)
      .on('timeout', function () {
        this.destroy(new Error('TIMEOUT'))
      })
  })
}

line('== 1. 民航局 GIS ==')
const chain = await inspectChain()
line(`TLS：${chain.authorized ? '✅ 驗證通過' : `❌ ${chain.error}`}`)
for (const c of chain.chain) line(`  憑證：${c.subject} ← 發證：${c.issuer}（到期 ${c.validTo}）${c.aia ? ` AIA=${c.aia}` : ''}`)

let extraCa = []
try {
  const r = await fetch(`${BASE}/${LAYERS[0][1]}/query?where=1%3D1&returnCountOnly=true&f=json`, { signal: AbortSignal.timeout(30000) })
  line(`一般 fetch（照常驗證）：HTTP ${r.status}`)
} catch (e) {
  line(`一般 fetch（照常驗證）：❌ ${errCode(e)}`)
  const aia = chain.chain[0]?.aia
  if (aia) {
    try {
      const got = await getBuffer(aia)
      const pem = got.body.toString('utf8').includes('BEGIN CERTIFICATE') ? got.body.toString('utf8') : derToPem(got.body)
      const x = new crypto.X509Certificate(pem)
      line(`  從 AIA 抓到中繼憑證：${x.subject.replace(/\n/g, ', ')}`)
      line(`  發證者：${x.issuer.replace(/\n/g, ', ')}；到期 ${x.validTo}`)
      line(`  SHA-256 指紋：${x.fingerprint256}`)
      extraCa = [pem]
    } catch (e2) {
      line(`  AIA 抓不到：${errCode(e2)}`)
    }
  }
}

for (const [name, svc] of LAYERS) {
  try {
    const info = await getJsonWithCa(`${BASE}/${svc}?f=json`, extraCa)
    const cnt = await getJsonWithCa(`${BASE}/${svc}/query?where=1%3D1&returnCountOnly=true&f=json`, extraCa)
    line(
      `✅ ${name}：${cnt.json.count} 筆；單次上限 ${info.json.maxRecordCount}；幾何 ${info.json.geometryType}；欄位 ${info.json.fields?.length}；` +
        `CORS=${cnt.headers['access-control-allow-origin'] ?? '（沒有）'}`,
    )
  } catch (e) {
    line(`❌ ${name}：${errCode(e)} ${e.message ?? ''}`)
  }
}

line()
line('== 2. GitHub 每日鏡像 ==')
try {
  const r = await fetch('https://github.com/TonyPepeBear/taiwan-drone-caa-data/releases/latest/download/manifest.json', { signal: AbortSignal.timeout(30000) })
  const m = await r.json()
  line(`✅ ${m.tag}（${m.generated_at}）：` + m.layers.map((l) => `${l.slug} ${l.feature_count}`).join('、'))
} catch (e) {
  line(`❌ ${errCode(e)}`)
}

line()
line('== 3. Open-Meteo ==')
const HOURLY = 'wind_speed_10m,wind_speed_80m,wind_speed_120m,wind_direction_10m,wind_gusts_10m,precipitation_probability,precipitation,visibility,temperature_2m,weather_code'
try {
  const r = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LNG}&hourly=${HOURLY}&wind_speed_unit=ms&forecast_days=1&timezone=GMT`,
    { headers: { origin: ORIGIN }, signal: AbortSignal.timeout(30000) },
  )
  const j = await r.json()
  const keys = Object.keys(j.hourly ?? {})
  const missing = HOURLY.split(',').filter((k) => !keys.includes(k))
  line(`HTTP ${r.status}；CORS=${r.headers.get('access-control-allow-origin') ?? '（沒有）'}；缺的欄位：${missing.length ? missing.join('、') : '沒有'}`)
  line(`單位：${JSON.stringify(j.hourly_units ?? {})}`)
  line(`第一筆：${keys.map((k) => `${k}=${j.hourly[k]?.[0]}`).join(' ')}`)
} catch (e) {
  line(`❌ ${errCode(e)}`)
}

line()
line('== 4. NOAA SWPC 地磁 Kp ==')
for (const u of [
  'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json',
  'https://services.swpc.noaa.gov/json/planetary_k_index_1m.json',
]) {
  try {
    const r = await fetch(u, { headers: { origin: ORIGIN }, signal: AbortSignal.timeout(30000) })
    const j = await r.json()
    const rows = Array.isArray(j) ? j : []
    line(`✅ ${u.split('/').pop()}：HTTP ${r.status}；CORS=${r.headers.get('access-control-allow-origin') ?? '（沒有）'}；${rows.length} 筆`)
    line(`  開頭：${JSON.stringify(rows.slice(0, 2))}`)
    line(`  最後：${JSON.stringify(rows.slice(-2))}`)
  } catch (e) {
    line(`❌ ${u.split('/').pop()}：${errCode(e)}`)
  }
}
