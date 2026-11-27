// 無人機禁限航區資料同步（GitHub Actions 每天跑，見 .github/workflows/drone-zones.yml）
//
// 用法（要加 --experimental-strip-types，因為共用 src/lib/droneZones.ts）：
//   node --experimental-strip-types scripts/drone-zones.mjs build --out <資料夾>
//        [--previous <上一版 index.json>] [--source auto|caa|mirror|files] [--files <放 GeoJSON 的資料夾>]
//   node --experimental-strip-types scripts/drone-zones.mjs selftest     # 離線自我測試
//
// 來源（auto）：先直連民航局 GIS；連不到、憑證驗不過、或筆數對不上，就整批改用 GitHub 上的
// 每日鏡像（TonyPepeBear/taiwan-drone-caa-data：從台灣網路每天同步同一批圖層，發在 Releases）。
// 兩個都失敗就失敗，不交出空資料；某層筆數比上一版少三成以上也當失敗（多半是抓到一半）。
//
// 民航局這台伺服器的憑證鏈可能不完整（缺中繼憑證）。參考的開源專案是直接關掉 TLS 驗證，
// 這裡不關：照憑證上的 AIA 網址把中繼憑證抓回來補上，仍然完整驗證到受信任的根憑證。
//
// 輸出：<out>/index.json（版本、來源、筆數、有資料的格子）與 <out>/tiles/<格子>.json、tiles/wide.json。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import tls from 'node:tls'
import https from 'node:https'
import http from 'node:http'
import zlib from 'node:zlib'
import crypto from 'node:crypto'
import {
  CELL_DEG,
  checkPoint,
  coarsenZone,
  decodeZone,
  encodeZone,
  isOverviewZone,
  normalizeAirspace,
  normalizePark,
  normalizePort,
  tileZones,
} from '../src/lib/droneZones.ts'

const CAA_BASE = process.env.CAA_BASE || 'https://dronegis.caa.gov.tw/server/rest/services'
const MIRROR = process.env.DRONE_MIRROR || 'https://github.com/TonyPepeBear/taiwan-drone-caa-data/releases/latest/download'
const UA = 'drone-zone-sync/1.0'

export const LAYERS = [
  { slug: 'uav_restricted_airspace', service: 'Hosted/UAV_fs/FeatureServer/3', kind: 'airspace', min: 1000 },
  { slug: 'temporary_area', service: 'Hosted/Temporary_Area/FeatureServer/19', kind: 'temporary', min: 0 },
  { slug: 'commercial_port', service: 'Hosted/Commercial_Port_fs/FeatureServer/4', kind: 'port', min: 5 },
  { slug: 'national_park', service: 'Hosted/National_Park_fs/FeatureServer/0', kind: 'park', min: 5 },
]
const PAGE = 1000
/**
 * 直連民航局的時間預算：實測整批約 50 秒。超過 5 分鐘就放棄、改用鏡像。
 * 沒有這個上限時，對方卡住（每次等 120 秒、每頁重試 4 次）會拖過工作流的 15 分鐘上限，
 * 連改用鏡像的機會都沒有。
 */
const CAA_BUDGET_MS = Number(process.env.CAA_BUDGET_MS) || 5 * 60_000
/** 某層比上一版少這麼多就當作抓到一半（上一版至少 20 筆才比）。 */
const MAX_DROP = 0.3

const log = (s = '') => console.log(s)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const errCode = (e) => e?.cause?.code || e?.code || e?.message || String(e)

// ── 連線：照常驗證；缺中繼憑證時照 AIA 補上 ─────────────────────────────

let extraCa = null
/** 直連民航局的截止時間（毫秒）；0＝不限（鏡像、AIA 不受這個限制）。 */
let caaDeadline = 0
const CERT_ERRORS = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'SELF_SIGNED_CERT_IN_CHAIN',
])

