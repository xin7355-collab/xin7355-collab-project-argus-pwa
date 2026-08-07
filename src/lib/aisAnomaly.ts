// ── AIS 異常行為偵測（海上可疑運輸/非法越界快篩）──────────────────
import type { Vessel } from './ais'
import { TAIWAN_BASELINE, PENGHU_BASELINE } from './territorialWaters'

const SPEED_ANOMALY_KN = 25 // 一般商漁船罕見超過（疑似可疑運輸快艇）
const FAST_NEAR_COAST_KN = 18 // 近岸高速
const LOITER_MIN = 0.3 // 低於此近似停俥/錨泊
const LOITER_MAX = 2.5 // 低速滯留（疑似接駁/等待）
const TERRITORIAL_KM = 22.2 // 12 浬領海
const CONTIGUOUS_KM = 44.4 // 24 浬鄰接區

const DEG = Math.PI / 180

/** 船位到一條基線「線段」的最短距離(km)——局部平面近似（基線尺度足夠準）。 */
function segKm(lat: number, lng: number, aLa: number, aLo: number, bLa: number, bLo: number): number {
  const kx = 111.32 * Math.cos(lat * DEG) // 每度經度 km
  const ky = 110.57 // 每度緯度 km
  const ax = (aLo - lng) * kx
  const ay = (aLa - lat) * ky
  const bx = (bLo - lng) * kx
  const by = (bLa - lat) * ky
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(ax + t * dx, ay + t * dy)
}

/** 到海岸(領海基線)的最短距離(km)：逐「線段」取最近，而非只取頂點（否則遠遠高估）。 */
function coastKm(lat: number, lng: number): number {
  let best = Infinity
  for (const line of [TAIWAN_BASELINE, PENGHU_BASELINE]) {
    for (let i = 0; i < line.length - 1; i++) {
      const d = segKm(lat, lng, line[i][0], line[i][1], line[i + 1][0], line[i + 1][1])
      if (d < best) best = d
    }
  }
  return best
}

export interface VesselAnalysis {
  vessel: Vessel
  alerts: string[]
  /** ok = 正常, warn = 需注意, alert = 高度可疑 */
  level: 'ok' | 'warn' | 'alert'
  /** 距海岸 km。 */
  coastKm: number
}

/** 分析單艘船，回傳警示清單與等級（含海上可疑運輸/非法越界態樣）。 */
export function analyzeVessel(v: Vessel): VesselAnalysis {
  const alerts: string[] = []
  const dk = coastKm(v.lat, v.lng)
  const unknown = v.name === '(無船名)' || v.type === '不明'
  const inTerritorial = dk <= TERRITORIAL_KM
  const inContiguous = dk <= CONTIGUOUS_KM
  const loitering = v.sog >= LOITER_MIN && v.sog <= LOITER_MAX

  let score = 0
  if (unknown) {
    alerts.push('無船名/身分不明')
    score += inTerritorial ? 2 : 1
  }
  if (v.sog > SPEED_ANOMALY_KN) {
    alerts.push(`航速異常 ${v.sog.toFixed(0)} kn`)
    score += 1
  }
  if (inTerritorial && unknown) {
    alerts.push('⚠ 無AIS身分闖入領海（疑似非法越界/可疑運輸）')
    score += 2
  } else if (inContiguous && unknown) {
    alerts.push('無身分進入鄰接區')
    score += 1
  }
  if (loitering && inContiguous) {
    alerts.push('近岸低速滯留（疑似接駁/等待）')
    score += inTerritorial ? 2 : 1
  }
  if (v.sog >= FAST_NEAR_COAST_KN && inContiguous && unknown) {
    alerts.push('近岸高速＋無身分（疑似可疑運輸快艇）')
    score += 2
  }

  const level: VesselAnalysis['level'] = score >= 3 ? 'alert' : score >= 1 ? 'warn' : 'ok'
  return { vessel: v, alerts, level, coastKm: dk }
}

/** 分析整批船。 */
export function analyzeVessels(vessels: Vessel[]): VesselAnalysis[] {
  return vessels.map(analyzeVessel)
}

// ── 趨近我方研判（CPA / TCPA，假設我方定點觀測）────────────────
export interface ApproachInfo {
  vessel: Vessel
  /** 目前距我方（浬）。 */
  distNm: number
  /** 最近接近距離 CPA（浬）。 */
  cpaNm: number
  /** 到最近接近點的時間 TCPA（分鐘，≥0）。 */
  tcpaMin: number
}

/**
 * 找出「正朝我方趨近、且會近距離通過」的船（碰撞/接觸預警）。
 * 以我方定點、目標維持現航向航速計算 CPA/TCPA；只回會靠近到 dangerCpaNm 內、
 * 且在 horizonMin 分鐘內、目前 maxDistNm 浬內者，風險高（CPA 小、TCPA 小）排前。
 */
export function analyzeApproach(
  vessels: Vessel[],
  own: { lat: number; lng: number },
  opts: { maxDistNm?: number; dangerCpaNm?: number; horizonMin?: number } = {},
): ApproachInfo[] {
  const { maxDistNm = 24, dangerCpaNm = 2, horizonMin = 90 } = opts
  const cosLat = Math.cos(own.lat * DEG) || 1e-6
  const out: ApproachInfo[] = []
  for (const v of vessels) {
    const ex = (v.lng - own.lng) * 60 * cosLat // 東向浬
    const ny = (v.lat - own.lat) * 60 // 北向浬
    const dist = Math.hypot(ex, ny)
    if (dist > maxDistNm) continue
    const vex = v.sog * Math.sin(v.cog * DEG)
    const vny = v.sog * Math.cos(v.cog * DEG)
    const speed2 = vex * vex + vny * vny
    if (speed2 < 0.01) continue // 幾乎靜止：不算趨近
    const tStar = -((ex * vex + ny * vny) / speed2) // 小時
    if (tStar <= 0) continue // 正在遠離
    const cpa = Math.hypot(ex + vex * tStar, ny + vny * tStar)
    const tcpaMin = tStar * 60
    if (cpa <= dangerCpaNm && tcpaMin <= horizonMin) {
      out.push({ vessel: v, distNm: dist, cpaNm: cpa, tcpaMin })
    }
  }
  return out.sort((a, b) => a.cpaNm - b.cpaNm || a.tcpaMin - b.tcpaMin)
}
