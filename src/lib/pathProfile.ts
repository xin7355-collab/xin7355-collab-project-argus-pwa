// ── 點對點路徑剖面（微波備用鏈路用）────────────────────────────
//
// 與既有的「涵蓋分析」不同：涵蓋是從單站往四面八方算可達範圍；這裡是兩個
// 已知端點之間的單一路徑，要回答的是「這條鏈路打不打得通、被什麼擋住」。
//
// 判定沿用與地形／無線電相同的三件事，但門檻更嚴：
//   1) 幾何視線：天線頂連線 vs 地形（含地球曲率抬升，k 可調）
//   2) 第一 Fresnel 區：微波鏈路實務要求 60% 淨空，只是「沒撞到」並不夠
//   3) 淨空餘裕：最糟點還剩幾公尺、佔 F1 幾 %——這才是能不能施工的依據
//
// 高程來源與地形分析同一支（Copernicus GLO-90 DSM，已含建築與植被但被抹平
// 在 90m 網格內）。因此樹木與矮建物大致已計入，但「單棟高樓」會被鄰近地面
// 平均掉——路徑經過市區時，建議用 clutterMarginM 手動加安全餘裕。

import { elevationBatch } from './terrain'
import { fresnelRadiusM } from './terrain'

const R_EARTH = 6371000
const DEG = Math.PI / 180

/** 大圓距離(km)。 */
export function pathDistanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLa = (bLat - aLat) * DEG
  const dLo = (bLng - aLng) * DEG
  const h =
    Math.sin(dLa / 2) ** 2 + Math.cos(aLat * DEG) * Math.cos(bLat * DEG) * Math.sin(dLo / 2) ** 2
  return (2 * R_EARTH * Math.asin(Math.sqrt(h))) / 1000
}

/** 沿大圓內插：t=0 為 A、t=1 為 B。 */
export function interpolate(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
  t: number,
): [number, number] {
  const la1 = aLat * DEG
  const lo1 = aLng * DEG
  const la2 = bLat * DEG
  const lo2 = bLng * DEG
  const d =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2,
      ),
    )
  if (d === 0) return [aLat, aLng]
  const A = Math.sin((1 - t) * d) / Math.sin(d)
  const B = Math.sin(t * d) / Math.sin(d)
  const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2)
  const y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2)
  const z = A * Math.sin(la1) + B * Math.sin(la2)
  return [Math.atan2(z, Math.hypot(x, y)) / DEG, Math.atan2(y, x) / DEG]
}

export interface ProfilePoint {
  /** 距 A 端(km)。 */
  km: number
  lat: number
  lng: number
  /** 地面高程(m，含 DSM 的建築植被)。 */
  groundM: number
  /** 該處視線高度(m)。 */
  losM: number
  /** 地球曲率抬升(m)。 */
  bulgeM: number
  /** 第一 Fresnel 區半徑(m)。 */
  fresnelM: number
  /** 淨空餘裕(m)＝視線高 −（地面＋曲率＋雜波餘裕）。負值代表被擋。 */
  clearanceM: number
  /** 淨空佔 F1 的比例（1.0＝剛好一個 F1；微波要求 ≥0.6）。 */
  fresnelRatio: number
}

export interface PathAnalysis {
  totalKm: number
  points: ProfilePoint[]
  /** 最糟的一點（以 fresnelRatio 最小者為準）。 */
  worst: ProfilePoint | null
  /** 幾何視線是否被擋（clearanceM < 0）。 */
  losBlocked: boolean
  /** 是否達到微波實務要求的 60% F1 淨空。 */
  fresnelOk: boolean
  /** A 端天線頂海拔(m)。 */
  aTopM: number
  /** B 端天線頂海拔(m)。 */
  bTopM: number
  /** 為了打通所需的最小加高量(m)：兩端各加這麼高即可達 60% F1。null＝已達標。 */
  neededRaiseM: number | null
}

export interface PathInput {
  a: { lat: number; lng: number; antennaM: number }
  b: { lat: number; lng: number; antennaM: number }
  /** 工作頻率(GHz)。微波常見 6/7/8/11/15/18/23。 */
  freqGhz: number
  /** 等效地球半徑因子。日間標準 4/3。 */
  kFactor?: number
  /**
   * 額外雜波餘裕(m)：路徑經過市區或林地時手動加。
   * DSM 已含樹與矮建物，但單棟高樓會被 90m 網格平均掉，需人工補。
   */
  clutterMarginM?: number
  /** 取樣點數（含兩端）。預設 120（≈2 批高程請求）。 */
  samples?: number
}

/**
 * 算整條路徑的剖面與淨空判定。
 * 高程查詢失敗會 throw（呼叫端顯示錯誤即可，不要假裝算得出來）。
 */
export async function analyzePath(inp: PathInput): Promise<PathAnalysis> {
  const { a, b } = inp
  const k = inp.kFactor ?? 4 / 3
  const margin = inp.clutterMarginM ?? 0
  const n = Math.max(20, Math.min(300, inp.samples ?? 120))
  const totalKm = pathDistanceKm(a.lat, a.lng, b.lat, b.lng)
  if (!(totalKm > 0)) throw new Error('兩端座標相同')

  const pts: [number, number][] = []
  for (let i = 0; i < n; i++) pts.push(interpolate(a.lat, a.lng, b.lat, b.lng, i / (n - 1)))
  const elevs = await elevationBatch(pts)

  // 天線頂海拔＝端點地面高程＋天線離地高
  const aTopM = elevs[0] + a.antennaM
  const bTopM = elevs[n - 1] + b.antennaM

  const points: ProfilePoint[] = []
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    const km = totalKm * t
    const d1 = km
    const d2 = totalKm - km
    const losM = aTopM + (bTopM - aTopM) * t
    const bulgeM = (d1 * 1000 * (d2 * 1000)) / (2 * k * R_EARTH)
    const fresnelM = fresnelRadiusM(d1, d2, inp.freqGhz * 1000, totalKm)
    const clearanceM = losM - (elevs[i] + bulgeM + margin)
    points.push({
      km,
      lat: pts[i][0],
      lng: pts[i][1],
      groundM: elevs[i],
      losM,
      bulgeM,
      fresnelM,
      clearanceM,
      // 兩端點的 F1 為 0，比例定義為極大（不構成瓶頸），避免除以 0
      fresnelRatio: fresnelM > 0.01 ? clearanceM / fresnelM : Number.POSITIVE_INFINITY,
    })
  }

  // 最糟點只在「中間段」找——兩端 F1 趨近 0，比例會失真
  let worst: ProfilePoint | null = null
  for (const p of points) {
    if (!Number.isFinite(p.fresnelRatio)) continue
    if (!worst || p.fresnelRatio < worst.fresnelRatio) worst = p
  }

  const losBlocked = points.some((p) => p.clearanceM < 0)
  const fresnelOk = worst ? worst.fresnelRatio >= 0.6 : true

  // 需要加高多少：兩端同時加高 h，視線整條抬升 h，故取最糟點的缺口即可
  let neededRaiseM: number | null = null
  if (worst && worst.fresnelRatio < 0.6) {
    neededRaiseM = Math.ceil(0.6 * worst.fresnelM - worst.clearanceM)
  }

  return { totalKm, points, worst, losBlocked, fresnelOk, aTopM, bTopM, neededRaiseM }
}
