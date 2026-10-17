import { eciToGeodetic, gstime, propagate, twoline2satrec, degreesLat, degreesLong } from 'satellite.js'
import type { TrackPoint } from './groundTrack'
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
  let satrec
  try {
    satrec = twoline2satrec(rec.line1, rec.line2)
  } catch {
    return null
  }
  // satellite.js 解析失敗時不丟錯，而是把 error 設成非 0。不檢查的話
  // 後面會拿到一堆 NaN，在地圖上變成看不出哪裡錯的破線。
  if (!satrec || (satrec as { error?: number }).error) return null

  const points: TrackPoint[] = []
  const step = Math.max(1, stepS) * 1000
  for (let t = fromMs; t <= toMs; t += step) {
    const d = new Date(t)
    let pv
    try {
      pv = propagate(satrec, d)
    } catch {
      continue
    }
    const eci = pv && typeof pv === 'object' ? (pv as { position?: unknown }).position : null
    if (!eci || typeof eci !== 'object') continue
    const geo = eciToGeodetic(eci as never, gstime(d))
    const lat = degreesLat(geo.latitude)
    const lng = degreesLong(geo.longitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    points.push({ lat, lng, at: t })
  }
  if (points.length < 2) return null

  return {
    name: rec.name,
    noradId: rec.noradId,
    points,
    epochMs: tleEpochMs(rec.line1) ?? fromMs,
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
