// ── 衛星過境預報（太陽同步軌道近似）──────────────────────────
//
// 目的：讓海上知道「哪顆衛星、幾點過境、可看什麼影像」，好排偵搜/取像時機。
//
// 誠實說明：這裡用「太陽同步衛星每天在固定『地方時』通過同一緯度」的特性做
// 近似——不做完整 TLE/SGP4 軌道推算。故：
//   - 過境「時段（幾點）」相當準（±約 20 分，以本地時間近似當地地方時）。
//   - 每日型（VIIRS/MODIS，掃幅很寬）→ 幾乎每天涵蓋，可給「下次過境」具體時刻。
//   - 多日重訪（Sentinel/Landsat，掃幅窄）→ 只能給「過境時段＋週期」，確切是哪
//     一天仍以 Copernicus/USGS 為準（要看實際軌道相位與影像磚）。

export interface SatDef {
  id: string
  name: string
  emoji: string
  kind: '雷達' | '光學' | '夜間/每日'
  resText: string
  swathKm: number
  revisitText: string
  /** 掃幅寬、幾乎每天涵蓋任一點 → 可給具體下次過境時刻。 */
  daily: boolean
  /** 通過的地方時（小時，24 制）。太陽同步軌道每天約在此時段過境。 */
  crossings: number[]
  use: string
  via: string
}

export const SATS: SatDef[] = [
  {
    id: 'viirs',
    name: 'VIIRS（NOAA-20／Suomi-NPP）',
    emoji: '🌙',
    kind: '夜間/每日',
    resText: '375–750m',
    swathKm: 3060,
    revisitText: '每日多次',
    daily: true,
    crossings: [13.5, 1.5],
    use: '夜間漁火、每日雲況、大範圍海況',
    via: 'App 夜間漁火疊層／NASA Worldview',
  },
  {
    id: 'modis',
    name: 'MODIS（Terra／Aqua）',
    emoji: '🌎',
    kind: '光學',
    resText: '250m',
    swathKm: 2330,
    revisitText: '每日',
    daily: true,
    crossings: [10.5, 13.5],
    use: '每日真彩色、大範圍雲況',
    via: 'App 每日影像／NASA Worldview',
  },
  {
    id: 's2',
    name: 'Sentinel-2',
    emoji: '🛰️',
    kind: '光學',
    resText: '10m',
    swathKm: 290,
    revisitText: '約每 5 天',
    daily: false,
    crossings: [10.5],
    use: '看大船／船隊、海岸線（10m 全解析）',
    via: 'Copernicus 瀏覽器',
  },
  {
    id: 's1',
    name: 'Sentinel-1',
    emoji: '📡',
    kind: '雷達',
    resText: '5–20m',
    swathKm: 250,
    revisitText: '約每 6–12 天',
    daily: false,
    crossings: [6, 18],
    use: '穿雲、日夜可用，看金屬船／不廣播 AIS 的暗船',
    via: 'Copernicus 瀏覽器',
  },
  {
    id: 'landsat',
    name: 'Landsat 8／9',
    emoji: '🛰️',
    kind: '光學',
    resText: '15–30m',
    swathKm: 185,
    revisitText: '約每 8 天',
    daily: false,
    crossings: [10.17],
    use: '光學備援、海岸監測',
    via: 'USGS EarthExplorer',
  },
]

export interface OverpassRow {
  sat: SatDef
  /** 每日型：下次過境的具體時刻(epoch)；多日型為 null（只給時段）。 */
  nextEpoch: number | null
}

/** 以本地時間近似「當地地方時」，回傳今天或明天在該地方時的時刻(epoch)。 */
function nextAtLocalHour(now: number, h: number): number {
  const d = new Date(now)
  d.setHours(Math.floor(h), Math.round((h % 1) * 60), 0, 0)
  if (d.getTime() <= now) d.setDate(d.getDate() + 1)
  return d.getTime()
}

/** 產生各衛星的過境預報，依「最快具體過境」排序（每日型在前）。 */
export function overpassForecast(now: number): OverpassRow[] {
  const rows = SATS.map((sat) => ({
    sat,
    nextEpoch: sat.daily ? Math.min(...sat.crossings.map((h) => nextAtLocalHour(now, h))) : null,
  }))
  return rows.sort((a, b) => {
    if (a.nextEpoch != null && b.nextEpoch != null) return a.nextEpoch - b.nextEpoch
    if (a.nextEpoch != null) return -1
    if (b.nextEpoch != null) return 1
    return b.sat.swathKm - a.sat.swathKm
  })
}

/** 把地方時小時陣列格式化成「13:30／01:30」。 */
export function crossingsText(hours: number[]): string {
  return hours
    .map((h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`)
    .join('／')
}
