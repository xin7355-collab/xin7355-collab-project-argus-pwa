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
  /** 場內風機（若查得到）。用於雷達遮蔽與 Doppler 雜波研判。 */
  turbines?: WindTurbine[]
  /** 場內風機葉尖高度中位數(m)；查不到高度標籤時為 undefined。 */
  tipHeightM?: number
}

/** 單支風機。OSM 標籤覆蓋率不一，height/rotor 可能缺。 */
export interface WindTurbine {
  lat: number
  lng: number
  /** 塔架高(m)，OSM `height`。 */
  heightM?: number
  /** 轉子直徑(m)，OSM `rotor:diameter`。 */
  rotorM?: number
}

/**
 * 葉尖高度(m) = 塔架高 + 轉子半徑。這才是雷達遮蔽該用的高度——
 * 只用塔架高會低估，因為葉片轉到最高點時比塔頂還高一個半徑。
 * 兩者皆缺時回 undefined（不猜），由呼叫端決定要不要用預設值。
 */
export function tipHeight(t: WindTurbine): number | undefined {
  if (t.heightM == null && t.rotorM == null) return undefined
  const h = t.heightM ?? 0
  const r = (t.rotorM ?? 0) / 2
  return h + r || undefined
}

const BBOX = '22.4,119.2,25.7,121.8' // 台灣西部外海
const QUERY =
  `[out:json][timeout:60];(` +
  `way["power"="plant"]["plant:source"="wind"](${BBOX});` +
  `relation["power"="plant"]["plant:source"="wind"](${BBOX});` +
  `way["seamark:type"="wind_farm"](${BBOX});` +
  `relation["seamark:type"="wind_farm"](${BBOX});` +
  `);out geom;`

/**
 * 單支風機查詢。OSM 上離岸風機多為 node，少數以 way 描繪基座。
 * 取 height 與 rotor:diameter 以推算葉尖高度（雷達遮蔽要用的是葉尖高，非塔架高）。
 */
const TURBINE_QUERY =
  `[out:json][timeout:60];(` +
  `node["power"="generator"]["generator:source"="wind"](${BBOX});` +
  `way["power"="generator"]["generator:source"="wind"](${BBOX});` +
  `);out center tags;`

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

/** 解析 OSM 的長度標籤（可能寫成 "120"、"120 m"、"120m"）。 */
function parseLenM(v: unknown): number | undefined {
  if (typeof v !== 'string' && typeof v !== 'number') return undefined
  const n = parseFloat(String(v))
  return Number.isFinite(n) && n > 0 ? n : undefined
}

/** 抓 OSM 單支風機（含高度標籤）；失敗回空陣列。 */
export async function fetchWindTurbinesOsm(): Promise<WindTurbine[]> {
  for (const ep of ENDPOINTS) {
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 15000)
      const res = await fetch(ep, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(TURBINE_QUERY),
        signal: ctrl.signal,
      })
      clearTimeout(timer)
      if (!res.ok) continue
      const data = await res.json()
      const out: WindTurbine[] = []
      for (const el of data.elements ?? []) {
        // node 直接有 lat/lon；way 用 out center 取得 center.lat/lon
        const la = el.lat ?? el.center?.lat
        const lo = el.lon ?? el.center?.lon
        if (typeof la !== 'number' || typeof lo !== 'number') continue
        const tags = el.tags ?? {}
        out.push({
          lat: la,
          lng: lo,
          heightM: parseLenM(tags.height),
          rotorM: parseLenM(tags['rotor:diameter']),
        })
      }
      if (out.length) return out
    } catch {
      /* try next endpoint */
    }
  }
  return []
}

/**
 * 把風機併入所屬風場（取離場中心最近者，門檻 25km），並算出該場葉尖高度中位數。
 * 用中位數而非平均：OSM 偶有明顯離譜的標註，中位數比較耐髒資料。
 */
export function attachTurbines(farms: OsmWindFarm[], turbines: WindTurbine[]): OsmWindFarm[] {
  if (!farms.length || !turbines.length) return farms
  return farms.map((f) => {
    const mine = turbines.filter((t) => km(t.lat, t.lng, f.center[0], f.center[1]) < 25)
    const tips = mine.map(tipHeight).filter((x): x is number => x != null).sort((a, b) => a - b)
    const tipHeightM = tips.length ? tips[Math.floor(tips.length / 2)] : undefined
    return { ...f, turbines: mine, tipHeightM }
  })
}
