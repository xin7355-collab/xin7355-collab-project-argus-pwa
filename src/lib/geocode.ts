// ── 地址 / 景點 搜尋（免金鑰地理編碼）──────────────────────
//
// 用 OpenStreetMap Nominatim：免金鑰、支援 CORS、涵蓋全球含台灣門牌/景點。
// 使用政策：每秒至多 1 次——故 App 只在「按搜尋/Enter」時查詢，不做逐字即時查。

export interface GeoResult {
  label: string
  lat: number
  lng: number
  kind?: string
}

/**
 * 搜尋地址/地名/景點，回傳最多 8 筆候選。偏向台灣（viewbox 加權）但不限台灣，
 * 這樣「檢查據點、港口、景點」都找得到。失敗時丟錯，UI 顯示訊息。
 */
export async function geocode(q: string): Promise<GeoResult[]> {
  const query = q.trim()
  if (!query) return []
  const params = new URLSearchParams({
    format: 'jsonv2',
    q: query,
    limit: '8',
    'accept-language': 'zh-TW',
    // 台灣周邊加權（非硬限制），命中率較高
    viewbox: '118.0,26.5,124.0,21.0',
    bounded: '0',
  })
  const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`搜尋服務回應 ${res.status}`)
  const arr = (await res.json()) as Array<{
    display_name?: string
    name?: string
    lat?: string
    lon?: string
    type?: string
    addresstype?: string
  }>
  return arr
    .map((r) => ({
      label: r.name || r.display_name || '(未命名)',
      lat: parseFloat(r.lat ?? ''),
      lng: parseFloat(r.lon ?? ''),
      kind: r.addresstype || r.type,
    }))
    .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng))
}
