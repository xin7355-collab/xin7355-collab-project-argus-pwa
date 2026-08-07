// ── 逐時歷史/預報海象 + 時變漂流積分 ────────────────────────
//
// 針對「漁民在過去某時刻回報座標，現在船已漂走」的實戰情境：
// 抓該點「回報時間 → 現在 → 未來」的逐時風場與洋流，讓漂流積分每一小時
// 都用『當下真實的』海流與風，而不是用單一即時快照外推（那太粗糙）。
//
// 資料：Open-Meteo（免金鑰）。forecast API 的 past_days 可取近幾日歷史，
// forecast_days 取未來。空間上以回報點單點時間序列近似（手機端折衷；
// 真實 SAROPS 用時空皆變的場，這裡是可用的簡化）。

import { climatologyCurrent } from './marineEnv'

const WEATHER = 'https://api.open-meteo.com/v1/forecast'
const MARINE = 'https://marine-api.open-meteo.com/v1/marine'
const DEG = Math.PI / 180
const R = 6371000
const HOUR = 3600_000

export interface HourlySeries {
  times: number[] // 每小時的 epoch ms
  windSpeed: number[] // m/s
  windDir: number[] // 來向 deg
  currentSpeed: number[] // m/s
  currentDir: number[] // 流向(toward) deg
  live: boolean
}

function toEpoch(iso: string): number {
  // Open-Meteo 回傳 "YYYY-MM-DDTHH:mm"（當地無時區標記時視為 UTC 較穩）
  return Date.parse(iso.length <= 16 ? iso + ':00Z' : iso)
}

