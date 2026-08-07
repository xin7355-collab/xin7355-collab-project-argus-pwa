import L from 'leaflet'
import { getConfig, isSentinelConfigured } from './config'
import { LAYERS } from './sentinel'

// ── 底圖圖層 ────────────────────────────────────────────────
//
// dark：CARTO dark_matter 戰術暗色（英文標註、全球）。
// nlsc：內政部國土測繪中心「通用版電子地圖」——繁體中文地名，官方免費，
//        涵蓋台灣及周邊海域（遠洋無資料）。海上看得懂中文地名。
// nlscPhoto：NLSC 正射影像＋中文注記（衛星底＋中文地名）。
// esri：Esri World Imagery 高解析空拍（免金鑰）——沿岸/港口最銳利，可見大船。
// sentinel2：Sentinel-2 真彩「近期最新」（需 Instance ID）——看某段期間海上大船。
// sentinel1：Sentinel-1 SAR「近期最新」（需 Instance ID）——雷達，穿雲/夜間看船。

export type BaseLayerId = 'dark' | 'nlsc' | 'nlscPhoto' | 'satColor' | 'esri' | 'sentinel2' | 'sentinel1'

export const BASE_LABELS: Record<BaseLayerId, string> = {
  dark: '戰術暗色（英文）',
  nlsc: '中文電子地圖（NLSC）',
  nlscPhoto: '中文衛星混合（NLSC）',
  satColor: '彩色衛星（無雲 · 含外海 10m）',
  esri: '高解析空拍（Esri · 免金鑰）',
  sentinel2: 'Sentinel-2 真彩（近期 · 看船）',
  sentinel1: 'Sentinel-1 雷達（近期 · 穿雲夜視看船）',
}

/** 需要 Sentinel Instance ID 才能用的底圖。 */
export const SENTINEL_BASES: BaseLayerId[] = ['sentinel2', 'sentinel1']

/** 近 N 天的 ISO 時間區間（Sentinel Hub WMS 會回傳區間內最新影像鑲嵌）。 */
function recentRange(days: number): string {
  const end = new Date()
  const start = new Date(end.valueOf() - days * 86400000)
  const f = (d: Date) => d.toISOString().slice(0, 10)
  return `${f(start)}/${f(end)}`
}

/** Sentinel Hub WMS 「近期最新」底圖（不透明，當主底圖用）。 */
function sentinelBase(layer: string, opts: { days: number; maxcc?: number }): L.TileLayer {
  const cfg = getConfig()
  const url = `${cfg.sentinelWmsUrl}/${cfg.sentinelInstanceId || 'MISSING_INSTANCE_ID'}`
  const params: Record<string, string | number | boolean> = {
    layers: layer,
    format: 'image/jpeg',
    transparent: false,
    version: '1.3.0',
    time: recentRange(opts.days),
  }
  if (typeof opts.maxcc === 'number') params.maxcc = opts.maxcc
  return L.tileLayer.wms(url, { ...params, maxZoom: 18, attribution: '© Copernicus / Sentinel Hub' } as L.WMSOptions)
}

export function buildBaseLayer(id: BaseLayerId): L.TileLayer {
  if (id === 'satColor') {
    // Sentinel-2 cloudless（EOX）：全球連續、無雲、含外海的 10m 彩色鑲嵌，
    // 當「主底圖」讓 AIS 船位/雷達/漁火/漂流全疊在真實影像上。
    // 選它的關鍵：不像 Esri 在外海/內陸偏遠處會出現白色「無資料」佔位塊——
    // 這是全球完整鑲嵌，外海也有圖；超過原生 16 層時平滑放大（會糊不會白）。
    const url =
      'https://tiles.maps.eox.at/wmts?layer=s2cloudless-2023_3857&style=default' +
      '&tilematrixset=GoogleMapsCompatible&Service=WMTS&Request=GetTile&Version=1.0.0' +
      '&Format=image%2Fjpeg&TileMatrix={z}&TileCol={x}&TileRow={y}'
    return L.tileLayer(url, {
      maxNativeZoom: 16,
      maxZoom: 20,
      attribution: 'Sentinel-2 cloudless 2023 © EOX（含 Copernicus 資料）',
    })
  }
  if (id === 'esri') {
    // Esri World Imagery：免金鑰高解析空拍，沿岸/港口最清楚（部分地區可見大船），
    // 但屬「鑲嵌」（非單一日期）；遠洋偏遠處可能較糊。
    return L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 20, maxNativeZoom: 19, attribution: 'Esri World Imagery' },
    )
  }
  if (id === 'sentinel2') {
    // 近 120 天最新、低雲的 Sentinel-2 真彩（大船呈白色亮點/短條）
    if (!isSentinelConfigured()) return buildBaseLayer('dark')
    return sentinelBase(LAYERS.opticalTrueColor, { days: 120, maxcc: 40 })
  }
  if (id === 'sentinel1') {
    // 近 30 天最新 Sentinel-1 SAR（金屬船體＝亮點；穿雲、夜間可用）
    if (!isSentinelConfigured()) return buildBaseLayer('dark')
    return sentinelBase(LAYERS.sarVV, { days: 30 })
  }
  if (id === 'nlsc') {
    return L.tileLayer('https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}', {
      maxZoom: 20,
      attribution: '© 內政部國土測繪中心 NLSC',
      // NLSC 只涵蓋台灣周邊，遠洋無圖磚；底下墊深色避免全白。
    })
  }
  if (id === 'nlscPhoto') {
    return L.tileLayer(
      'https://wmts.nlsc.gov.tw/wmts/PHOTO_MIX/default/GoogleMapsCompatible/{z}/{y}/{x}',
      {
        maxZoom: 20,
        attribution: '© 內政部國土測繪中心 NLSC（正射影像＋中文注記）',
      },
    )
  }
  // dark（預設）
  return L.tileLayer('https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', {
    maxZoom: 19,
    detectRetina: false,
    className: 'base-tiles-tactical',
    attribution: '© OpenStreetMap © CARTO',
  })
}
