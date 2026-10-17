import { NLSC_EMAP_EMPTY, type HideRule } from './tileFilter.ts'

// ── 底圖樣式 ────────────────────────────────────────────────
//
// 使用者回報「看不到更精細的地圖，比 Google Map 還弱」。實測原因（2026-10，
// 在 GitHub Actions 上解碼真的圖磚，數據見 tileFilter.ts 檔頭）：
//   舊預設 Esri 暗灰 Canvas 本來就是刻意極簡的「資料底圖」，而且 z17 以上
//   全部是「尚無資料」佔位圖——連台北 101 都是。放大就空，所以覺得弱。
//
// 新做法是像 Google Maps 一樣，把幾家免金鑰圖磚「疊」起來，各取所長：
//   地圖：全球用 Esri 街道圖，台灣範圍內蓋上國土測繪中心中文電子地圖（到 z19）
//   衛星：最底 EOX 無雲衛星（外海也有圖）→ Esri 高解析空拍 → 中文路名地名透明層
//   海圖：Esri 海洋底圖（水深地形）＋ OpenSeaMap 航標
//   暗色：舊的 Esri 暗灰，夜間在駕駛台上不刺眼——夜視保護是海上真的需要的
//
// 每一層「沒資料」時會回什麼樣的假圖、從第幾層開始，都是實測來的，
// 所以下面的 maxNativeZoom 和 hide 規則不是猜的，改之前請先重新實測。
//
// 這個檔案只描述「要疊哪些圖磚」，不碰 Leaflet，方便離線測試。

export type BaseLayerId = 'street' | 'hybrid' | 'ocean' | 'dark' | 'satColor' | 'sentinel2' | 'sentinel1'

export interface TileSpec {
  /** Leaflet 樣板網址（{z}/{x}/{y}）。 */
  url: string
  attribution: string
  /** 伺服器真的有圖的最大層級；再放大由 Leaflet 把這一層放大顯示（會糊不會空）。 */
  maxNativeZoom: number
  /** 這一層從第幾層開始顯示。 */
  minZoom?: number
  /** 這一層顯示到第幾層為止（含）。不給就是一路到地圖上限。 */
  maxZoom?: number
  /** 只在這個範圍內請求圖磚 [[南,西],[北,東]]，範圍外連請求都不發。 */
  bounds?: [[number, number], [number, number]]
  /** 認出「沒資料」的假圖磚就藏起來，讓下面那層露出來。需要伺服器有 CORS。 */
  hide?: HideRule
  opacity?: number
}

export interface BaseStyle {
  id: BaseLayerId
  /** 切換鈕上的大字。 */
  label: string
  icon: string
  /** 一句話說明（給人看）。 */
  sub: string
  /** 影像時效——海上一定要知道「這張是不是即時」。 */
  vintage: string
  /** 由下往上疊。Sentinel 兩種是 WMS，執行時才組，這裡留空。 */
  layers: TileSpec[]
  /** 圖磚被藏掉或還沒載入時露出的底色（盡量跟這個樣式的海面同色，才看不出接縫）。 */
  background: string
  /** 開這個樣式時順便疊 OpenSeaMap 航標。 */
  seamarks?: boolean
  /** 需要 Sentinel Instance ID。 */
  needsKey?: boolean
}

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services'
const NLSC = 'https://wmts.nlsc.gov.tw/wmts'
const ESRI_ATTR = 'Esri, Maxar, HERE, Garmin, © OSM'
const NLSC_ATTR = '國土測繪中心'

/**
 * 國土測繪中心的請求範圍：台灣本島、澎湖、金馬、綠島蘭嶼、東沙。
 * 範圍內沒資料的地方它會回單色淺藍（已由 hide 規則處理），
 * 這個框只是不要去請求新加坡、日本那些「一定沒有」的圖磚。
 */
export const NLSC_BOUNDS: [[number, number], [number, number]] = [
  [20.4, 116.4],
  [26.7, 122.6],
]

