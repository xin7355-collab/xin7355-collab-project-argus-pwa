// ── 國際太空站（ISS）即時星下點 ────────────────────────────
//
// 「星下點」＝衛星正下方的地表那一點。這不是可見性預報，也不是過境預報
// （那個在 overpass.ts）；是「它現在正飛在哪裡」。
//
// 為什麼不自己算軌道：真正算要 TLE + SGP4，TLE 每天都在變、要另外抓，
// 而且 SGP4 是一大包程式。直接抓一個現成的即時位置端點，簡單太多。
//
// ── 誠實標註 ───────────────────────────────────────────────
// 「這兩個端點存在」是事實（事實不受著作權保護），底下的程式全部是自己寫的。
//
// 重要：這兩個主機在本專案的開發沙箱被網路政策擋住（CONNECT 403），
// 所以「線上實際回傳的 JSON 長什麼樣」沒有驗到。因此解析刻意寫得很寬容，
// 兩種已知格式都收；兩個都解不出來時，錯誤訊息會直接把回傳 JSON 的最上層
// 欄位名列出來，萬一格式跟預期不同，在手機上就看得到實際欄位名。
// 解析函式本身有單元測試（issTrack.test.ts）。

/** 主端點：有高度、速度、日照狀態。 */
const ISS_PRIMARY = 'https://api.wheretheiss.at/v1/satellites/25544'
/** 備援端點：只有經緯度，沒有高度/速度。 */
const ISS_FALLBACK = 'https://api.open-notify.org/iss-now.json'

/** ISS 的標稱軌道高度（km），備援端點沒給高度時用它估可見範圍。 */
export const ISS_NOMINAL_ALT_KM = 420

const EARTH_R_KM = 6371
/** 地球重力常數 μ（km³/s²）。由高度推算軌道週期用。 */
const MU_KM3_S2 = 398600.4418

/**
 * ISS 軌道傾角（度）。這個值非常穩定（太空站會維持軌位），
 * 而即時位置 API 不回傳傾角，所以寫在這裡當常數。
 * 它決定軌跡的「形狀」（最北/最南到哪），位置則由即時星下點決定。
 */
export const ISS_INCLINATION_DEG = 51.64

/**
 * 由高度推算圓軌道週期（分鐘）：T = 2π√(r³/μ)。
 * 420km 約 92.8 分鐘，跟公開資料相符。
 * 用算的而不是寫死，軌道因大氣阻力衰減時才會跟著變。
 */
export function orbitPeriodMin(altKm: number | null): number {
  const h = altKm && altKm > 0 ? altKm : ISS_NOMINAL_ALT_KM
  const r = EARTH_R_KM + h
  return (2 * Math.PI * Math.sqrt((r * r * r) / MU_KM3_S2)) / 60
}

export interface IssFix {
  lat: number
  lng: number
  /** 高度（km）。備援端點沒有這項時為 null。 */
  altKm: number | null
  /** 對地速度（km/h）。沒有時為 null。 */
  speedKmh: number | null
  /** 'daylight' / 'eclipsed' 之類；沒有時為 null。 */
  visibility: string | null
  /** 這筆資料的時間（毫秒）。 */
  at: number
  /** 來源標示，顯示在 popup 上，出問題時才知道是哪一邊的資料。 */
  source: string
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : null
}

/**
 * 寬容解析：兩種已知格式都收。
 *   A（wheretheiss）：{ latitude, longitude, altitude, velocity, visibility, timestamp }
 *   B（open-notify）：{ iss_position: { latitude, longitude }, timestamp }（數值是字串）
 * 解不出合理的經緯度就回 null，由呼叫端決定要不要換端點。
 */
export function parseIssFix(json: unknown, source: string): IssFix | null {
  if (!json || typeof json !== 'object') return null
  const o = json as Record<string, unknown>
  const pos =
    o.iss_position && typeof o.iss_position === 'object'
      ? (o.iss_position as Record<string, unknown>)
      : o

  const lat = num(pos.latitude ?? pos.lat)
  const lng = num(pos.longitude ?? pos.lon ?? pos.lng)
  if (lat === null || lng === null) return null
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null

  // timestamp 是 Unix 秒；缺了就用本機時間，總比整筆丟掉好。
  const ts = num(o.timestamp)
  const at = ts !== null && ts > 1e9 && ts < 1e11 ? ts * 1000 : Date.now()

  const altKm = num(o.altitude)
  const speedKmh = num(o.velocity)
  return {
    lat,
    lng,
    altKm: altKm !== null && altKm > 0 ? altKm : null,
    speedKmh: speedKmh !== null && speedKmh > 0 ? speedKmh : null,
    visibility: typeof o.visibility === 'string' ? o.visibility : null,
    at,
    source,
  }
}

/**
 * 可見地平圈半徑（km）：站在星下點附近，要離多遠以內才可能看到它。
 * 地心角 acos(R/(R+h)) 乘以地球半徑。420km 約 2250km。
 */
export function issFootprintKm(altKm: number | null): number {
  const h = altKm && altKm > 0 ? altKm : ISS_NOMINAL_ALT_KM
  return EARTH_R_KM * Math.acos(EARTH_R_KM / (EARTH_R_KM + h))
}

/**
 * 這個距離（km）在不在 ISS 的可見地平圈內。
 *
 * 距離與方位本身用專案既有的 windRadar.distanceKm()／bearingDeg() 算，
 * 不在這裡重寫。這個模組刻意保持「零 import」，才能直接丟給 Node 跑單元測試
 * （Node 的 ESM 要求副檔名，而專案其他地方的 import 都是不帶副檔名的）。
 */
export function isOverhead(km: number, altKm: number | null): boolean {
  return km <= issFootprintKm(altKm)
}

async function getJson(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' })
    if (!res.ok) throw new Error(`ISS 位置服務 ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timeout)
  }
}

/** 回傳 JSON 的最上層欄位名，格式跟預期不同時用來自我診斷。 */
function topKeys(json: unknown): string {
  if (!json || typeof json !== 'object') return typeof json
  return Object.keys(json as Record<string, unknown>).slice(0, 8).join(', ') || '(空物件)'
}

/**
 * 抓一次 ISS 現在的星下點。主端點失敗就換備援端點。
 * 兩邊都抓不到 → 丟出中文錯誤；格式看不懂 → 錯誤訊息帶上實際欄位名。
 */
export async function fetchIssFix(timeoutMs = 8000): Promise<IssFix> {
  const errs: string[] = []
  for (const [url, label] of [
    [ISS_PRIMARY, 'wheretheiss.at'],
    [ISS_FALLBACK, 'open-notify.org'],
  ] as const) {
    let json: unknown
    try {
      json = await getJson(url, timeoutMs)
    } catch (e) {
      errs.push(`${label}：${e instanceof Error ? e.message : '連線失敗'}`)
      continue
    }
    const fix = parseIssFix(json, label)
    if (fix) return fix
    errs.push(`${label}：回傳格式看不懂（欄位：${topKeys(json)}）`)
  }
  throw new Error(`取不到 ISS 位置 — ${errs.join('；')}`)
}
