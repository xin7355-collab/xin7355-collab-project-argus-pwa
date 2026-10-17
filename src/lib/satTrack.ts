import { eciToGeodetic, gstime, propagate, twoline2satrec, degreesLat, degreesLong } from 'satellite.js'
import { findPasses, type PassWindow, type TrackPoint } from './groundTrack.ts'
import { distanceKm } from './windRadar.ts'
import type { TleRecord } from './tle'

// ── 由 TLE 推算真實地面軌跡（SGP4）────────────────────────
//
// 這取代了先前的「圓軌道近似」。差別在哪：
//
//   圓軌道近似需要一個「已知時刻的真實星下點」當錨點。ISS 有免金鑰的即時位置
//   來源所以畫得出來，Sentinel/MODIS 沒有，於是先前一律不畫——與其畫一條
//   看起來專業但位置是猜的線，不如不畫。
//
//   SGP4 從軌道根數（TLE）直接算，不需要錨點。TLE 由自家 Worker 代抓
//   （celestrak 沒送 CORS 標頭，瀏覽器直連會被擋），所以現在每顆都畫得出來。
//
// 誠實標註：SGP4 本身是業界標準，但準確度取決於 TLE 的新鮮度。
// TLE 通常一天更新幾次；離 epoch 越遠誤差越大，推算好幾天以後不要當真。
// 這個模組會把 TLE 的 epoch 一併回傳，讓 UI 能告訴使用者「這份根數多舊」。

export interface SatTrack {
  name: string
  noradId: string
  points: TrackPoint[]
  /** 這份 TLE 的 epoch（毫秒）。離現在越遠，推算越不可信。 */
  epochMs: number
}

/** 從 TLE 的 epoch 欄位（年 + 一年中的第幾天）取毫秒時間。 */
export function tleEpochMs(line1: string): number | null {
  // 欄位位置由 TLE 格式規定：第 19-20 碼是兩位年份，21-32 碼是日序（含小數）
  const yy = Number(line1.slice(18, 20))
  const doy = Number(line1.slice(20, 32))
  if (!Number.isFinite(yy) || !Number.isFinite(doy) || doy <= 0) return null
  // 兩位年份：57-99 視為 19xx，00-56 視為 20xx（NORAD 的慣例）
  const year = yy < 57 ? 2000 + yy : 1900 + yy
  const jan1 = Date.UTC(year, 0, 1)
  return jan1 + (doy - 1) * 86400000
}

type SubPointFn = (tMs: number) => { lat: number; lng: number } | null

/**
 * 把一組 TLE 變成「給時刻算星下點」的函式。
 *
 * 單獨抽出來是因為掃過境要反覆、不等距地取樣（先粗後細），
 * 先產一整條等距軌跡再篩選會白算幾十倍的點。
 */
