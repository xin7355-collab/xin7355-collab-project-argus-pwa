import L from 'leaflet'

// ── NASA GIBS 免金鑰衛星影像 ────────────────────────────────
//
// GIBS（Global Imagery Browse Services）提供全球每日真彩色衛星影像，
// 完全免金鑰、免註冊、免設定。解析度約 250m（MODIS），適合當「開箱即用」
// 的光學影像。想要更高解析度（10m）再接 Sentinel-2。
//
// 影像有幾小時延遲，所以「今天」可能還沒好；用昨天或前幾天最保險。

const GIBS_BASE = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best'

/**
 * Esri World Imagery：免金鑰高解析度衛星/空拍鑲嵌影像，放大到岸邊很清晰
 * （非每日、無雲層時效，但解析度遠高於 MODIS 250m）。適合「看清楚地形/島礁」。
 */
export function buildEsriImagery(): L.TileLayer {
  return L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    {
      maxZoom: 19,
      maxNativeZoom: 19,
      attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
      className: 'gibs-imagery',
      crossOrigin: 'anonymous', // 允許畫面亮點掃描讀取像素
    },
  )
}

/**
 * Esri Ocean 海底地形（bathymetry）：免金鑰，覆蓋「開闊外海」——高解析空拍
 * 影像在外海是空的（黑），海底地形圖則畫出水深/海脊/淺灘，對海上作業(漁區、
 * 航道、暗礁)很有用。陸地為淡色地形。
 */
export function buildEsriOcean(): L.TileLayer {
  return L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}',
    {
      maxNativeZoom: 13,
      maxZoom: 19,
      attribution: 'Esri Ocean Basemap · GEBCO/NOAA',
      className: 'gibs-imagery',
      crossOrigin: 'anonymous',
    },
  )
}

/**
 * EOX Sentinel-2 cloudless：免金鑰、免註冊的「全球無雲真彩色」鑲嵌影像。
 * 由 Sentinel-2（10m）多時相合成去雲，畫面乾淨、放大到沿岸仍平滑清晰，
 * 沒有 MODIS 那種 250m 馬賽克。適合看海岸線/島礁/港口形狀。
 * 授權：Sentinel-2 cloudless by EOX（CC BY 4.0，含 Copernicus Sentinel data）。
 */
export function buildS2Cloudless(): L.TileLayer {
  // 用 KVP 形式的 WMTS，最穩定；年份用已發布的 2023 合成。
  const url =
    'https://tiles.maps.eox.at/wmts?layer=s2cloudless-2023_3857&style=default' +
    '&tilematrixset=GoogleMapsCompatible&Service=WMTS&Request=GetTile&Version=1.0.0' +
    '&Format=image%2Fjpeg&TileMatrix={z}&TileCol={x}&TileRow={y}'
  return L.tileLayer(url, {
    // s2cloudless 原生約到第 15–16 層（10m），再放大由 Leaflet 內插
    maxNativeZoom: 16,
    maxZoom: 19,
    attribution: 'Sentinel-2 cloudless 2023 © EOX IT Services（含 Copernicus 資料）',
    className: 'gibs-imagery',
    crossOrigin: 'anonymous',
  })
}

/** 真彩色圖層（MODIS Terra，每日更新）。 */
export function buildGibsTrueColor(date: string): L.TileLayer {
  const layer = 'MODIS_Terra_CorrectedReflectance_TrueColor'
  const url = `${GIBS_BASE}/${layer}/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`
  return L.tileLayer(url, {
    // MODIS 原生最高到第 9 層（約 250m），再放大由 Leaflet 內插
    maxNativeZoom: 9,
    maxZoom: 19,
    bounds: [
      [-85.05, -180],
      [85.05, 180],
    ],
    attribution: 'Imagery © NASA EOSDIS GIBS · MODIS',
    className: 'gibs-imagery',
    crossOrigin: 'anonymous',
  })
}

/**
 * VIIRS 夜間日夜帶（Day/Night Band, ENCC）——「漁火」圖層。免金鑰。
 *
 * 這是海上看外海漁船最實用的免費衛星圖：VIIRS 每晚約 01:30(當地)過境，
 * 把夜間微光放大成近似恆定對比，海面上一顆顆亮點就是「開燈作業的漁船/漁船隊」。
 * 大量魷釣、棒受網船隊在外海會連成一片光帶——AIS 看不到的關燈船看不到，但
 * 開燈作業的整支船隊一覽無遺。約 500m 解析，夜間才有意義（白天為地表反射）。
 *
 * 注意：是「夜影像」，套在彩色底圖上會偏暗，屬正常；建議搭配深色底圖看。
 * 影像有數小時延遲，故預設用前一天最保險。
 */
export function buildGibsBoatLights(date: string): L.TileLayer {
  const layer = 'VIIRS_SNPP_DayNightBand_ENCC'
  const url = `${GIBS_BASE}/${layer}/default/${date}/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png`
  return L.tileLayer(url, {
    maxNativeZoom: 8, // DNB 原生約 500m（第 8 層），再放大由 Leaflet 內插
    maxZoom: 19,
    opacity: 0.9,
    bounds: [
      [-85.05, -180],
      [85.05, 180],
    ],
    attribution: 'NASA EOSDIS GIBS · VIIRS Day/Night Band（夜間漁火）',
    className: 'gibs-imagery',
    crossOrigin: 'anonymous',
  })
}

/**
 * VIIRS（NOAA-20）每日真彩色，等同 NASA Worldview 的每日影像。感測器較新、
 * 畫面常比 MODIS 乾淨；一樣全球覆蓋含外海、免金鑰。約 375m。
 */
export function buildGibsViirs(date: string): L.TileLayer {
  const layer = 'VIIRS_NOAA20_CorrectedReflectance_TrueColor'
  const url = `${GIBS_BASE}/${layer}/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`
  return L.tileLayer(url, {
    maxNativeZoom: 9,
    maxZoom: 19,
    bounds: [
      [-85.05, -180],
      [85.05, 180],
    ],
    attribution: 'Imagery © NASA EOSDIS GIBS · VIIRS NOAA-20',
    className: 'gibs-imagery',
    crossOrigin: 'anonymous',
  })
}
