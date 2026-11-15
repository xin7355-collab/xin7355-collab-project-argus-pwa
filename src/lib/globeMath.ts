// ── 3D 地球用的換算（純函式，可離線測）──────────────────────────
//
// 2D 地圖用縮放層級（zoom），3D 用鏡頭高度（公尺）：切換時要換算，
// 開 3D 才會停在剛剛 2D 看的那片海、回 2D 也一樣。
// 衛星位置：satellite.js 算出 ECI（慣性座標），轉成 ECEF（跟著地球轉的座標）
// 就是 Cesium 的 Cartesian3，公尺為單位，可以直接畫在真實高度上。

import { eciToEcf, gstime, propagate, twoline2satrec } from 'satellite.js'

/** Web Mercator 在赤道、zoom 0 時每像素幾公尺。 */
const MPP_Z0 = 156_543.033_92
/** Cesium 預設垂直視角 60°：看到的地面高度 ≈ 2 × 高度 × tan(30°)。 */
const VIEW_SPAN_PER_HEIGHT = 2 * Math.tan(Math.PI / 6)

/** 2D 縮放層級 → 3D 鏡頭高度（公尺），讓兩邊看到差不多大的範圍。viewportPx 是畫面高度。 */
export function heightForZoom(zoom: number, lat: number, viewportPx = 800): number {
  const mpp = (MPP_Z0 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom
  return (mpp * viewportPx) / VIEW_SPAN_PER_HEIGHT
}

/** 3D 鏡頭高度 → 2D 縮放層級（夾在 2～18）。 */
export function zoomForHeight(height: number, lat: number, viewportPx = 800): number {
  const mpp = (height * VIEW_SPAN_PER_HEIGHT) / viewportPx
  const z = Math.log2((MPP_Z0 * Math.cos((lat * Math.PI) / 180)) / Math.max(mpp, 1e-6))
  return Math.min(18, Math.max(2, z))
}

/** 鏡頭在這個高度大概看得到多遠（浬），拿來決定要抓多大範圍的飛機。 */
export function viewRadiusNm(height: number): number {
  return (height * VIEW_SPAN_PER_HEIGHT * 0.8) / 1852
}

export type SatRec = ReturnType<typeof twoline2satrec>

/**
 * 解析 TLE；壞掉回 null。satellite.js 遇到亂碼不一定會丟錯或設 error
 * （實測 v7 吃 "garbage" 也回一個 error=0 的物件），所以另外檢查平均運動要是正數。
 */
export function satrecOf(line1: string, line2: string): SatRec | null {
  try {
    const s = twoline2satrec(line1, line2)
    const no = (s as { no?: number } | null)?.no
    return s && !(s as { error?: number }).error && typeof no === 'number' && Number.isFinite(no) && no > 0 ? s : null
  } catch {
    return null
  }
}

/** 某個時刻衛星在 ECEF 的位置（公尺）。算不出來（根數過期太久、已墜落）回 null。 */
export function satEcefMeters(satrec: SatRec, at: Date): [number, number, number] | null {
  let pv
  try {
    pv = propagate(satrec, at)
  } catch {
    return null
  }
  const eci = pv && typeof pv === 'object' ? (pv as { position?: unknown }).position : null
  if (!eci || typeof eci !== 'object') return null
  const ecf = eciToEcf(eci as never, gstime(at))
  const p: [number, number, number] = [ecf.x * 1000, ecf.y * 1000, ecf.z * 1000]
  return p.every(Number.isFinite) ? p : null
}

/** 離地心的距離換成大約的高度（公里，用平均半徑 6371）。 */
export function altitudeKm(p: readonly [number, number, number]): number {
  return Math.hypot(p[0], p[1], p[2]) / 1000 - 6371
}

/** 繞一圈要幾分鐘（satrec.no 是每分鐘幾弧度）。 */
export function periodMin(satrec: SatRec): number {
  const no = (satrec as { no?: number }).no
  return typeof no === 'number' && no > 0 ? (2 * Math.PI) / no : NaN
}

/**
 * 接下來一圈的路徑（ECEF，公尺）。地球同時在轉，所以畫出來不是封閉的圓，
 * 而是「接下來這一圈會經過地球上空哪裡」——對看「待會掃不掃得到這片海」比較有用。
 */
export function nextOrbitEcef(satrec: SatRec, fromMs: number, steps = 90): [number, number, number][] {
  const per = periodMin(satrec)
  if (!Number.isFinite(per)) return []
  const out: [number, number, number][] = []
  for (let i = 0; i <= steps; i++) {
    const p = satEcefMeters(satrec, new Date(fromMs + (per * 60_000 * i) / steps))
    if (p) out.push(p)
  }
  return out
}