/** 實測：Esri 衛星／街道在外海高倍率回佔位圖；EOX 全球都有、z19 才 404。 */
export const BASE_STYLES: Record<BaseLayerId, BaseStyle> = {
  street: {
    id: 'street',
    label: '地圖',
    icon: '🗺️',
    sub: '街道、地名、港口（台灣是中文）',
    vintage: '向量地圖 · 無影像日期',
    background: '#bed8f2', // Esri 街道圖的海面色（實測）
    layers: [
      {
        url: `${ESRI}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`,
        attribution: ESRI_ATTR,
        // 台北實測到 z19 都是真圖；沒資料的地方會回佔位圖，由 hide 處理
        maxNativeZoom: 19,
        hide: { esriPlaceholder: true },
      },
      {
        url: `${NLSC}/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}`,
        attribution: NLSC_ATTR,
        maxNativeZoom: 19,
        bounds: NLSC_BOUNDS,
        // 範圍外、與海面 z16 以上都是這個淺藍單色——藏掉讓 Esri 露出來
        hide: { flatColors: [NLSC_EMAP_EMPTY] },
      },
    ],
  },
  hybrid: {
    id: 'hybrid',
    label: '衛星',
    icon: '🛰️',
    sub: '空拍影像＋中文路名地名',
    vintage: '空拍鑲嵌 · 非即時、非單一日期',
    background: '#0b1622',
    layers: [
      {
        // 最底層：外海也有圖。Esri 在外海 z14 以上沒圖，靠這層補。
        url:
          'https://tiles.maps.eox.at/wmts?layer=s2cloudless-2023_3857&style=default' +
          '&tilematrixset=GoogleMapsCompatible&Service=WMTS&Request=GetTile&Version=1.0.0' +
          '&Format=image%2Fjpeg&TileMatrix={z}&TileCol={x}&TileRow={y}',
        attribution: 'EOX s2cloudless',
        // 原始解析度 10m，z16 以上伺服器只是放大給你；自己放大比較省流量
        maxNativeZoom: 16,
      },
      {
        url: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`,
        attribution: ESRI_ATTR,
        maxNativeZoom: 19,
        hide: { esriPlaceholder: true },
      },
      {
        // 拉遠時的地名（英文，全球）。放大後交給下面的中文層，兩層不重疊顯示。
        url: `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`,
        attribution: ESRI_ATTR,
        maxNativeZoom: 19,
        maxZoom: 13,
      },
      {
        // 臺灣通用電子地圖透明（無門牌）：只有路名、地名、道路，背景透明，
        // 海上與台灣以外 100% 透明（實測）。z12 時城市裡有 63% 被填滿太重，
        // 所以 z14 起才疊。
        url: `${NLSC}/EMAP12/default/GoogleMapsCompatible/{z}/{y}/{x}`,
        attribution: NLSC_ATTR,
        maxNativeZoom: 19,
        minZoom: 14,
        bounds: NLSC_BOUNDS,
      },
    ],
  },
  ocean: {
    id: 'ocean',
    label: '海圖',
    icon: '⚓',
    sub: '水深地形＋燈塔浮標（放大會變糊）',
    vintage: '水深地形 · 非時間性',
    background: '#6a9bcf',
    seamarks: true,
    layers: [
      {
        // 實測：z10 是真圖，z12 起全是佔位圖。只能抓到 z10 再放大。
        url: `${ESRI}/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}`,
        attribution: 'Esri, GEBCO, NOAA',
        maxNativeZoom: 10,
      },
      {
        url: `${ESRI}/Ocean/World_Ocean_Reference/MapServer/tile/{z}/{y}/{x}`,
        attribution: 'Esri',
        maxNativeZoom: 10,
      },
    ],
  },
  dark: {
    id: 'dark',
    label: '夜間',
    icon: '🌙',
    sub: '暗色低亮度，夜間不刺眼（細節少）',
    vintage: '向量地圖 · 無影像日期',
    background: '#1f2023',
    layers: [
      {
        // 實測：z17 以上全部是佔位圖（連台北都是），只能到 z16。
        url: `${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
        attribution: ESRI_ATTR,
        maxNativeZoom: 16,
      },
    ],
  },
  satColor: {
    id: 'satColor',
    label: '無雲衛星',
    icon: '🌍',
    sub: '全球無雲 10m 彩色（外海也有）',
    vintage: 'Sentinel-2 2023 年度合成 · 非即時',
    background: '#0b1622',
    layers: [
      {
        url:
          'https://tiles.maps.eox.at/wmts?layer=s2cloudless-2023_3857&style=default' +
          '&tilematrixset=GoogleMapsCompatible&Service=WMTS&Request=GetTile&Version=1.0.0' +
          '&Format=image%2Fjpeg&TileMatrix={z}&TileCol={x}&TileRow={y}',
        attribution: 'EOX s2cloudless（Copernicus）',
        maxNativeZoom: 16,
      },
    ],
  },
  sentinel2: {
    id: 'sentinel2',
    label: 'Sentinel-2',
    icon: '🛰️',
    sub: '近 120 天最新真彩 · 大船呈白點',
    vintage: '近 120 天最新 · 需 Instance ID',
    background: '#0b1622',
    needsKey: true,
    layers: [],
  },
  sentinel1: {
    id: 'sentinel1',
    label: 'Sentinel-1',
    icon: '📡',
    sub: '近 30 天雷達 · 穿雲夜視看船',
    vintage: '近 30 天最新 · 需 Instance ID',
    background: '#0b1622',
    needsKey: true,
    layers: [],
  },
}

