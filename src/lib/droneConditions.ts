// ── 無人機飛行條件：高空風、降雨、能見度、地磁 Kp、附近低空有人機 ─────────────
//
// 天氣用 Open-Meteo（免金鑰、有 CORS，App 其他圖層也用它）：10／80／120 公尺的風，
// 無人機飛 120 公尺（400 呎）時，上面的風常比地面大很多，只看地面風會誤判。
// 地磁 Kp 用 NOAA SWPC（美國政府公開資料、有 CORS）：磁暴時 GPS 定位與羅盤可能不準。
// 低空有人機用 App 既有的 ADS-B（adsb.lol 經本站 Worker）：直升機、海巡機常在 3000 呎以下。
//
// 門檻是一般小型多旋翼的參考值，抗風上限讓使用者依機型選；畫面都會寫「以機型規格為準」。

export type CondLevel = 'ok' | 'caution' | 'no'

const LEVEL_RANK: Record<CondLevel, number> = { ok: 0, caution: 1, no: 2 }
export const worse = (a: CondLevel, b: CondLevel): CondLevel => (LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b)

// ── 天氣（Open-Meteo）──────────────────────────────────────────────

export interface DroneHour {
  /** 這一小時的開始（毫秒，UTC）。 */
  t: number
  wind10: number
  wind80: number
  wind120: number
  /** 風的來向（度）。 */
  dir10: number
  /** 10 公尺陣風（m/s）。 */
  gust: number
  /** 降雨機率（%）；沒有就 null。 */
  pop: number | null
  /** 降雨量（mm/h）。 */
  precip: number
  /** 能見度（公尺）；沒有就 null。 */
  vis: number | null
  /** 氣溫（°C）。 */
  temp: number
}

const HOURLY = [
  'wind_speed_10m',
  'wind_speed_80m',
  'wind_speed_120m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'precipitation_probability',
  'precipitation',
  'visibility',
  'temperature_2m',
] as const

export function droneWeatherUrl(lat: number, lng: number): string {
  return (
    `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lng.toFixed(3)}` +
    `&hourly=${HOURLY.join(',')}&wind_speed_unit=ms&forecast_days=2&timezone=GMT`
  )
}

/** 解析 Open-Meteo；從「現在這一小時」開始取 hours 筆。格式不對回 null。 */
export function parseDroneWeather(j: unknown, nowMs: number, hours = 6): DroneHour[] | null {
  const h = (j as { hourly?: Record<string, unknown[]> } | null)?.hourly
  if (!h || !Array.isArray(h.time)) return null
  const col = (k: string) => (Array.isArray(h[k]) ? (h[k] as unknown[]) : [])
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const out: DroneHour[] = []
  const hourStart = nowMs - (nowMs % 3600_000)
  for (let i = 0; i < h.time.length && out.length < hours; i++) {
    const tStr = String(h.time[i])
    const t = Date.parse(/Z|[+-]\d\d:?\d\d$/.test(tStr) ? tStr : `${tStr}Z`)
    if (!Number.isFinite(t) || t < hourStart) continue
    const w10 = num(col('wind_speed_10m')[i])
    const temp = num(col('temperature_2m')[i])
    if (w10 === null || temp === null) continue
    out.push({
      t,
      wind10: w10,
      wind80: num(col('wind_speed_80m')[i]) ?? w10,
      wind120: num(col('wind_speed_120m')[i]) ?? num(col('wind_speed_80m')[i]) ?? w10,
      dir10: num(col('wind_direction_10m')[i]) ?? 0,
      gust: num(col('wind_gusts_10m')[i]) ?? w10,
      pop: num(col('precipitation_probability')[i]),
      precip: num(col('precipitation')[i]) ?? 0,
      vis: num(col('visibility')[i]),
      temp,
    })
  }
  return out.length ? out : null
}

/** 抗風上限的選項（m/s）：小型（Mini 等級）、一般（Mavic 等級）、工業級。 */
export const WIND_LIMITS = [10, 12, 15] as const
export type WindLimit = (typeof WIND_LIMITS)[number]

export interface HourAssessment {
  level: CondLevel
  reasons: string[]
}

