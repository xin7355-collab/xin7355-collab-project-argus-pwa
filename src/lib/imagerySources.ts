import type L from 'leaflet'
import type { BaseLayerId } from './baseLayers'
import {
  buildEsriImagery,
  buildEsriOcean,
  buildGibsBoatLights,
  buildGibsTrueColor,
  buildGibsViirs,
  buildS2Cloudless,
} from './gibs'

// ── 影像來源目錄 ───────────────────────────────────────────
//
// 把 gibs.ts 裡既有的 builder 整理成一張表，供「前後對照」挑選左右兩側。
// 這裡不新增任何影像來源或網址，只是把現成的包起來讓它們可以被「選」。

/** 光學模式單一影像來源（store 的 opticalSource 用這個）。 */
export type OpticalSource = 'nasa' | 'esri' | 'eox' | 'ocean'

/** 可拿來做前後對照的來源。比 OpticalSource 多了 MODIS 與夜間漁火。 */
export type ImagerySourceId = OpticalSource | 'modis' | 'lights'

export interface ImagerySourceDef {
  id: ImagerySourceId
  label: string
  sub: string
  /**
   * 吃日期的來源才有「同一處、不同時間」的前後對照意義；
   * 不吃日期的（Esri 空拍、EOX 無雲、海底地形）是鑲嵌合成，日期欄會停用。
   */
  dated: boolean
}

export const IMAGERY_SOURCES: ImagerySourceDef[] = [
  { id: 'nasa', label: '每日VIIRS', sub: '375m·當日', dated: true },
  { id: 'modis', label: '每日MODIS', sub: '250m·當日', dated: true },
  { id: 'lights', label: '夜間漁火', sub: 'DNB·夜間', dated: true },
  { id: 'esri', label: '高解析空拍', sub: '岸邊最銳利', dated: false },
  { id: 'eox', label: 'S2無雲', sub: '10m·平滑', dated: false },
  { id: 'ocean', label: '海底地形', sub: '外海水深', dated: false },
]

export function imagerySourceDef(id: ImagerySourceId): ImagerySourceDef {
  return IMAGERY_SOURCES.find((s) => s.id === id) ?? IMAGERY_SOURCES[0]
}

/** 給人看的一行標籤，例如「每日VIIRS 10-04」。 */
export function imageryLabel(id: ImagerySourceId, date: string): string {
  const def = imagerySourceDef(id)
  return def.dated ? `${def.label} ${date.slice(5)}` : def.label
}

/**
 * 建出一個影像圖層。cls 是要套的 CSS class——前後對照的右側要用
 * 'gibs-imagery-cmp'，畫面亮點掃描才不會把兩層混在一起讀。
 */
export function buildImagery(
  id: ImagerySourceId,
  date: string,
  cls = 'gibs-imagery',
): L.TileLayer {
  switch (id) {
    case 'esri':
      return buildEsriImagery(cls)
    case 'eox':
      return buildS2Cloudless(cls)
    case 'ocean':
      return buildEsriOcean(cls)
    case 'modis':
      return buildGibsTrueColor(date, cls)
    case 'lights':
      return buildGibsBoatLights(date, cls)
    case 'nasa':
    default:
      return buildGibsViirs(date, cls)
  }
}

/** 把日期往前推 n 天（YYYY-MM-DD）。前後對照的預設「前」就是用這個。 */
export function daysEarlier(date: string, n: number): string {
  const t = Date.parse(`${date}T00:00:00Z`)
  if (!Number.isFinite(t)) return date
  return new Date(t - n * 86400000).toISOString().slice(0, 10)
}


// ── 底圖 ↔ 光學影像來源的對應 ──────────────────────────────
//
// 這兩套設定其實指向同一批衛星影像，卻分散在「圖層」面板與「沿岸光學」面板。
// 分開設定會讓人以為「我明明選了衛星底圖，怎麼切到光學還是另一種影像」。
// 有對應關係的就雙向連動；沒有對應的（暗色底圖、中文電子地圖、每日 VIIRS、
// 海底地形）各自保留，不互相干擾。

const BASE_TO_OPTICAL: Partial<Record<BaseLayerId, OpticalSource>> = {
  esri: 'esri',
  satColor: 'eox',
}

const OPTICAL_TO_BASE: Partial<Record<OpticalSource, BaseLayerId>> = {
  esri: 'esri',
  eox: 'satColor',
}

/** 這個底圖在光學模式有沒有對應的影像來源。 */
export function opticalForBase(id: BaseLayerId): OpticalSource | undefined {
  return BASE_TO_OPTICAL[id]
}

/** 這個光學影像來源有沒有對應的底圖。 */
export function baseForOptical(s: OpticalSource): BaseLayerId | undefined {
  return OPTICAL_TO_BASE[s]
}
