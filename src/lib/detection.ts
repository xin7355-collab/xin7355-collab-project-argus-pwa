// ── 偵測目標的標注（分類 + AIS 比對）──────────────────────
//
// 把「亮點」升級為「有框、有標籤、有 AIS 比對」的目標，讓值班可快速分流，
// 不必逐一肉眼判讀。重點戰術價值：自動標出「影像上有、但沒有 AIS 訊號」的
// 目標（可疑/dark target），紅框優先查；有對到 AIS 的綠框視為已知。
//
// 誠實定位：這是「輔助分流/優先排序」，不是「確認身分」；免費影像無法確認
// 船種，最終仍需雷達或目視。

export interface Detection {
  lat: number
  lng: number
  score: number
  /** 邊界框（地理）。 */
  south: number
  west: number
  north: number
  east: number
  /** 估計目標尺度（公尺，對角線）。 */
  sizeM: number
  /** 尺度分類文字。 */
  cls: string
  /** AIS 比對結果。 */
  ais: 'known' | 'none' | 'na'
  aisName?: string
}

/** 依估計尺度給分類文字（粗略、附疑似字樣）。 */
export function classifyBySize(sizeM: number): string {
  if (sizeM < 25) return '小型目標（疑似小船/浮標）'
  if (sizeM < 80) return '中型目標（疑似漁船/快艇）'
  if (sizeM < 200) return '大型目標（疑似大船）'
  return '大範圍亮區（疑似島礁/雲/浪）'
}

const R = 6371000
const DEG = Math.PI / 180
export function distM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const a =
    Math.sin(((lat2 - lat1) * DEG) / 2) ** 2 +
    Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(((lng2 - lng1) * DEG) / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

/**
 * 對一個偵測點做 AIS 比對：若最近的 AIS 船在 thresholdM 內 → known，否則 none。
 * aisConfigured=false（未設真實 AIS）時回 'na'（不比對）。
 */
export function matchAis(
  lat: number,
  lng: number,
  vessels: { lat: number; lng: number; name?: string }[],
  aisConfigured: boolean,
  thresholdM = 800,
): { ais: 'known' | 'none' | 'na'; aisName?: string } {
  if (!aisConfigured) return { ais: 'na' }
  let best: { d: number; name?: string } | null = null
  for (const v of vessels) {
    const d = distM(lat, lng, v.lat, v.lng)
    if (!best || d < best.d) best = { d, name: v.name }
  }
  if (best && best.d <= thresholdM) return { ais: 'known', aisName: best.name }
  return { ais: 'none' }
}