function request(url, { ca = null, accept = 'application/json', maxMs = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const mod = u.protocol === 'https:' ? https : http
    const opts = { headers: { 'user-agent': UA, accept }, timeout: 120_000 }
    if (ca) opts.ca = [...tls.rootCertificates, ...ca]
    let hard
    const req = mod.get(u, opts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        clearTimeout(hard)
        resolve(request(new URL(res.headers.location, u).toString(), { ca, accept, maxMs }))
        return
      }
      const parts = []
      res.on('data', (d) => parts.push(d))
      res.on('end', () => {
        clearTimeout(hard)
        resolve({ status: res.statusCode, body: Buffer.concat(parts) })
      })
    })
    // timeout 只管「多久沒收到東西」；對方一點一點慢慢送時要靠這個總時限
    if (maxMs > 0) hard = setTimeout(() => req.destroy(Object.assign(new Error('超過時間預算'), { code: 'BUDGET' })), maxMs)
    req.on('error', (e) => {
      clearTimeout(hard)
      reject(e)
    })
    req.on('timeout', () => req.destroy(Object.assign(new Error('逾時'), { code: 'TIMEOUT' })))
  })
}

/** 讀伺服器憑證上的 AIA（發證者憑證網址）。只讀憑證、不送資料，所以這一步不驗證。 */
function leafAia(host) {
  return new Promise((resolve) => {
    const sock = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false, timeout: 20_000 }, () => {
      const c = sock.getPeerCertificate(false)
      sock.end()
      resolve(c?.infoAccess?.['CA Issuers - URI']?.[0] ?? null)
    })
    sock.on('error', () => resolve(null))
    sock.on('timeout', () => {
      sock.destroy()
      resolve(null)
    })
  })
}

async function fetchIssuerCert(host) {
  const aia = await leafAia(host)
  if (!aia) throw new Error('憑證驗不過，而且憑證上沒有 AIA 網址可以補中繼憑證')
  const r = await request(aia, { accept: '*/*' })
  if (r.status !== 200) throw new Error(`中繼憑證抓不到（HTTP ${r.status}）`)
  const text = r.body.toString('utf8')
  const pem = text.includes('BEGIN CERTIFICATE')
    ? text
    : `-----BEGIN CERTIFICATE-----\n${r.body.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`
  const x = new crypto.X509Certificate(pem) // 格式不對會丟錯
  log(`  補上中繼憑證：${x.subject.split('\n').find((l) => l.startsWith('CN=')) ?? x.subject}（${x.fingerprint256.slice(0, 23)}…）`)
  return [pem]
}

async function getJson(url) {
  let last
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await sleep(2 ** attempt * 1000)
    const left = caaDeadline ? caaDeadline - Date.now() : 0
    if (caaDeadline && left <= 0) throw Object.assign(new Error(`直連民航局超過 ${CAA_BUDGET_MS / 60_000} 分鐘的時間預算`), { code: 'BUDGET' })
    try {
      const r = await request(url, { ca: extraCa, maxMs: left })
      if (r.status !== 200) throw Object.assign(new Error(`HTTP ${r.status}`), { code: `HTTP_${r.status}` })
      const j = JSON.parse(r.body.toString('utf8'))
      if (j && j.error) throw new Error(`ArcGIS 錯誤：${JSON.stringify(j.error).slice(0, 200)}`)
      return j
    } catch (e) {
      last = e
      if (CERT_ERRORS.has(e.code) && !extraCa) {
        extraCa = await fetchIssuerCert(new URL(url).hostname)
        attempt-- // 補好憑證重試不算一次
        continue
      }
      if (CERT_ERRORS.has(e.code) || e.code === 'BUDGET') break // 補了還是驗不過、時間用完：不要硬試
    }
  }
  throw last
}

// ── 來源 ────────────────────────────────────────────────────────────

