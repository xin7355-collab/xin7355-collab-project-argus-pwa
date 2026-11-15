// ── 夜間漁火圖層挑選（純函式，可離線測）────────────────────

/**
 * 夜間漁火要用哪個 GIBS 圖層（依日期）。
 *
 * 以前一律用 VIIRS_SNPP_DayNightBand_ENCC，但 NASA 這個圖層只到 2023-07-07 就沒資料了
 * （2026-11 讀 GIBS 目錄實測），之後這個圖層一直是空的。Suomi NPP 整個系列也在 2026-11-02 停止供圖。
 * 實際抓東海、台灣海峽的圖磚比較（同一晚）：
 *   - NOAA-20 At_Sensor_Radiance：海面全黑、漁船是一顆顆亮點 → 最適合看漁火（2024-03-25 起有）
 *   - NOAA-20／21 DayNightBand：整片海偏亮（月光、雲），亮點分不出來 → 只拿來補空窗
 * 所以：近期用 NOAA-20 輻射亮度；2023-07-07 以前用原本的 SNPP ENCC；中間沒有更好的就用 NOAA-20 DayNightBand。
 */
export function boatLightsLayerFor(date: string): { id: string; level: 7 | 8 } {
  if (date >= '2024-03-25') return { id: 'VIIRS_NOAA20_DayNightBand_At_Sensor_Radiance', level: 8 }
  if (date <= '2023-07-07') return { id: 'VIIRS_SNPP_DayNightBand_ENCC', level: 8 }
  return { id: 'VIIRS_NOAA20_DayNightBand', level: 7 }
}
