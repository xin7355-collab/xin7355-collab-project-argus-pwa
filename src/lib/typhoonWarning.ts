// ── 颱風警報時機推估（海警/陸警 ETA）──────────────────────
//
// 依颱風「預報路徑點 + 暴風半徑」推估最快何時暴風圈(7級風)會影響台灣：
//   海警：暴風圈進入台灣近海（沿岸 100 km 內）——CWA 約發布於 24h 前。
//   陸警：暴風圈觸及陸地——CWA 約發布於 18h 前。
// 這是「從路徑推估」，非官方警報；官方以中央氣象署發布為準。

import { TAIWAN_BASELINE } from './territorialWaters'
import type { Typhoon } from './typhoon'

const R = 6371
const DEG = Math.PI / 180
function kmBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const a =
    Math.sin(((lat2 - lat1) * DEG) / 2) ** 2 +
    Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(((lng2 - lng1) * DEG) / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}
/** 某點到台灣本島海岸（基線點近似）的最短距離(km)。 */
function nearestTaiwanKm(lat: number, lng: number): number {
  let best = Infinity
  for (const [la, lo] of TAIWAN_BASELINE) {
    const d = kmBetween(lat, lng, la, lo)
    if (d < best) best = d
  }
  return best
}

export interface TriggerPoint {
  lat: number
  lng: number
  hours: number
}

export interface WarningEstimate {
  /** 最快海警（暴風圈進近海 100km）距現在小時；null=推估不影響。 */
  seaHours: number | null
  /** 最快陸警（暴風圈觸陸）距現在小時；null=推估不影響。 */
  landHours: number | null
  /** 路徑上首次達海警/陸警門檻的位置（畫在地圖上標示）。 */
  seaPoint: TriggerPoint | null
  landPoint: TriggerPoint | null
  /** 暴風圈邊緣與台灣海岸的最近距離(km，正=尚有距離、負=已觸及)。 */
  closestGapKm: number
  /** 是否已在影響中。 */
  seaNow: boolean
  landNow: boolean
}

const SEA_BUFFER_KM = 100

export interface WarningVerdict {
  level: 'none' | 'watch' | 'issue' | 'active'
  text: string
}
export interface MarineVerdict {
  sea: WarningVerdict
  land: WarningVerdict
  /** 海上作業建議（取較高等級）。 */
  advice: string
  /** 整體最高等級。 */
  top: 'none' | 'watch' | 'issue' | 'active'
}

const RANK: Record<WarningVerdict['level'], number> = { none: 0, watch: 1, issue: 2, active: 3 }

/**
 * 以中央氣象署發布準則研判（海上角度）：
 *   海上警報：7級暴風圈預計 24h 內侵襲台灣近海(100km) → 發布。
 *   陸上警報：7級暴風圈預計 18h 內侵襲陸地 → 發布。
 */
export function marineVerdict(w: WarningEstimate): MarineVerdict {
  const sea = verdict(w.seaHours, 24, '海上')
  const land = verdict(w.landHours, 18, '陸上')
  const top = RANK[sea.level] >= RANK[land.level] ? sea.level : land.level
  const advice =
    top === 'active'
      ? '暴風圈影響中：船艇即刻進港避風、離岸作業人員撤回、加強沿海戒備與救難待命。'
      : top === 'issue'
        ? '達警報發布時機：通知轄區船筏進港、掌握在外船位、整備救難能量、加強巡邏。'
        : top === 'watch'
          ? '尚未達發布時機但需戒備：預劃避風港、清點裝備、持續掌握動態。'
          : '研判暫不影響台灣海域，維持正常勤務並持續追蹤。'
  return { sea, land, advice, top }
}

function verdict(hours: number | null, issueLeadH: number, label: string): WarningVerdict {
  if (hours === null) return { level: 'none', text: `研判暫不影響台灣${label === '海上' ? '近海' : '陸地'}` }
  if (hours <= 0) return { level: 'active', text: `暴風圈已影響（達${label}警報等級）` }
  if (hours <= issueLeadH) return { level: 'issue', text: `建議發布${label}警報（約 ${hours}h 後侵襲）` }
  return { level: 'watch', text: `約 ${hours}h 後才侵襲，尚未達${label}警報發布時機（持續監控）` }
}

export function estimateWarnings(ty: Typhoon): WarningEstimate {
  const pts = ty.track.filter((p) => p.hours >= 0)
  let seaHours: number | null = null
  let landHours: number | null = null
  let seaPoint: TriggerPoint | null = null
  let landPoint: TriggerPoint | null = null
  let closestGap = Infinity
  for (const p of pts) {
    const centerKm = nearestTaiwanKm(p.lat, p.lng)
    const gap = centerKm - p.galeRadiusKm // 暴風圈邊緣到海岸的距離
    if (gap < closestGap) closestGap = gap
    if (seaHours === null && gap <= SEA_BUFFER_KM) {
      seaHours = p.hours
      seaPoint = { lat: p.lat, lng: p.lng, hours: p.hours }
    }
    if (landHours === null && gap <= 0) {
      landHours = p.hours
      landPoint = { lat: p.lat, lng: p.lng, hours: p.hours }
    }
  }
  return {
    seaHours,
    landHours,
    seaPoint,
    landPoint,
    closestGapKm: closestGap,
    seaNow: seaHours === 0,
    landNow: landHours === 0,
  }
}
