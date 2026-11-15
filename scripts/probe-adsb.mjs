// adsb.lol 探測（手動觸發，見 .github/workflows/adsb-probe.yml）。
// 沙箱連不到 adsb.lol，App 的飛機與 GPS 干擾功能只用假資料驗過；這支從 GitHub 伺服器實際打一次，
// 確認真實回應的欄位、時間格式，以及部署後的 Worker 轉手是否正常。
// 位置只用公開地標（桃園國際機場）。紀錄只印數量與欄位名稱，不印任何一架飛機的識別資料
// （公開 repo 的 Actions 紀錄是公開的）。
import { ADSB_KEEP_FIELDS, normalizeAircraft, snapshotMs, trimAdsb } from '../src/lib/adsb.ts'
import { normalizeGnssAircraft } from '../src/lib/gnssIntegrity.ts'

const LAT = 25.08 // 桃園國際機場（公開地標）
const LON = 121.23
const DIST = 50
const WORKER = process.env.WORKER_URL || 'https://argus-app.xin7355.workers.dev'
let failed = false

const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(1)} KB`
const tally = (arr, f) => {
  const m = {}
  for (const a of arr) {
    const k = String(f(a))
    m[k] = (m[k] ?? 0) + 1
  }
  return JSON.stringify(m)
}

async function direct() {
  console.log(`== 直連 adsb.lol（${LAT}, ${LON}，${DIST} 浬）==`)
  const t0 = Date.now()
  let res
  try {
    res = await fetch(`https://api.adsb.lol/v2/lat/${LAT}/lon/${LON}/dist/${DIST}`, {
      headers: { accept: 'application/json', 'user-agent': 'argus-pwa probe (GitHub Actions)' },
      signal: AbortSignal.timeout(15000),
    })
  } catch (e) {
    console.log(`連不上：${e.name}`)
    failed = true
    return
  }
  const text = await res.text()
  console.log(`HTTP ${res.status}，${Date.now() - t0} ms，${res.headers.get('content-type')}，大小 ${kb(text)}`)
  console.log(`CORS 標頭：${res.headers.get('access-control-allow-origin') ?? '（沒有）'}`)
  let j
  try {
    j = JSON.parse(text)
  } catch {
    console.log('不是 JSON')
    failed = true
    return
  }
  console.log(`頂層欄位：${Object.keys(j).join(', ')}`)
  const ms = snapshotMs(j.now)
  console.log(`now=${typeof j.now} ${j.now > 1e10 ? '（毫秒）' : '（秒）'}，比 GitHub 時鐘差 ${ms ? Math.round((Date.now() - ms) / 1000) : '?'} 秒`)
  const ac = Array.isArray(j.ac) ? j.ac : []
  console.log(`飛機數：${ac.length}`)
  for (const f of ADSB_KEEP_FIELDS) console.log(`  欄位 ${f.padEnd(12)} 有 ${ac.filter((a) => a[f] !== undefined).length} 架`)
  console.log(`  type 分布：${tally(ac, (a) => a.type)}`)
  console.log(`  version 分布：${tally(ac, (a) => a.version)}`)
  console.log(`  alt_baro 是 "ground"：${ac.filter((a) => a.alt_baro === 'ground').length} 架`)
  const others = new Set()
  for (const a of ac) for (const k of Object.keys(a)) if (!ADSB_KEEP_FIELDS.includes(k)) others.add(k)
  console.log(`  沒轉給 App 的欄位：${[...others].sort().join(', ')}`)
  const trimmed = JSON.stringify(trimAdsb(j))
  console.log(`精簡後大小 ${kb(trimmed)}（原本 ${kb(text)}）`)
  const planes = normalizeAircraft(j) ?? []
  const rows = normalizeGnssAircraft(j) ?? []
  console.log(`App 會畫 ${planes.length} 架（緊急 ${planes.filter((p) => p.emergency || ['7500', '7600', '7700'].includes(p.squawk)).length}、軍機 ${planes.filter((p) => p.military).length}、直升機 ${planes.filter((p) => p.category === 'A7').length}）`)
  console.log(`GPS 干擾判定可用 ${rows.length} 架，其中精度差 ${rows.filter((r) => r.degraded).length} 架`)
}

async function viaWorker() {
  console.log(`\n== 經部署的 Worker（${WORKER}/api/adsb）==`)
  for (const round of [1, 2]) {
    const t0 = Date.now()
    let res
    try {
      res = await fetch(`${WORKER}/api/adsb?lat=${LAT}&lon=${LON}&dist=${DIST}`, { signal: AbortSignal.timeout(20000) })
    } catch (e) {
      console.log(`第 ${round} 次連不上：${e.name}`)
      failed = true
      return
    }
    const text = await res.text()
    const h = (k) => res.headers.get(k) ?? '—'
    console.log(`第 ${round} 次：HTTP ${res.status}，${Date.now() - t0} ms，大小 ${kb(text)}，x-adsb-age=${h('x-adsb-age')}，x-adsb-stale=${h('x-adsb-stale')}，cache-control=${h('cache-control')}`)
    if (!res.ok) {
      console.log(`  錯誤訊息：${text.slice(0, 200)}`)
      failed = true
      continue
    }
    const j = JSON.parse(text)
    const keys = new Set()
    for (const a of j.ac ?? []) for (const k of Object.keys(a)) keys.add(k)
    console.log(`  飛機數 ${j.ac?.length ?? 0}，欄位：${[...keys].sort().join(', ')}`)
  }
  // 別的網站來源要被擋
  const evil = await fetch(`${WORKER}/api/adsb?lat=${LAT}&lon=${LON}&dist=${DIST}`, { headers: { origin: 'https://evil.example' } })
  console.log(`別的網站來源：HTTP ${evil.status}（應 403）`)
  if (evil.status !== 403) failed = true
}

await direct()
await viaWorker()
process.exit(failed ? 1 : 0)
