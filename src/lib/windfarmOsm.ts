// ── OSM 即時離岸風電場邊界（合併「精準邊界 + 中文名 + 向量常駐」）──────
//
// 使用者回饋：自建示意離岸風電場位置不如航海標記(OpenSeaMap＝OSM 資料)精準，但
// 航海標記無中文、且縮小到約 50km 就沒圖(OSM 海圖磚低縮放不渲染)。
// 解法：直接抓 OSM 同一份離岸風電場邊界(Overpass)，以 Leaflet 向量畫出(任何縮放都在)，
// 再就近套上我方中文名。抓不到就退回內建示意(maritimeRef)。
//
// 註：Overpass 支援瀏覽器 CORS；本抓取在使用者手機端執行(非開發沙箱)。

import { WIND_FARMS } from './maritimeRef'

export interface OsmWindFarm {
  name: string
  status: string
  ring: [number, number][]
  center: [number, number]
}

const BBOX = '22.4,119.2,25.7,121.8' // 台灣西部外海
const QUERY =
  `[out:json][timeout:60];(` +
  `way["power"="plant"]["plant:source"="wind"](${BBOX});` +
  `relation["power"="plant"]["plant:source"="wind"](${BBOX});` +
  `way["seamark:type"="wind_farm"](${BBOX});` +
  `relation["seamark:type"="wind_farm"](${BBOX});` +
  `);out geom;`

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]

function km(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = (bLat - aLat) * 111
  const dLng = (bLng - aLng) * 111 * Math.cos((aLat * Math.PI) / 180)
  return Math.hypot(dLat, dLng)
}

/** 就近把 OSM 離岸風電場對應到我方中文名（18km 內視為同一座）。 */
function chineseNameFor(lat: number, lng: number, osmName?: string): { name: string; status: string } {
  let best: (typeof WIND_FARMS)[number] | null = null
  let bestD = Infinity
  for (const wf of WIND_FARMS) {
    const d = km(lat, lng, wf.lat, wf.lng)
    if (d < bestD) {
      bestD = d
      best = wf
    }
  }
  if (best && bestD < 18) return { name: best.name, status: best.status }
  return { name: osmName || '離岸風電場', status: '' }
}

type Geom = { lat: number; lon: number }

function ringOf(el: {
  type: string
  geometry?: Geom[]
  members?: { role: string; geometry?: Geom[] }[]
}): [number, number][] | null {
  if (el.type === 'way' && Array.isArray(el.geometry)) {
    return el.geometry.map((g) => [g.lat, g.lon] as [number, number])
  }
  if (el.type === 'relation' && Array.isArray(el.members)) {
    // 外環可能被切成多段 outer way——全部串接。
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

/** 抓 OSM 台灣離岸風電場邊界；失敗回空陣列（呼叫端退回內建示意）。 */
export async function fetchWindFarmsOsm(): Promise<OsmWindFarm[]> {
  for (const ep of ENDPOINTS) {
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 12000)
      const res = await fetch(ep, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(QUERY),
        signal: ctrl.signal,
      })
      clearTimeout(timer)
      if (!res.ok) continue
      const data = await res.json()
      const out: OsmWindFarm[] = []
      for (const el of data.elements ?? []) {
        const ring = ringOf(el)
        if (!ring || ring.length < 3) continue
        let la = 0
        let lo = 0
        for (const p of ring) {
          la += p[0]
          lo += p[1]
        }
        const center: [number, number] = [la / ring.length, lo / ring.length]
        const tags = el.tags ?? {}
        const nm = chineseNameFor(center[0], center[1], tags['name:zh'] || tags.name || tags['seamark:name'])
        out.push({ name: nm.name, status: nm.status, ring, center })
      }
      if (out.length) return out
    } catch {
      /* try next endpoint */
    }
  }
  return []
}