/** 一小時的天氣能不能飛：風（取 10／80／120 公尺最大）、陣風、降雨、能見度、氣溫。 */
export function assessHour(h: DroneHour, windLimit: number = 12): HourAssessment {
  const reasons: string[] = []
  let level: CondLevel = 'ok'
  const add = (l: CondLevel, why: string) => {
    level = worse(level, l)
    reasons.push(why)
  }
  const top = Math.max(h.wind10, h.wind80, h.wind120)
  const at = top === h.wind120 ? '120 公尺' : top === h.wind80 ? '80 公尺' : '地面'
  if (top >= windLimit) add('no', `${at}風 ${top.toFixed(1)} m/s，超過抗風上限 ${windLimit} m/s`)
  else if (top >= windLimit * 0.7) add('caution', `${at}風 ${top.toFixed(1)} m/s，接近抗風上限`)
  if (h.gust >= windLimit * 1.25) add('no', `陣風 ${h.gust.toFixed(1)} m/s`)
  else if (h.gust >= windLimit * 0.85) add('caution', `陣風 ${h.gust.toFixed(1)} m/s`)
  if (h.precip >= 0.5) add('no', `降雨 ${h.precip.toFixed(1)} mm/h`)
  else if ((h.pop ?? 0) >= 50) add('caution', `降雨機率 ${h.pop}%`)
  if (h.vis !== null) {
    if (h.vis < 1000) add('no', `能見度 ${(h.vis / 1000).toFixed(1)} 公里，難以目視`)
    else if (h.vis < 3000) add('caution', `能見度 ${(h.vis / 1000).toFixed(1)} 公里`)
  }
  if (h.temp <= 0) add('caution', `氣溫 ${h.temp.toFixed(0)}°C，電池續航會變短`)
  else if (h.temp >= 40) add('caution', `氣溫 ${h.temp.toFixed(0)}°C，注意過熱`)
  return { level, reasons }
}

export class CondError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CondError'
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export async function fetchDroneWeather(
  lat: number,
  lng: number,
  opts: { fetchImpl?: FetchLike; signal?: AbortSignal; now?: number } = {},
): Promise<DroneHour[]> {
  const doFetch = opts.fetchImpl ?? ((u: string, i?: RequestInit) => fetch(u, i))
  let res: Response
  try {
    res = await doFetch(droneWeatherUrl(lat, lng), { signal: opts.signal })
  } catch (e) {
    if (opts.signal?.aborted) throw e
    throw new CondError('天氣連不上（Open-Meteo），稍後再試')
  }
  if (!res.ok) throw new CondError(`天氣伺服器回 ${res.status}（Open-Meteo），稍後再試`)
  const hours = parseDroneWeather(await res.json().catch(() => null), opts.now ?? Date.now())
  if (!hours) throw new CondError('天氣資料格式不對（Open-Meteo 可能改版）')
  return hours
}

// ── 地磁 Kp（NOAA SWPC）───────────────────────────────────────────

export const KP_URL = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json'

export interface KpPoint {
  /** 3 小時區間的開始（毫秒，UTC）。 */
  t: number
  kp: number
  kind: 'observed' | 'estimated' | 'predicted'
}

/** 解析 NOAA 的 Kp 預報：新版是物件陣列，舊版是「第一列標題＋陣列」，兩種都吃。 */
export function parseKp(j: unknown): KpPoint[] | null {
  if (!Array.isArray(j)) return null
  const out: KpPoint[] = []
  const toMs = (s: unknown) => {
    const str = String(s ?? '').replace(' ', 'T')
    return Date.parse(/Z|[+-]\d\d:?\d\d$/.test(str) ? str : `${str}Z`)
  }
  for (const row of j) {
    let t: number
    let kp: number
    let kind: string
    if (Array.isArray(row)) {
      if (row[0] === 'time_tag') continue
      t = toMs(row[0])
      kp = Number(row[1])
      kind = String(row[2] ?? '')
    } else if (row && typeof row === 'object') {
      const r = row as Record<string, unknown>
      t = toMs(r.time_tag)
      kp = Number(r.kp)
      kind = String(r.observed ?? '')
    } else continue
    if (!Number.isFinite(t) || !Number.isFinite(kp)) continue
    out.push({ t, kp, kind: kind === 'observed' ? 'observed' : kind === 'estimated' ? 'estimated' : 'predicted' })
  }
  out.sort((a, b) => a.t - b.t)
  return out.length ? out : null
}

/** Kp：4 以下正常；4 注意；5 以上是磁暴（NOAA G1 起），GPS 與羅盤可能不準。 */
export function kpLevel(kp: number): CondLevel {
  if (kp >= 5) return 'no'
  if (kp >= 4) return 'caution'
  return 'ok'
}

export interface KpSummary {
  /** 現在這個 3 小時區間。 */
  now: KpPoint | null
  /** 接下來 24 小時的最大值。 */
  max24: number | null
}

export function kpSummary(points: KpPoint[], nowMs: number): KpSummary {
  let now: KpPoint | null = null
  for (const p of points) if (p.t <= nowMs) now = p
  const next = points.filter((p) => p.t > nowMs - 3 * 3600_000 && p.t <= nowMs + 24 * 3600_000).map((p) => p.kp)
  return { now, max24: next.length ? Math.max(...next) : null }
}