/** 切換鈕上的大卡片（常用四種）。 */
export const MAIN_STYLES: BaseLayerId[] = ['street', 'hybrid', 'ocean', 'dark']
/** 收在「更多影像」裡的。 */
export const MORE_STYLES: BaseLayerId[] = ['satColor', 'sentinel2', 'sentinel1']

export const DEFAULT_BASE: BaseLayerId = 'street'

const VALID = new Set<string>([
  'street', 'hybrid', 'ocean', 'dark', 'satColor', 'sentinel2', 'sentinel1',
])

/** 新版存的值（v2）：照單全收，包含使用者自己挑的「夜間」。 */
export function parseBaseId(v: string | null): BaseLayerId | null {
  return v !== null && VALID.has(v) ? (v as BaseLayerId) : null
}

/**
 * 決定開 App 時用哪個底圖。
 *
 * 新舊兩個儲存鍵要分開：舊版（v1）的 dark 多半是「當初的預設」而不是使用者挑的，
 * 要換成新預設；但新版（v2）的 dark 是使用者在改版後自己選的「夜間」，要尊重。
 * 只用一個鍵的話，使用者選了夜間、下次開又被換回地圖。
 */
export function resolveStoredBase(v2: string | null, v1: string | null): BaseLayerId {
  return parseBaseId(v2) ?? migrateBaseId(v1)
}

/**
 * 舊版存在手機裡的底圖 id 對應到新版。
 *
 * 舊的「戰術暗色」是當初的預設，不是使用者自己挑的——如果原樣保留，
 * 改版後大多數人打開還是那張「放大就空」的地圖，等於沒改。
 * 所以舊預設 dark 一律換成新預設；其他使用者真的挑過的，對應到最接近的新樣式。
 */
export function migrateBaseId(stored: string | null): BaseLayerId {
  switch (stored) {
    case 'street':
    case 'hybrid':
    case 'ocean':
    case 'satColor':
    case 'sentinel2':
    case 'sentinel1':
      return stored
    case 'nlsc':
      return 'street'
    case 'nlscPhoto':
    case 'esri':
      return 'hybrid'
    default:
      return DEFAULT_BASE
  }
}

/** 填樣板網址（離線下載用；必須跟 Leaflet 顯示時請求的網址一字不差才會命中快取）。 */
export function fillTemplate(url: string, z: number, x: number, y: number): string {
  return url.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))
}

/** 某一層在 (z, 中心點) 是否會被請求——離線下載只抓真的會用到的圖磚。 */
export function specActiveAt(spec: TileSpec, z: number, lat: number, lng: number): boolean {
  if (spec.minZoom !== undefined && z < spec.minZoom) return false
  if (spec.maxZoom !== undefined && z > spec.maxZoom) return false
  if (z > spec.maxNativeZoom) return false // 放大顯示用的是較低層的圖磚
  if (spec.bounds) {
    const [[s, w], [n, e]] = spec.bounds
    if (lat < s || lat > n || lng < w || lng > e) return false
  }
  return true
}