async function fetchCaaLayer(layer) {
  const q = `${CAA_BASE}/${layer.service}/query`
  const { count } = await getJson(`${q}?where=1%3D1&returnCountOnly=true&f=json`)
  if (!Number.isInteger(count)) throw new Error(`${layer.slug} 的筆數回傳格式不對`)
  const features = []
  for (let offset = 0; offset < count; offset += PAGE) {
    const params = new URLSearchParams({
      where: '1=1',
      outFields: '*',
      returnGeometry: 'true',
      outSR: '4326',
      orderByFields: 'objectid',
      resultOffset: String(offset),
      resultRecordCount: String(PAGE),
      f: 'geojson',
    })
    const page = await getJson(`${q}?${params}`)
    if (page.type !== 'FeatureCollection' || !Array.isArray(page.features)) throw new Error(`${layer.slug} 回傳的不是 GeoJSON`)
    if (!page.features.length) break
    features.push(...page.features)
  }
  if (features.length !== count) throw new Error(`${layer.slug} 抓到 ${features.length} 筆，但伺服器說有 ${count} 筆`)
  return features
}

async function fetchMirror() {
  const m = await getJson(`${MIRROR}/manifest.json`)
  const out = {}
  for (const layer of LAYERS) {
    const meta = m.layers?.find((l) => l.slug === layer.slug)
    let last
    for (let attempt = 0; attempt < 4 && !out[layer.slug]; attempt++) {
      if (attempt) await sleep(2 ** attempt * 1000)
      try {
        const r = await request(`${MIRROR}/${layer.slug}.geojson.gz`, { accept: '*/*' })
        if (r.status !== 200) throw new Error(`HTTP ${r.status}`)
        const fc = JSON.parse(zlib.gunzipSync(r.body).toString('utf8'))
        if (!Array.isArray(fc.features)) throw new Error('不是 GeoJSON')
        if (meta && meta.feature_count !== fc.features.length) throw new Error(`筆數 ${fc.features.length} 跟總表的 ${meta.feature_count} 不一樣`)
        out[layer.slug] = fc.features
      } catch (e) {
        last = e
      }
    }
    if (!out[layer.slug]) throw new Error(`鏡像的 ${layer.slug} 抓不到：${errCode(last)}`)
  }
  return { collections: out, tag: m.tag, fetchedAt: m.generated_at }
}

function loadFiles(dir) {
  const out = {}
  for (const layer of LAYERS) {
    const plain = path.join(dir, `${layer.slug}.geojson`)
    const gz = `${plain}.gz`
    const raw = fs.existsSync(plain) ? fs.readFileSync(plain) : fs.existsSync(gz) ? zlib.gunzipSync(fs.readFileSync(gz)) : null
    if (!raw) throw new Error(`${dir} 裡沒有 ${layer.slug}.geojson(.gz)`)
    out[layer.slug] = JSON.parse(raw.toString('utf8')).features
  }
  return out
}

// ── 整理成圖磚 ───────────────────────────────────────────────────────

const NORMALIZE = {
  airspace: (f) => normalizeAirspace(f, 'airspace'),
  temporary: (f) => normalizeAirspace(f, 'temporary'),
  port: normalizePort,
  park: normalizePark,
}