export async function fetchKp(opts: { fetchImpl?: FetchLike; signal?: AbortSignal } = {}): Promise<KpPoint[]> {
  const doFetch = opts.fetchImpl ?? ((u: string, i?: RequestInit) => fetch(u, i))
  let res: Response
  try {
    res = await doFetch(KP_URL, { signal: opts.signal })
  } catch (e) {
    if (opts.signal?.aborted) throw e
    throw new CondError('地磁 Kp 連不上（NOAA），稍後再試')
  }
  if (!res.ok) throw new CondError(`地磁 Kp 伺服器回 ${res.status}（NOAA），稍後再試`)
  const pts = parseKp(await res.json().catch(() => null))
  if (!pts) throw new CondError('地磁 Kp 資料格式不對（NOAA 可能改版）')
  return pts
}

// ── 附近低空有人機（ADS-B）─────────────────────────────────────────

export interface LowTraffic {
  name: string
  altFt: number | null
  distNm: number
  /** 真方位（度）：從使用者看過去。 */
  bearing: number
  heli: boolean
  emergency: boolean
}

export const TRAFFIC_RADIUS_NM = 5
export const TRAFFIC_MAX_ALT_FT = 3000

function gc(lat1: number, lng1: number, lat2: number, lng2: number): { nm: number; brg: number } {
  const r = Math.PI / 180
  const dLat = (lat2 - lat1) * r
  const dLng = (lng2 - lng1) * r
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2
  const nm = (2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(a)))) / 1.852
  const y = Math.sin(dLng) * Math.cos(lat2 * r)
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos(dLng)
  return { nm, brg: ((Math.atan2(y, x) / r) % 360 + 360) % 360 }
}

/**
 * 5 浬內、3000 呎以下（或高度不明）的有人機，近的在前。
 * 在地面的不算（停機坪上的不會撞到）；高度不明的算進來（寧可多提醒）。
 */
export function lowTraffic(
  aircraft: { lat: number; lng: number; altFt: number | null; onGround: boolean; name: string; heli: boolean; emergency: boolean }[],
  lat: number,
  lng: number,
): LowTraffic[] {
  return aircraft
    .filter((a) => !a.onGround && (a.altFt === null || a.altFt <= TRAFFIC_MAX_ALT_FT))
    .map((a) => {
      const g = gc(lat, lng, a.lat, a.lng)
      return { name: a.name, altFt: a.altFt, distNm: g.nm, bearing: g.brg, heli: a.heli, emergency: a.emergency }
    })
    .filter((x) => x.distNm <= TRAFFIC_RADIUS_NM)
    .sort((a, b) => a.distNm - b.distNm)
}

export function trafficLevel(list: LowTraffic[]): CondLevel {
  if (list.some((x) => x.distNm <= 2)) return 'no'
  return list.length ? 'caution' : 'ok'
}

// ── 法規時段：日出到日落 ─────────────────────────────────────────

export interface DaylightWindow {
  level: CondLevel
  text: string
}

/**
 * 民用航空法第 99 條之 14 第 1 項第 6 款：不得於日落後至日出前之時間飛航。
 * 日落前 30 分鐘提醒收機（降落、回收也要時間）。
 */
export function daylightWindow(nowMs: number, sunrise: Date | null, sunset: Date | null): DaylightWindow {
  const hm = (d: Date) => {
    const t = new Date(d.getTime() + 8 * 3600_000)
    return `${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`
  }
  if (!sunrise || !sunset) return { level: 'caution', text: '算不出日出日落（極區或時間不對），請自行確認' }
  const span = `可飛時段 ${hm(sunrise)}–${hm(sunset)}`
  if (nowMs < sunrise.getTime()) return { level: 'no', text: `還沒日出（${span}）` }
  if (nowMs >= sunset.getTime()) return { level: 'no', text: `已經日落（${span}；夜間要另外申請）` }
  const left = Math.round((sunset.getTime() - nowMs) / 60_000)
  const leftText = left >= 60 ? `${Math.floor(left / 60)} 小時 ${left % 60} 分` : `${left} 分`
  if (left <= 30) return { level: 'caution', text: `離日落只剩 ${leftText}，準備收機（${span}）` }
  return { level: 'ok', text: `離日落還有 ${leftText}（${span}）` }
}

export const COND_DOT: Record<CondLevel, string> = { ok: '🟢', caution: '🟡', no: '🔴' }

// ── 偏好：抗風上限（只存本機）────────────────────────────────────

const WIND_KEY = 'argus.drone.windLimit.v1'

export function loadWindLimit(): WindLimit {
  try {
    const v = Number(localStorage.getItem(WIND_KEY))
    return (WIND_LIMITS as readonly number[]).includes(v) ? (v as WindLimit) : 12
  } catch {
    return 12
  }
}

export function persistWindLimit(v: WindLimit) {
  try {
    localStorage.setItem(WIND_KEY, String(v))
  } catch {
    /* 存不了（私密瀏覽）就只在這次有效 */
  }
}
