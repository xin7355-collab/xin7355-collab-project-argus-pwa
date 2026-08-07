// ── 雷達涵蓋規劃（私密，只存本機）────────────────────────────
//
// 海上沿岸雷達站點屬敏感資料，無公開來源；此工具讓使用者輸入自己已知的雷達
// 站（沿岸/離岸風電/艦艇），App 依「雷達地平線」公式算出對不同高度目標的實際偵測
// 距離，畫出涵蓋圈與死角——用於研判非法越界小艇(低矮，偵測距離短)可能鑽的縫。
//
// 雷達地平線(含大氣折射 k=4/3)：d(km) ≈ 4.12 × (√天線高m + √目標高m)。
// 對海上的重點：同一座雷達，對 2m 小艇的涵蓋比 10m 漁船短一截，死角就在那。

export type RadarType = 'coast' | 'windfarm' | 'ship' | 'other'

export interface RadarSite {
  id: string
  name: string
  lat: number
  lng: number
  type: RadarType
  /** 天線離海面高度(m)。 */
  antennaM: number
  /** 假設目標高度(m)：小艇~2、舢舨~3、漁船~10、貨輪~20。 */
  targetM: number
  /** 裝備最大量程(km)，涵蓋取「地平線」與此值的較小者。 */
  maxRangeKm: number
}

export const RADAR_TYPES: { id: RadarType; label: string; color: string }[] = [
  { id: 'coast', label: '海上沿岸雷達', color: '#22d3ee' },
  { id: 'windfarm', label: '離岸風電雷達', color: '#a78bfa' },
  { id: 'ship', label: '艦艇雷達', color: '#34d399' },
  { id: 'other', label: '其他', color: '#f59e0b' },
]

export function radarColor(t: RadarType): string {
  return RADAR_TYPES.find((x) => x.id === t)?.color ?? '#f59e0b'
}
export function radarTypeLabel(t: RadarType): string {
  return RADAR_TYPES.find((x) => x.id === t)?.label ?? '其他'
}

/** 雷達地平線(km)：含大氣折射，對指定高度目標的理論最遠可見距離。 */
export function radarHorizonKm(antennaM: number, targetM: number): number {
  const a = Math.max(0, antennaM)
  const t = Math.max(0, targetM)
  return 4.12 * (Math.sqrt(a) + Math.sqrt(t))
}

/** 實際涵蓋(km)：地平線與裝備量程取小。 */
export function coverageKm(s: RadarSite): number {
  return Math.min(radarHorizonKm(s.antennaM, s.targetM), s.maxRangeKm)
}

const LS_KEY = 'argus.radar.v1'

/** 補預設，避免舊/損壞紀錄缺欄位→coverageKm NaN→Leaflet 半徑 NaN。 */
function normalizeRadarSite(r: Partial<RadarSite>): RadarSite {
  const n = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  const types: RadarType[] = ['coast', 'windfarm', 'ship', 'other']
  return {
    id: typeof r.id === 'string' ? r.id : newRadarId(),
    name: typeof r.name === 'string' ? r.name : '雷達站',
    lat: r.lat as number,
    lng: r.lng as number,
    type: types.includes(r.type as RadarType) ? (r.type as RadarType) : 'coast',
    antennaM: n(r.antennaM, 40),
    targetM: n(r.targetM, 2),
    maxRangeKm: n(r.maxRangeKm, 40),
  }
}

export function loadRadar(): RadarSite[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || '[]')
    if (!Array.isArray(raw)) return []
    return raw
      .filter((r) => r && typeof r.lat === 'number' && typeof r.lng === 'number')
      .map(normalizeRadarSite)
  } catch {
    return []
  }
}

export function persistRadar(sites: RadarSite[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(sites))
  } catch {
    /* ignore quota */
  }
}

export function newRadarId(): string {
  return 'r' + Math.abs(Date.now() ^ ((Math.random() * 1e9) | 0)).toString(36)
}