/** 抓某點的逐時風+洋流序列（涵蓋過去 pastDays 到未來 forecastDays）。 */
export async function fetchHourlySeries(
  lat: number,
  lng: number,
  pastDays = 5,
  forecastDays = 3,
): Promise<HourlySeries> {
  const ctrl = new AbortController()
  const timeout = setTimeout(() => ctrl.abort(), 10000)
  const q = `&past_days=${pastDays}&forecast_days=${forecastDays}`
  try {
    const wUrl = `${WEATHER}?latitude=${lat}&longitude=${lng}&hourly=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms${q}`
    const mUrl = `${MARINE}?latitude=${lat}&longitude=${lng}&hourly=ocean_current_velocity,ocean_current_direction${q}`
    const [w, m] = await Promise.all([
      fetch(wUrl, { signal: ctrl.signal }).then((r) => r.json()),
      fetch(mUrl, { signal: ctrl.signal }).then((r) => r.json()),
    ])
    const times: number[] = (w?.hourly?.time ?? []).map(toEpoch)
    const mTimes: number[] = (m?.hourly?.time ?? []).map(toEpoch)
    // 以天氣時間為主軸，洋流用最接近的索引對齊
    const idxAt = (t: number) => {
      let best = 0
      let bd = Infinity
      for (let i = 0; i < mTimes.length; i++) {
        const d = Math.abs(mTimes[i] - t)
        if (d < bd) {
          bd = d
          best = i
        }
      }
      return best
    }
    const curV = m?.hourly?.ocean_current_velocity ?? []
    const curD = m?.hourly?.ocean_current_direction ?? []
    const windSpeed: number[] = []
    const windDir: number[] = []
    const currentSpeed: number[] = []
    const currentDir: number[] = []
    for (let i = 0; i < times.length; i++) {
      windSpeed.push(numOr(w.hourly.wind_speed_10m?.[i], 5))
      windDir.push(numOr(w.hourly.wind_direction_10m?.[i], 225))
      const j = idxAt(times[i])
      currentSpeed.push(numOr(curV[j], 1.08) / 3.6) // km/h → m/s
      currentDir.push(numOr(curD[j], 20))
    }
    if (times.length === 0) throw new Error('empty series')
    return { times, windSpeed, windDir, currentSpeed, currentDir, live: true }
  } catch {
    // fallback：用黑潮氣候平均（隨落海點位置而異），比固定 0.3/20 有意義。
    const now = nowEpoch()
    const times: number[] = []
    const a = (v: number) => Array(200).fill(v)
    for (let i = -120; i < 80; i++) times.push(now + i * HOUR)
    const c = climatologyCurrent(lat, lng)
    return {
      times,
      windSpeed: a(6),
      windDir: a(225),
      currentSpeed: a(c.speed),
      currentDir: a(c.dir),
      live: false,
    }
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * 一次抓「整個網格」的逐時序列（時間動畫用）。Open-Meteo 支援 comma 多座標，
 * 一次請求拿回所有點的 hourly。回傳與 points 對齊的序列陣列。
 */
export async function fetchHourlySeriesGrid(
  points: [number, number][],
  pastDays = 2,
  forecastDays = 3,
): Promise<HourlySeries[]> {
  if (points.length === 0) return []
  const ctrl = new AbortController()
  const timeout = setTimeout(() => ctrl.abort(), 12000)
  const lats = points.map((p) => p[0].toFixed(3)).join(',')
  const lngs = points.map((p) => p[1].toFixed(3)).join(',')
  const q = `&past_days=${pastDays}&forecast_days=${forecastDays}`
  try {
    const wUrl = `${WEATHER}?latitude=${lats}&longitude=${lngs}&hourly=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms${q}`
    const mUrl = `${MARINE}?latitude=${lats}&longitude=${lngs}&hourly=ocean_current_velocity,ocean_current_direction${q}`
    const [w, m] = await Promise.all([
      fetch(wUrl, { signal: ctrl.signal }).then((r) => r.json()),
      fetch(mUrl, { signal: ctrl.signal }).then((r) => r.json()),
    ])
    const wArr = Array.isArray(w) ? w : [w]
    const mArr = Array.isArray(m) ? m : [m]
    return points.map((_, i) => {
      const wh = wArr[i]?.hourly
      const mh = mArr[i]?.hourly
      const times: number[] = (wh?.time ?? []).map(toEpoch)
      return {
        times,
        windSpeed: (wh?.wind_speed_10m ?? []).map((v: number) => numOr(v, 5)),
        windDir: (wh?.wind_direction_10m ?? []).map((v: number) => numOr(v, 225)),
        currentSpeed: (mh?.ocean_current_velocity ?? times.map(() => 1.08)).map(
          (v: number) => numOr(v, 1.08) / 3.6,
        ),
        currentDir: (mh?.ocean_current_direction ?? times.map(() => 20)).map((v: number) =>
          numOr(v, 20),
        ),
        live: times.length > 0,
      } as HourlySeries
    })
  } catch {
    return points.map(() => ({
      times: [],
      windSpeed: [],
      windDir: [],
      currentSpeed: [],
      currentDir: [],
      live: false,
    }))
  } finally {
    clearTimeout(timeout)
  }
}

function nowEpoch(): number {
  return Date.now()
}
export { fieldAt }
function numOr(v: unknown, d: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : d
}
function toEN(speed: number, dirDeg: number) {
  const r = dirDeg * DEG
  return { e: speed * Math.sin(r), n: speed * Math.cos(r) }
}
function offset(lat: number, lng: number, dE: number, dN: number) {
  return { lat: lat + (dN / R) / DEG, lng: lng + (dE / (R * Math.cos(lat * DEG))) / DEG }
}
/** 取序列中最接近某 epoch 的一小時場。 */
function fieldAt(s: HourlySeries, epoch: number) {
  let best = 0
  let bd = Infinity
  for (let i = 0; i < s.times.length; i++) {
    const d = Math.abs(s.times[i] - epoch)
    if (d < bd) {
      bd = d
      best = i
    }
  }
  return {
    windSpeed: s.windSpeed[best],
    windDir: s.windDir[best],
    currentSpeed: s.currentSpeed[best],
    currentDir: s.currentDir[best],
  }
}

export interface TVPoint {
  hours: number
  lat: number
  lng: number
  driftMeters: number
  radiusMeters: number
  bearingDeg: number
}

/**
 * 時變漂流積分：從 baseEpoch 起，逐時用當下真實場推進。
 * forward：從回報點/時間往後漂 hoursList 小時。
 * reverse：從發現點(現在)往前回溯 hoursList 小時（位移相反、時間往回）。
 */
export function integrateDriftSeries(
  startLat: number,
  startLng: number,
  series: HourlySeries,
  baseEpoch: number,
  hoursList: number[],
  leeway: number,
  reverse: boolean,
  divergenceDeg = 0,
  /**
   * 可選的「空間洋流場」：依目前所在位置回傳洋流(speed m/s, dir toward deg)。
   * 提供時，每一步用『當下位置』的洋流（會隨黑潮等空間變化轉折→軌跡彎曲，不再假直線）。
   */
  spatialCurrent?: (lat: number, lng: number) => { speed: number; dir: number },
): TVPoint[] {
  const maxH = Math.max(...hoursList)
  let lat = startLat
  let lng = startLng
  const out: TVPoint[] = []
  const want = new Set(hoursList)
  for (let h = 1; h <= maxH; h++) {
    // 本小時所用的場：forward 用 [baseEpoch + (h-1)h]，reverse 用 [baseEpoch - h*h]
    const epoch = reverse ? baseEpoch - h * HOUR : baseEpoch + (h - 1) * HOUR
    const f = fieldAt(series, epoch)
    const windToward = (f.windDir + 180 + divergenceDeg + 360) % 360
    const w = toEN(f.windSpeed * leeway, windToward)
    const cur = spatialCurrent ? spatialCurrent(lat, lng) : { speed: f.currentSpeed, dir: f.currentDir }
    const c = toEN(cur.speed, cur.dir)
    let vE = c.e + w.e
    let vN = c.n + w.n
    if (reverse) {
      vE = -vE
      vN = -vN
    }
    const dE = vE * 3600
    const dN = vN * 3600
    const p = offset(lat, lng, dE, dN)
    lat = p.lat
    lng = p.lng
    if (want.has(h)) {
      const ddN = (lat - startLat) * DEG * R
      const ddE = (lng - startLng) * DEG * R * Math.cos(startLat * DEG)
      const driftMeters = Math.hypot(ddE, ddN)
      const bearingDeg = (Math.atan2(ddE, ddN) / DEG + 360) % 360
      out.push({
        hours: h,
        lat,
        lng,
        driftMeters,
        radiusMeters: 500 + driftMeters * 0.25,
        bearingDeg,
      })
    }
  }
  return out
}

/** 時變版蒙地卡羅：每顆粒子擾動起點/偏航/風壓差，並逐時積分。 */
export function monteCarloSeries(opts: {
  lat: number
  lng: number
  series: HourlySeries
  baseEpoch: number
  hours: number
  leeway: number
  reverse: boolean
  n?: number
  posSigmaM?: number
  spatialCurrent?: (lat: number, lng: number) => { speed: number; dir: number }
}) {
  const n = opts.n ?? 600
  const posSigma = opts.posSigmaM ?? 400
  const endLat = new Float64Array(n)
  const endLng = new Float64Array(n)
  const gauss = () => {
    let u = 0
    let v = 0
    while (u === 0) u = Math.random()
    while (v === 0) v = Math.random()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
  for (let i = 0; i < n; i++) {
    const s0 = offset(opts.lat, opts.lng, gauss() * posSigma, gauss() * posSigma)
    const leewayP = Math.max(0, opts.leeway * (1 + gauss() * 0.3))
    const div = gauss() * 25
    const pts = integrateDriftSeries(
      s0.lat,
      s0.lng,
      opts.series,
      opts.baseEpoch,
      [opts.hours],
      leewayP,
      opts.reverse,
      div,
      opts.spatialCurrent,
    )
    const e = pts[0]
    endLat[i] = e ? e.lat : s0.lat
    endLng[i] = e ? e.lng : s0.lng
  }
  // 質心 + 95% 半徑 + 密度格
  let sLat = 0
  let sLng = 0
  for (let i = 0; i < n; i++) {
    sLat += endLat[i]
    sLng += endLng[i]
  }
  const centroid = { lat: sLat / n, lng: sLng / n }
  const dists = Array.from({ length: n }, (_, i) => {
    const dN = (endLat[i] - centroid.lat) * DEG * R
    const dE = (endLng[i] - centroid.lng) * DEG * R * Math.cos(centroid.lat * DEG)
    return Math.hypot(dE, dN)
  }).sort((a, b) => a - b)
  const radius95 = dists[Math.floor(n * 0.95)] || 0
  let minLat = Infinity
  let maxLat = -Infinity
  let minLng = Infinity
  let maxLng = -Infinity
  for (let i = 0; i < n; i++) {
    if (endLat[i] < minLat) minLat = endLat[i]
    if (endLat[i] > maxLat) maxLat = endLat[i]
    if (endLng[i] < minLng) minLng = endLng[i]
    if (endLng[i] > maxLng) maxLng = endLng[i]
  }
  const G = 24
  const dLat = (maxLat - minLat) / G || 1e-6
  const dLng = (maxLng - minLng) / G || 1e-6
  const counts = new Int32Array(G * G)
  for (let i = 0; i < n; i++) {
    let r = Math.floor((endLat[i] - minLat) / dLat)
    let c = Math.floor((endLng[i] - minLng) / dLng)
    if (r >= G) r = G - 1
    if (c >= G) c = G - 1
    counts[r * G + c]++
  }
  let maxCount = 0
  let peakIdx = -1
  const cells = [] as { south: number; west: number; north: number; east: number; count: number }[]
  for (let r = 0; r < G; r++)
    for (let c = 0; c < G; c++) {
      const cnt = counts[r * G + c]
      if (!cnt) continue
      if (cnt > maxCount) {
        maxCount = cnt
        peakIdx = r * G + c
      }
      const south = minLat + r * dLat
      const west = minLng + c * dLng
      cells.push({ south, west, north: south + dLat, east: west + dLng, count: cnt })
    }
  const peak =
    peakIdx >= 0
      ? { lat: minLat + (Math.floor(peakIdx / G) + 0.5) * dLat, lng: minLng + ((peakIdx % G) + 0.5) * dLng }
      : null
  return { cells, maxCount, peak, radius95, centroid }
}
