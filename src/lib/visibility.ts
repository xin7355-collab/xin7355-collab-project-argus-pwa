// ── 能見度 / 霧況（visibility，Open-Meteo，免金鑰）──────────────
//
// 抓當前視野網格的即時能見度(公尺)，把霧/低能見海域上色。對海上：能見度直接
// 決定瞭望哨與艦艇的「目視偵蒐距離」——濃霧時非法越界/可疑運輸最愛，雷達與 AIS 更關鍵。

export interface VisResult {
  visM: number
  label: string
  color: string
}

/** 能見度分級（公尺）→ 文字＋顏色（越糊越紅）。 */
export function classifyVisibility(visM: number): VisResult {
  if (visM < 1000) return { visM, label: '濃霧 <1km', color: '#f43f5e' }
  if (visM < 4000) return { visM, label: '低能見 1–4km', color: '#fb923c' }
  if (visM < 10000) return { visM, label: '中等 4–10km', color: '#eab308' }
  return { visM, label: '良好 >10km', color: '#34d399' }
}

/**
 * 抓一組座標的即時能見度(公尺)。Open-Meteo 多座標以逗號串接，回傳陣列。
 * 注意：visibility 是「hourly」變數（非 current），故抓 hourly 再取「現在這一小時」。
 * 查不到的點回 null。失敗 throw，呼叫端自行處理。
 */
export async function fetchVisibilityGrid(pts: [number, number][]): Promise<(number | null)[]> {
  if (!pts.length) return []
  const lats = pts.map((p) => p[0].toFixed(4)).join(',')
  const lngs = pts.map((p) => p[1].toFixed(4)).join(',')
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lngs}` +
    `&hourly=visibility&forecast_days=1&timezone=UTC`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 15000)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) throw new Error('visibility ' + res.status)
    const j = await res.json()
    const arr = Array.isArray(j) ? j : [j] // 單點回物件、多點回陣列
    // 現在這一小時（UTC，"YYYY-MM-DDTHH"）；time 陣列各點相同，取第一點對出索引
    const nowHour = new Date().toISOString().slice(0, 13)
    const times: unknown[] = arr[0]?.hourly?.time ?? []
    let idx = times.findIndex((t) => typeof t === 'string' && t.slice(0, 13) === nowHour)
    if (idx < 0) idx = 0 // 對不到就退回第一筆（今天 00:00）
    return pts.map((_, i) => {
      const v = arr[i]?.hourly?.visibility?.[idx]
      return typeof v === 'number' && Number.isFinite(v) ? v : null
    })
  } finally {
    clearTimeout(timer)
  }
}
