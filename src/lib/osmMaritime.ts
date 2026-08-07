// ── OSM 即時海事圖資（航道 / 沙洲淺灘 / 海底電纜）──────────────
//
// 與離岸風電場同法：手機端直接向 Overpass 抓 OpenStreetMap 向量資料，任何縮放都在，
// 不像海圖磚(OpenSeaMap)縮小就消失。抓不到就退回內建示意(呼叫端處理)。
//
// 對海上：航道＝船流動線；沙洲＝擱淺危險(常變動堆積)；海底電纜＝保護區/
// 禁拋錨、破壞事件熱點(近年常有越界船錨損電纜)。

const BBOX = '21.2,117.2,26.9,123.4' // 台灣本島＋海峽＋外島

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]

type Geom = { lat: number; lon: number }
interface OsmEl {
  type: string
  tags?: Record<string, string>
  geometry?: Geom[]
  members?: { role: string; geometry?: Geom[] }[]
}

export interface OsmFeature {
  name?: string
  coords: [number, number][]
  /** 首尾相接＝面（沙洲），否則＝線（航道/電纜）。 */
  closed: boolean
}

async function overpass(query: string): Promise<OsmEl[]> {
  for (const ep of ENDPOINTS) {
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 12000)
      const res = await fetch(ep, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
        signal: ctrl.signal,
      })
      clearTimeout(timer)
      if (!res.ok) continue
      const data = await res.json()
      if (Array.isArray(data.elements) && data.elements.length) return data.elements
    } catch {
      /* try next */
    }
  }
  return []
}

function coordsOf(el: OsmEl): [number, number][] | null {
  if (el.type === 'way' && Array.isArray(el.geometry)) {
    return el.geometry.map((g) => [g.lat, g.lon] as [number, number])
  }
  if (el.type === 'relation' && Array.isArray(el.members)) {
    // 多邊形 relation 的外環可能被切成多段 outer way——全部串接，避免只畫到一段。
    const out: [number, number][] = []
    for (const m of el.members) {
      if (m.role === 'outer' && Array.isArray(m.geometry)) {
        for (const g of m.geometry) out.push([g.lat, g.lon])
      }
    }
    return out.length ? out : null
  }
  return null
}

async function fetchFeatures(query: string): Promise<OsmFeature[]> {
  const els = await overpass(query)
  const out: OsmFeature[] = []
  for (const el of els) {
    const coords = coordsOf(el)
    if (!coords || coords.length < 2) continue
    const a = coords[0]
    const b = coords[coords.length - 1]
    const closed = coords.length >= 4 && Math.abs(a[0] - b[0]) < 0.001 && Math.abs(a[1] - b[1]) < 0.001
    const t = el.tags ?? {}
    out.push({ name: t['name:zh'] || t.name || t['seamark:name'], coords, closed })
  }
  return out
}

/** 航道 / 分道通航（TSS）。 */
export function fetchFairways(): Promise<OsmFeature[]> {
  const q =
    `[out:json][timeout:60];(` +
    `way["seamark:type"="fairway"](${BBOX});` +
    `way["seamark:type"="recommended_track"](${BBOX});` +
    `way["seamark:type"="navigation_line"](${BBOX});` +
    `way["seamark:type"="separation_lane"](${BBOX});` +
    `way["seamark:type"="separation_boundary"](${BBOX});` +
    `way["seamark:type"="separation_zone"](${BBOX});` +
    `relation["seamark:type"="separation_zone"](${BBOX});` +
    `);out geom;`
  return fetchFeatures(q)
}

/** 海底電纜。 */
export function fetchCables(): Promise<OsmFeature[]> {
  const q =
    `[out:json][timeout:60];(` +
    `way["seamark:type"="cable_submarine"](${BBOX});` +
    `way["man_made"="submarine_cable"](${BBOX});` +
    `way["man_made"="cable"]["location"="underwater"](${BBOX});` +
    `way["communication:medium"="fibre"]["submarine"="yes"](${BBOX});` +
    `);out geom;`
  return fetchFeatures(q)
}

/** 沙洲 / 淺灘 / 潮間灘地。 */
export function fetchShoals(): Promise<OsmFeature[]> {
  const q =
    `[out:json][timeout:60];(` +
    `way["natural"="shoal"](${BBOX});` +
    `relation["natural"="shoal"](${BBOX});` +
    `way["natural"="beach"](${BBOX});` +
    `way["wetland"="tidalflat"](${BBOX});` +
    `relation["wetland"="tidalflat"](${BBOX});` +
    `way["seamark:type"="seabed_area"](${BBOX});` +
    `);out geom;`
  return fetchFeatures(q)
}