/** 原始圖層 → { index, files: Map<相對路徑, 內容字串> }。同樣的輸入一定得到同樣的版本號。 */
export function buildFromCollections(collections, source, { minCheck = true } = {}) {
  const zones = []
  const counts = { airspace: 0, temporary: 0, port: 0, park: 0, no: 0, limit: 0, notice: 0, skipped: 0 }
  for (const layer of LAYERS) {
    const feats = collections[layer.slug] ?? []
    if (minCheck && feats.length < layer.min) throw new Error(`${layer.slug} 只有 ${feats.length} 筆（至少要 ${layer.min} 筆），不像完整資料`)
    for (const f of feats) {
      const z = NORMALIZE[layer.kind](f)
      if (!z) {
        counts.skipped++
        continue
      }
      zones.push(z)
      counts[layer.kind]++
      counts[z.level]++
    }
  }
  zones.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const { tiles, wide } = tileZones(zones)
  const files = new Map()
  const cells = [...tiles.keys()].sort()
  for (const cell of cells) files.set(`tiles/${cell}.json`, JSON.stringify({ v: 1, cell, zones: tiles.get(cell).map(encodeZone) }))
  files.set('tiles/wide.json', JSON.stringify({ v: 1, cell: 'wide', zones: wide.map(encodeZone) }))
  const overview = zones.filter(isOverviewZone).map((z) => encodeZone(coarsenZone(z)))
  files.set('tiles/overview.json', JSON.stringify({ v: 1, cell: 'overview', zones: overview }))
  const h = crypto.createHash('sha256')
  for (const [k, v] of [...files.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) h.update(k).update('\0').update(v).update('\0')
  const index = {
    v: 1,
    version: h.digest('hex').slice(0, 16),
    generatedAt: new Date().toISOString(),
    source,
    counts,
    cellDeg: CELL_DEG,
    cells,
    wide: wide.length,
    overview: overview.length,
  }
  return { index, files }
}

/** 跟上一版比：某層少三成以上當失敗。回錯誤訊息（沒問題回 null）。 */
export function compareWithPrevious(index, prev) {
  if (!prev || !prev.counts) return null
  for (const k of ['airspace', 'port', 'park']) {
    const before = prev.counts[k] ?? 0
    const now = index.counts[k] ?? 0
    if (before >= 20 && now < before * (1 - MAX_DROP)) return `${k} 從上一版的 ${before} 筆掉到 ${now} 筆，可能抓到一半，這次先不更新`
  }
  return null
}

function writeOutput(out, built) {
  fs.mkdirSync(out, { recursive: true })
  fs.rmSync(path.join(out, 'tiles'), { recursive: true, force: true })
  fs.mkdirSync(path.join(out, 'tiles'), { recursive: true })
  for (const [rel, text] of built.files) fs.writeFileSync(path.join(out, rel), text)
  fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify(built.index))
}

function summary(built) {
  const sizes = [...built.files.entries()].map(([k, v]) => [k, Buffer.byteLength(v)])
  const total = sizes.reduce((a, [, n]) => a + n, 0)
  const big = sizes.sort((a, b) => b[1] - a[1])[0]
  const c = built.index.counts
  log(`版本 ${built.index.version}；來源 ${built.index.source.kind}${built.index.source.tag ? `（${built.index.source.tag}）` : ''}`)
  log(`筆數：主空域 ${c.airspace}、臨時 ${c.temporary}、商港 ${c.port}、國家公園 ${c.park}；紅區 ${c.no}、黃區 ${c.limit}、另有規定 ${c.notice}；幾何不成形略過 ${c.skipped}`)
  log(`圖磚 ${built.index.cells.length} 格＋wide ${built.index.wide} 筆＋總覽 ${built.index.overview} 筆；合計 ${(total / 1e6).toFixed(2)} MB；最大一格 ${big[0]} ${(big[1] / 1e3).toFixed(0)} KB`)
}

// ── 指令 ────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) out[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true
    else out._.push(a)
  }
  return out
}

async function build(args) {
  if (!args.out) throw new Error('要給 --out <資料夾>')
  const mode = args.source || 'auto'
  let collections
  let source
  if (mode === 'files') {
    collections = loadFiles(args.files || '.')
    source = { kind: 'mirror', tag: args.tag || 'local-files', fetchedAt: new Date().toISOString() }
  } else {
    let caaError = null
    if (mode === 'auto' || mode === 'caa') {
      try {
        log('直連民航局 GIS…')
        caaDeadline = Date.now() + CAA_BUDGET_MS
        collections = {}
        for (const layer of LAYERS) {
          collections[layer.slug] = await fetchCaaLayer(layer)
          log(`  ${layer.slug}：${collections[layer.slug].length} 筆`)
        }
        source = { kind: 'caa', fetchedAt: new Date().toISOString() }
        caaDeadline = 0
      } catch (e) {
        caaDeadline = 0
        caaError = e?.code === 'BUDGET' ? e.message : errCode(e)
        collections = null
        log(`  民航局直連失敗：${caaError}`)
        if (mode === 'caa') throw new Error(`民航局 GIS 抓不到：${caaError}`)
      }
    }
    if (!collections) {
      log('改用 GitHub 每日鏡像…')
      try {
        const m = await fetchMirror()
        collections = m.collections
        source = { kind: 'mirror', tag: m.tag, fetchedAt: m.fetchedAt }
        log(`  鏡像 ${m.tag}`)
      } catch (e) {
        throw new Error(`兩個來源都失敗。民航局：${caaError ?? '沒試'}；鏡像：${errCode(e)}`)
      }
    }
  }
  const built = buildFromCollections(collections, source)
  if (args.previous && fs.existsSync(args.previous)) {
    const prev = JSON.parse(fs.readFileSync(args.previous, 'utf8'))
    const why = compareWithPrevious(built.index, prev)
    if (why) throw new Error(why)
    log(`上一版 ${prev.version}，這版 ${built.index.version}${prev.version === built.index.version ? '（沒變）' : '（有變）'}`)
  }
  writeOutput(args.out, built)
  summary(built)
}

