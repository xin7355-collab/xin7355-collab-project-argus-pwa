// ── 免費衛星「最新過境」深連結 ──────────────────────────────
//
// 誠實現況：沒有任何「免費、即時、高解析」的衛星能穩定看到一艘小型漂流船。
// 但把「此位置＋日期」一鍵丟進各大免費衛星檔案瀏覽器，就能人工翻最新過境影像。
// 這等於把「全部免費衛星」（Sentinel-1 雷達 / Sentinel-2 / Landsat / VIIRS / MODIS）
// 的完整解析度都聚焦到你的搜救點——比在 App 內硬塞低解析圖磚實用得多。

export interface SatLink {
  icon: string
  label: string
  sub: string
  url: string
}

function ymd(t: number): string {
  return new Date(t).toISOString().slice(0, 10)
}

/**
 * 產生聚焦於 (lat,lng) 的免費衛星查詢連結。
 * 有給 date（YYYY-MM-DD）時，連結會鎖定「那一天前後」，方便看「當時影像」；
 * Sentinel 約每 5 天過境一次，故給 Copernicus 一個 [date-3d, date+1d] 視窗，
 * 讓它落在最接近該日的可用過境。
 */
export function satelliteLinks(lat: number, lng: number, date?: string): SatLink[] {
  const today = new Date().toISOString().slice(0, 10)
  const d = date || today
  const hasDate = Boolean(date)
  const la = lat.toFixed(4)
  const lo = lng.toFixed(4)
  const w = (lng - 1.3).toFixed(3)
  const s = (lat - 1.0).toFixed(3)
  const e = (lng + 1.3).toFixed(3)
  const n = (lat + 1.0).toFixed(3)

  // Copernicus 時間視窗（鎖定選定日期附近的過境）
  const base = Date.parse(`${d}T12:00:00Z`)
  const from = ymd(base - 3 * 86400000)
  const to = ymd(base + 1 * 86400000)
  const timeQ = Number.isFinite(base)
    ? `&fromTime=${from}T00:00:00.000Z&toTime=${to}T23:59:59.999Z`
    : ''

  return [
    {
      icon: '📡',
      label: 'Copernicus 瀏覽器（雷達）',
      sub: hasDate
        ? `鎖定 ${d} 前後過境：Sentinel-1 雷達＋Sentinel-2 光學，全解析免費`
        : 'Sentinel-1 雷達＋Sentinel-2 光學。看金屬船體最實際，選最新過境、全解析、免費',
      url: `https://browser.dataspace.copernicus.eu/?zoom=11&lat=${la}&lng=${lo}${timeQ}`,
    },
    {
      icon: '🌎',
      label: 'NASA Worldview（每日）',
      sub: hasDate
        ? `直接顯示 ${d} 當日 VIIRS/MODIS 全球真彩色（可左右拉日期比對）`
        : 'VIIRS/MODIS 每日真彩色＋Landsat。拉時間軸逐日看雲況與大範圍變化',
      url: `https://worldview.earthdata.nasa.gov/?v=${w},${s},${e},${n}&t=${d}`,
    },
    {
      icon: '🚢',
      label: 'MarineTraffic（AIS）',
      sub: '附近有 AIS 的船位。可調度就近船隻前往目視協尋（漂流船本身多半無 AIS）',
      url: `https://www.marinetraffic.com/en/ais/home/centerx:${lo}/centery:${la}/zoom:10`,
    },
  ]
}