function subPointFn(rec: TleRecord): SubPointFn | null {
  let satrec
  try {
    satrec = twoline2satrec(rec.line1, rec.line2)
  } catch {
    return null
  }
  // satellite.js 解析失敗時不丟錯，而是把 error 設成非 0。不檢查的話
  // 後面會拿到一堆 NaN，在地圖上變成看不出哪裡錯的破線。
  if (!satrec || (satrec as { error?: number }).error) return null

  return (tMs: number) => {
    const d = new Date(tMs)
    let pv
    try {
      pv = propagate(satrec, d)
    } catch {
      return null
    }
    const eci = pv && typeof pv === 'object' ? (pv as { position?: unknown }).position : null
    if (!eci || typeof eci !== 'object') return null
    const geo = eciToGeodetic(eci as never, gstime(d))
    const lat = degreesLat(geo.latitude)
    const lng = degreesLong(geo.longitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    return { lat, lng }
  }
}

/**
 * 推算一段地面軌跡。
 *
 * 回傳 null 代表這組 TLE 算不出東西（根數壞掉、或衛星已經脫軌墜落）——
 * 這種時候要讓呼叫端知道「沒有資料」，不是給它一條空線假裝有算。
 */
export function trackFromTle(
  rec: TleRecord,
  fromMs: number,
  toMs: number,
  stepS = 20,
): SatTrack | null {
  const sub = subPointFn(rec)
  if (!sub) return null

  const points: TrackPoint[] = []
  const step = Math.max(1, stepS) * 1000
  for (let t = fromMs; t <= toMs; t += step) {
    const g = sub(t)
    if (g) points.push({ lat: g.lat, lng: g.lng, at: t })
  }
  if (points.length < 2) return null

  return {
    name: rec.name,
    noradId: rec.noradId,
    points,
    epochMs: tleEpochMs(rec.line1) ?? fromMs,
  }
}

// ── 「這一趟會不會掃到我這片海」──────────────────────────
//
// 取樣間隔的兩難：低軌衛星對地約 7 km/s，Sentinel-1 的掃幅只有 250 km
// （半寬 125 km），整個通過只有約 35 秒。用 60 秒間隔掃一整天很便宜，
// 但會整趟漏掉；用 5 秒間隔不會漏，可是一天要算 17280 個點，
// 乘上十幾顆衛星在手機上會卡住。
//
// 所以先粗後細：60 秒掃一遍找出「可能接近」的時段（判斷門檻放寬成
// 半寬 + 一個粗間隔走過的距離，確保不會跳過），再只對那幾段用細間隔重算。

/** 低軌衛星的地面速度上限（km/s），用來算粗掃要放寬多少才不會漏。 */
const MAX_GROUND_SPEED_KM_S = 7.9

export interface SatPasses {
  name: string
  noradId: string
  epochMs: number
  passes: PassWindow[]
}

/**
 * 找出這顆衛星在 [fromMs, toMs] 內掃幅涵蓋到 (lat, lng) 的所有時段。
 *
 * 回傳 null 代表這組 TLE 算不出東西（根數壞掉或已脫軌）——要跟
 * 「算得出來但沒有過境」分開，否則使用者會把「壞掉」讀成「這陣子沒有」。
 */
export function passesForPoint(
  rec: TleRecord,
  lat: number,
  lng: number,
  swathKm: number,
  fromMs: number,
  toMs: number,
  opt: { coarseS?: number; fineS?: number } = {},
): SatPasses | null {
  const sub = subPointFn(rec)
  if (!sub) return null

  const coarseS = Math.max(1, opt.coarseS ?? 60)
  const fineS = Math.max(1, opt.fineS ?? 4)
  const half = swathKm / 2
  const slack = half + MAX_GROUND_SPEED_KM_S * coarseS

  // 粗掃：記下所有「可能接近」的時刻
  const candidates: number[] = []
  const coarseMs = coarseS * 1000
  let got = 0
  for (let t = fromMs; t <= toMs; t += coarseMs) {
    const g = sub(t)
    if (!g) continue
    got++
    if (distanceKm(lat, lng, g.lat, g.lng) <= slack) candidates.push(t)
  }
  if (got < 2) return null

  // 把相鄰的候選時刻併成區間，各往外擴一個粗間隔（進出的那一刻在格子之間）
  const spans: { a: number; b: number }[] = []
  for (const t of candidates) {
    const last = spans[spans.length - 1]
    if (last && t - last.b <= coarseMs) last.b = t
    else spans.push({ a: t, b: t })
  }

  const passes: PassWindow[] = []
  const fineMs = fineS * 1000
  for (const sp of spans) {
    const a = Math.max(fromMs, sp.a - coarseMs)
    const b = Math.min(toMs, sp.b + coarseMs)
    const pts: TrackPoint[] = []
    for (let t = a; t <= b; t += fineMs) {
      const g = sub(t)
      if (g) pts.push({ lat: g.lat, lng: g.lng, at: t })
    }
    passes.push(...findPasses(pts, swathKm, lat, lng))
  }

  passes.sort((x, y) => x.startMs - y.startMs)
  return {
    name: rec.name,
    noradId: rec.noradId,
    epochMs: tleEpochMs(rec.line1) ?? fromMs,
    passes,
  }
}

/** TLE 有多舊，講成人話。太舊要讓使用者知道，不能默默用。 */
export function tleAgeText(epochMs: number, nowMs: number): { text: string; stale: boolean } {
  const days = (nowMs - epochMs) / 86400000
  if (days < 0) return { text: '根數時間在未來（可能有誤）', stale: true }
  if (days < 1) return { text: `軌道根數 ${Math.max(1, Math.round(days * 24))} 小時前更新`, stale: false }
  const d = Math.round(days)
  // 超過一週的 TLE，SGP4 的誤差會明顯累積，不該讓人當成精準預報。
  return { text: `軌道根數 ${d} 天前更新`, stale: d > 7 }
}