/** 離線自我測試：小份假資料走完整條流程（正規化 → 切格 → 寫檔 → 讀回 → 判定）。 */
async function selftest() {
  let fail = 0
  const ok = (name, pass, detail = '') => {
    if (!pass) fail++
    log(`${pass ? '✅' : '❌'} ${name}${detail ? `：${detail}` : ''}`)
  }
  const sq = (lat, lng, half) => {
    const dLat = half / 110_574
    const dLng = half / (111_320 * Math.cos((lat * Math.PI) / 180))
    return [[[lng - dLng, lat - dLat], [lng + dLng, lat - dLat], [lng + dLng, lat + dLat], [lng - dLng, lat + dLat], [lng - dLng, lat - dLat]]]
  }
  const poly = (coordinates) => ({ type: 'Polygon', coordinates })
  const air = (oid, props, geometry) => ({ properties: { objectid: oid, 空域類型: 7, 罰則: '罰款3萬-15萬', ...props }, geometry })
  const fixture = {
    uav_restricted_airspace: [
      air(1, { 空域類別名稱: '機場四周禁止施放範圍', 空域類型: 4, 條件: '禁止', 空域名稱: '桃園機場禁止施放範圍', 聯絡方式: '電話：03-0000000' }, poly(sq(25.0777, 121.2328, 2500))),
      air(2, { 空域類別名稱: '機場四周距地面或水面200呎以上禁止施放範圍', 空域類型: 5, 條件: '限制', 空域名稱: '桃園機場200呎以上禁止施放範圍' }, poly(sq(25.0777, 121.2328, 8000))),
      air(3, { 空域類別名稱: '縣市政府限制使用範圍', 條件: '禁止', 空域名稱: '北1 測試', 有效日期起: '114/12/24', 有效日期迄: '999/12/31', 聯絡方式: '承辦窗口：王小明\n電子郵件：a@b.gov.tw\n電話：0912345678' }, poly(sq(25.04, 121.51, 300))),
      air(4, { 空域名稱: '壞掉的幾何' }, { type: 'Point', coordinates: [121, 25] }),
      air(5, { 空域類別名稱: '飛航情報限航區範圍', 空域類型: 6, 條件: '禁止', 空域名稱: '南沙群島' }, poly([[[114, 10], [117, 10], [117, 12.5], [114, 12.5], [114, 10]]])),
    ],
    temporary_area: [air(101, { 條件: '禁止', 空域名稱: '跨年煙火', 有效日期起: '115/12/31', 有效日期迄: '115/12/31' }, poly(sq(25.06, 121.47, 500)))],
    commercial_port: [
      {
        properties: { objectid: 2, 名稱: '商港-基隆港2禁止飛行區域', 條件: '禁止', 說明: '禁止飛行區域', 管理_及會商_機關聯絡方式: '電子郵件：t@port.tw', 有效日期起: '1769904000000', 有效日期迄: '29694988800000' },
        geometry: poly(sq(25.15, 121.745, 400)),
      },
    ],
    national_park: [{ properties: { objectid: 1, name_full: '陽明山國家公園', 相關規: 'https://www.ymsnp.gov.tw/' }, geometry: poly(sq(25.17, 121.56, 6000)) }],
  }
  const src = { kind: 'fixture', fetchedAt: '2026-11-27T00:00:00Z' }
  const a = buildFromCollections(fixture, src, { minCheck: false })
  const b = buildFromCollections(fixture, src, { minCheck: false })
  ok('同樣輸入 → 同樣版本號', a.index.version === b.index.version, a.index.version)
  const c = a.index.counts
  ok('筆數：主空域 4（1 筆壞幾何略過）、臨時 1、商港 1、國家公園 1', c.airspace === 4 && c.skipped === 1 && c.temporary === 1 && c.port === 1 && c.park === 1, JSON.stringify(c))
  ok('跨很多格的（南沙）放 wide', a.index.wide === 1)
  ok('總覽：機場、限航區、商港、國家公園、臨時公告都在，縣市公告不放', a.index.overview === 6, `${a.index.overview} 筆`)
  let threw = ''
  try {
    buildFromCollections(fixture, src)
  } catch (e) {
    threw = e.message
  }
  ok('筆數太少（不像完整資料）→ 失敗，不交出', /至少要 1000 筆/.test(threw), threw)
  ok('比上一版少三成以上 → 失敗', /可能抓到一半/.test(compareWithPrevious({ counts: { airspace: 600 } }, { counts: { airspace: 1000 } }) ?? ''))
  ok('比上一版少一點 → 照常', compareWithPrevious({ counts: { airspace: 990 } }, { counts: { airspace: 1000 } }) === null)

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-selftest-'))
  try {
    writeOutput(dir, a)
    const idx = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'))
    const all = fs.readdirSync(path.join(dir, 'tiles')).map((f) => fs.readFileSync(path.join(dir, 'tiles', f), 'utf8'))
    ok('每個格子都有檔案', idx.cells.every((cell) => fs.existsSync(path.join(dir, 'tiles', `${cell}.json`))), `${idx.cells.length} 格`)
    ok('輸出不含聯絡方式（姓名、電話、Email）', all.every((t) => !t.includes('@') && !t.includes('0912345678') && !t.includes('王小明') && !t.includes('03-0000000')))
    const zones = all.flatMap((t) => JSON.parse(t).zones.map(decodeZone))
    const at = (lat, lng, when = '2026-11-27T04:00:00Z') => checkPoint(lat, lng, zones, Date.parse(when))
    const apt = at(25.0777, 121.2328)
    ok('桃園機場跑道上 → 禁止', apt.verdict === 'no' && apt.inside[0].name === '桃園機場禁止施放範圍')
    const outer = at(25.0777 + 5000 / 110_574, 121.2328)
    ok('機場 5 公里外、8 公里內 → 有條件、200 呎以上禁止', outer.verdict === 'limit' && outer.ceilingFt === 200)
    ok('外海 → 不在公告範圍內', at(24.5, 122.3).verdict === 'clear')
    ok('跨年煙火：今天還沒生效、12/31 當天禁止', at(25.06, 121.47).verdict !== 'no' && at(25.06, 121.47, '2026-12-31T04:00:00Z').verdict === 'no')
    ok('基隆港禁止區 → 禁止', at(25.15, 121.745).verdict === 'no')
    ok('陽明山 → 另有規定', at(25.17, 121.56).verdict === 'notice')
    ok('南沙（wide）→ 禁止', at(11, 115).verdict === 'no')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
  log(fail ? `❌ ${fail} 項失敗` : '✅ 自我測試全過')
  return fail ? 1 : 0
}

const args = parseArgs(process.argv.slice(2))
const cmd = args._[0]
if (cmd === 'selftest') process.exit(await selftest())
else if (cmd === 'build') {
  try {
    await build(args)
  } catch (e) {
    console.error(`::error::無人機禁限航區資料沒有更新：${e.message}`)
    process.exit(1)
  }
} else if (import.meta.url === `file://${process.argv[1]}`) {
  console.error('用法：build --out <資料夾> [--previous <index.json>] [--source auto|caa|mirror|files] [--files <資料夾>]，或 selftest')
  process.exit(2)
}
