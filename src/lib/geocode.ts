// ── 地址 / 景點 搜尋（免金鑰地理編碼）──────────────────────
//
// 主要用 OpenStreetMap Nominatim：免金鑰、支援 CORS、涵蓋全球含台灣門牌/景點。
// 使用政策每秒至多 1 次——App 只在「按搜尋/Enter」時查詢，不做逐字即時查。
//
// 以前只有 Nominatim 一家：它忙（429）或連不上就整個不能搜。改成：
//   1. 查過的字留 5 分鐘（找不到的只留 30 秒，剛建的地名才不會一直查不到）——
//      同一個地名來回查，不用每次連網，也不會撞到每秒一次的限制。
//   2. Nominatim 失敗或沒結果，改問 Photon（komoot 架的 OSM 搜尋，免金鑰、有 CORS、
//      模糊比對比較寬鬆，打錯字也常找得到）。
// 失敗才丟錯；兩家都說「沒有」才回空陣列。fetch／時鐘可注入，離線可測。

export interface GeoResult {
  label: string
  lat: number
  lng: number
  kind?: string
}

export interface GeocodeOpts {
  /** 偏向這附近的結果（目前地圖中心）。Photon 用；Nominatim 固定偏台灣。 */
  near?: { lat: number; lng: number }
  fetchImpl?: typeof fetch
  now?: () => number
}

const HIT_TTL_MS = 5 * 60_000
const MISS_TTL_MS = 30_000
const CACHE_MAX = 64
const cache = new Map<string, { at: number; results: GeoResult[] }>()

/** 測試用：清掉快取。 */
export function resetGeocodeCache(): void {
  cache.clear()
}

const finite = (r: GeoResult) => Number.isFinite(r.lat) && Number.isFinite(r.lng)

async function nominatim(query: string, doFetch: typeof fetch): Promise<GeoResult[]> {
  const params = new URLSearchParams({
    format: 'jsonv2',
    q: query,
    limit: '8',
    'accept-language': 'zh-TW',
    // 台灣周邊加權（非硬限制），命中率較高
    viewbox: '118.0,26.5,124.0,21.0',
    bounded: '0',
  })
  const res = await doFetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(res.status === 429 ? 'Nominatim 限流' : `Nominatim HTTP ${res.status}`)
  const arr = (await res.json()) as Array<{
    display_name?: string
    name?: string
    lat?: string
    lon?: string
    type?: string
    addresstype?: string
  }>
  if (!Array.isArray(arr)) throw new Error('Nominatim 回應格式不對')
  return arr
    .map((r) => ({
      label: r.name || r.display_name || '(未命名)',
      lat: parseFloat(r.lat ?? ''),
      lng: parseFloat(r.lon ?? ''),
      kind: r.addresstype || r.type,
    }))
    .filter(finite)
}

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] }
  properties?: Record<string, string | undefined>
}

async function photon(query: string, doFetch: typeof fetch, near?: { lat: number; lng: number }): Promise<GeoResult[]> {
  const params = new URLSearchParams({ q: query, limit: '8' })
  if (near) {
    params.set('lat', near.lat.toFixed(3))
    params.set('lon', near.lng.toFixed(3))
  }
  const res = await doFetch(`https://photon.komoot.io/api/?${params.toString()}`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`Photon HTTP ${res.status}`)
  const j = (await res.json()) as { features?: PhotonFeature[] }
  if (!Array.isArray(j?.features)) throw new Error('Photon 回應格式不對')
  return j.features
    .map((f) => {
      const p = f.properties ?? {}
      const [lng, lat] = f.geometry?.coordinates ?? [NaN, NaN]
      const street = [p.street, p.housenumber].filter(Boolean).join('')
      const main = p.name || street || p.city || '(未命名)'
      // 補上所在城市，同名的地方才分得出來（「中正路」全台到處都有）
      const where = [p.city, p.county, p.state].find((x) => x && x !== main)
      return { label: where ? `${main}（${where}）` : main, lat, lng, kind: p.osm_value || p.type }
    })
    .filter(finite)
}

/**
 * 搜尋地址/地名/景點，回傳最多 8 筆候選。偏向台灣但不限台灣，
 * 這樣「檢查據點、港口、景點」都找得到。兩家都連不上才丟錯，UI 顯示訊息。
 */
export async function geocode(q: string, opts: GeocodeOpts = {}): Promise<GeoResult[]> {
  const query = q.trim().replace(/\s+/g, ' ')
  if (!query) return []
  const doFetch = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
  const now = opts.now ?? (() => Date.now())
  const key = query.toLowerCase()

  const hit = cache.get(key)
  if (hit && now() - hit.at < (hit.results.length ? HIT_TTL_MS : MISS_TTL_MS)) return hit.results

  const errors: string[] = []
  let results: GeoResult[] | null = null
  try {
    results = await nominatim(query, doFetch)
  } catch (e) {
    errors.push(e instanceof Error ? e.message : 'Nominatim 連不上')
  }
  if (!results || results.length === 0) {
    try {
      const alt = await photon(query, doFetch, opts.near)
      // Nominatim 說沒有、Photon 找到 → 用 Photon；兩家都說沒有 → 真的沒有
      if (alt.length > 0 || results === null) results = alt
    } catch (e) {
      errors.push(e instanceof Error ? e.message : 'Photon 連不上')
    }
  }
  if (results === null) {
    throw new Error(`地名搜尋連不上（${errors.join('、')}）。座標不用連網，可以直接輸入，例如「25.13, 121.74」`)
  }

  cache.delete(key)
  cache.set(key, { at: now(), results })
  // Map 依加入順序排：超過上限就丟最舊的
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string)
  return results
}

// ── Google Maps 深連結（免金鑰，開外部 App/網頁）───────────────
/** Google Maps 顯示座標地標。 */
export function gmapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lng.toFixed(6)}`
}

/** Google Maps 導航到座標（起點＝使用者目前位置）。 */
export function gmapsNavUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(6)},${lng.toFixed(6)}`
}

/** 在新分頁開啟 Google Maps（顯示座標或導航）。 */
export function openGmaps(lat: number, lng: number, nav = false): void {
  window.open(nav ? gmapsNavUrl(lat, lng) : gmapsUrl(lat, lng), '_blank', 'noopener,noreferrer')
}
