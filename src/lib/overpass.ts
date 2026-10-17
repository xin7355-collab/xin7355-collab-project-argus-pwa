// ── 衛星過境預報（太陽同步軌道近似）──────────────────────────
//
// 目的：讓海上知道「哪顆衛星、幾點過境、可看什麼影像」，好排偵搜/取像時機。
//
// 誠實說明：這裡用「太陽同步衛星每天在固定『地方時』通過同一緯度」的特性做
// 近似——不做完整 TLE/SGP4 軌道推算（那個在 passPlan.ts，需要連網抓根數）。故：
//   - 過境「時段（幾點）」相當準（±約 20 分，以本地時間近似當地地方時）。
//   - 每日型（VIIRS/MODIS，掃幅很寬）→ 幾乎每天涵蓋，可給「下次過境」具體時刻。
//   - 多日重訪（Sentinel/Landsat，掃幅窄）→ 只能給「過境時段＋週期」，確切是哪
//     一天仍以 Copernicus/USGS 為準（要看實際軌道相位與影像磚）。

import { formatDist, type DistUnit } from './units.ts'

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


// ── 掃幅 vs 你關心的範圍 ───────────────────────────────────
//
// 「哪一趟會剛好掃過這裡」現在由 passPlan.ts 用 SGP4 + 真實軌道根數回答
// （TLE 由自家 Worker 代抓）。這裡回答的是另一個、不用連網就答得出來的
// 問題：「一趟掃得夠不夠寬」。
//
// 掃幅是公開且穩定的規格，畫面範圍算得出來，兩者相比就知道
// 「這顆衛星一趟掃得住我這片海嗎，還是要拼好幾趟」。
// 離線、或根數抓不到的時候，這一段仍然有用。

/** 網際網路地圖在赤道、zoom 0 時每像素多少公尺。 */
const M_PER_PX_Z0 = 156543.03392

/**
 * 目前畫面大約多寬（公里）。Web Mercator 的尺度隨緯度收縮，要乘 cos(lat)。
 */
export function viewWidthKm(lat: number, zoom: number, widthPx: number): number {
  const mPerPx = (M_PER_PX_Z0 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom)
  return (mPerPx * widthPx) / 1000
}

export interface SwathFit {
  /** 一趟掃得住整個畫面寬度嗎。 */
  coversView: boolean
  /** 掃幅是畫面寬度的幾倍。 */
  ratio: number
  /** 給人看的一句話。 */
  text: string
}

/** 把「掃幅 vs 畫面寬度」講成一句話。單位跟隨使用者設定（預設浬）。 */
export function swathFit(swathKm: number, viewKm: number, unit: DistUnit = 'nm'): SwathFit {
  if (!Number.isFinite(viewKm) || viewKm <= 0) {
    return { coversView: false, ratio: 0, text: "" }
  }
  const ratio = swathKm / viewKm
  const sw = formatDist(swathKm, unit, 0)
  const vw = formatDist(viewKm, unit, 0)
  if (ratio >= 1) {
    return {
      coversView: true,
      ratio,
      text: `掃幅 ${sw} 是目前畫面寬（約 ${vw}）的 ${ratio.toFixed(1)} 倍，一趟蓋得住`,
    }
  }
  return {
    coversView: false,
    ratio,
    text: `掃幅 ${sw} 比目前畫面窄（約 ${vw}），一趟只蓋得住約 ${Math.round(ratio * 100)}%，要拼好幾趟或縮小範圍`,
  }
}
