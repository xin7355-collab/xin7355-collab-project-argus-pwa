// ── 搜索航線規劃 (Parallel-track / 平行梳掃) ──────────────────
//
// 依國研院文章：搜救系統可結合搜救寬度規劃「最佳搜索區域與航線」。
// 這裡在機率搜索區上產生平行梳掃（割草機式）航線，讓搜救船照著走，
// 均勻涵蓋高機率區域。

const DEG = Math.PI / 180
const R = 6371000

function offset(lat: number, lng: number, dE: number, dN: number): [number, number] {
  return [lat + (dN / R) / DEG, lng + (dE / (R * Math.cos(lat * DEG))) / DEG]
}

export interface SearchPatternInput {
  centerLat: number
  centerLng: number
  /** 搜索半徑 (m)：涵蓋此半徑的方形區。 */
  radiusM: number
  /** 航線間距 (m)＝有效搜索寬度。 */
  spacingM: number
  /** 梳掃方向（度，掃描腿的走向；預設 90 = 東西向腿、南北推進）。 */
  headingDeg?: number
}

export interface SearchPatternResult {
  /** 航線路徑點（[lat,lng]），依序連成搜救船航跡。 */
  path: [number, number][]
  /** 總航程 (m)。 */
  lengthM: number
  legs: number
}

/**
 * 產生平行梳掃航線。回傳依序的航點。
 */
export function buildSearchPattern(input: SearchPatternInput): SearchPatternResult {
  const half = input.radiusM
  const spacing = Math.max(200, input.spacingM)
  // 腿沿 heading 走，逐條往垂直方向推進
  const legs = Math.min(60, Math.max(2, Math.round((2 * half) / spacing) + 1))
  const h = ((input.headingDeg ?? 90) % 360) * DEG
  // 腿方向單位向量 (east,north)
  const legE = Math.sin(h)
  const legN = Math.cos(h)
  // 推進方向 = 腿方向轉 90°
  const stepE = Math.sin(h + Math.PI / 2)
  const stepN = Math.cos(h + Math.PI / 2)

  const path: [number, number][] = []
  for (let i = 0; i < legs; i++) {
    // 這條腿的推進偏移（從 -half 到 +half）
    const s = -half + (i * (2 * half)) / (legs - 1)
    // 腿的兩端（±half 沿腿方向），交替方向形成割草機路徑
    const ends = i % 2 === 0 ? [-half, half] : [half, -half]
    for (const e of ends) {
      const dE = legE * e + stepE * s
      const dN = legN * e + stepN * s
      path.push(offset(input.centerLat, input.centerLng, dE, dN))
    }
  }

  // 總航程
  let lengthM = 0
  for (let i = 1; i < path.length; i++) {
    const [la1, lo1] = path[i - 1]
    const [la2, lo2] = path[i]
    const dN = (la2 - la1) * DEG * R
    const dE = (lo2 - lo1) * DEG * R * Math.cos(la1 * DEG)
    lengthM += Math.hypot(dE, dN)
  }

  return { path, lengthM, legs }
}
