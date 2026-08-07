// ── CWA 海象：潮汐 + 海面天氣/波浪 ──────────────────────────
//
// 透過既有 Worker 代理呼叫 CWA Open Data，補上 Open-Meteo 沒有的「在地官方」
// 潮汐與海面預報。全部防禦性解析：欄位對不上就回 null，UI 自動退回原本的
// 免金鑰資料，永不崩壞。CWA 各資料集 JSON 命名不一，故用寬鬆/遞迴擷取。

import { fetchCwaJson } from './cwa'

function num(v: unknown, d = NaN): number {
  const x = typeof v === 'string' ? parseFloat(v) : (v as number)
  return Number.isFinite(x) ? x : d
}
function toArr(x: any): any[] {
  if (x === undefined || x === null) return []
  return Array.isArray(x) ? x : [x]
}

// ── 潮汐 F-A0021-001（未來1個月潮汐預報）─────────────────────
export interface TideEvent {
  time: number
  /** 滿潮 / 乾潮（原文照抄）。 */
  type: string
  /** 潮高（cm，相對當地平均潮面或 TWVD）。 */
  heightCm: number | null
  station: string
}

export async function fetchCwaTide(lat: number, lng: number): Promise<TideEvent[] | null> {
  let data: any
  try {
    data = await fetchCwaJson('F-A0021-001')
  } catch {
    return null
  }
  try {
    const locs = toArr(
      data?.records?.TideForecasts ??
        data?.records?.tideForecasts ??
        data?.records?.Location ??
        data?.records?.location,
    )
    if (!locs.length) return null

    // 找最近的潮位站/縣市（用經緯度平方距離）
    let best: { loc: any; entry: any } | null = null
    let bestD = Infinity
    for (const entry of locs) {
      const loc = entry.Location ?? entry.location ?? entry
      const la = num(loc?.Latitude ?? loc?.latitude)
      const lo = num(loc?.Longitude ?? loc?.longitude)
      if (!Number.isFinite(la) || !Number.isFinite(lo)) continue
      const d = (la - lat) ** 2 + (lo - lng) ** 2
      if (d < bestD) {
        bestD = d
        best = { loc, entry }
      }
    }
    if (!best) return null
    const station = String(best.loc?.LocationName ?? best.loc?.locationName ?? 'CWA 潮位站')

    const now = Date.now()
    const events: TideEvent[] = []
    const walk = (o: any) => {
      if (!o || typeof o !== 'object') return
      if (Array.isArray(o)) return o.forEach(walk)
      const tideType = o.Tide ?? o.tide
      let dtStr = o.DateTime ?? o.dateTime
      const timeVal = o.Time ?? o.time
      if (!dtStr && (o.Date ?? o.date) && typeof timeVal === 'string' && timeVal.includes(':')) {
        dtStr = `${o.Date ?? o.date}T${timeVal}`
      }
      if (typeof tideType === 'string' && typeof dtStr === 'string') {
        const t = Date.parse(dtStr)
        if (Number.isFinite(t)) {
          const h = o.TideHeights ?? o.tideHeights ?? {}
          const cm = num(
            h.AboveLocalMSL ?? h.aboveLocalMSL ?? h.AboveTWVD ?? h.aboveTWVD ?? o.TideHeight,
          )
          events.push({ time: t, type: tideType, heightCm: Number.isFinite(cm) ? cm : null, station })
        }
      }
      for (const k in o) if (k !== 'TideHeights' && k !== 'tideHeights') walk(o[k])
    }
    walk(best.entry)

    const future = events
      .filter((e) => e.time >= now - 3600_000)
      .sort((a, b) => a.time - b.time)
      .slice(0, 6)
    return future.length ? future : null
  } catch {
    return null
  }
}

// ── 海面天氣/波浪 F-A0012-001（臺灣海面天氣預報）─────────────
export interface SeaAreaForecast {
  area: string
  /** 風（例：東北風 6~7 級）。 */
  wind: string | null
  /** 浪高（m，若能解析）。 */
  waveM: number | null
  /** 浪況描述（例：中浪至大浪）。 */
  waveText: string | null
}

export async function fetchCwaSeaAreas(): Promise<SeaAreaForecast[] | null> {
  let data: any
  try {
    data = await fetchCwaJson('F-A0012-001')
  } catch {
    return null
  }
  try {
    // 位置陣列可能在 records.location / records.Locations.Location …多種命名
    const locs = toArr(
      data?.records?.location ??
        data?.records?.Location ??
        data?.records?.locations?.location ??
        data?.records?.Locations?.Location,
    )
    if (!locs.length) return null

    const out: SeaAreaForecast[] = []
    for (const loc of locs) {
      const area = String(
        loc?.locationName ?? loc?.LocationName ?? loc?.geocode ?? loc?.stationId ?? '海域',
      )
      // 天氣要素：weatherElement[] 內找風/浪；命名 elementName/ElementName
      const els = toArr(loc?.weatherElement ?? loc?.WeatherElement)
      let wind: string | null = null
      let waveText: string | null = null
      let waveM: number | null = null
      for (const el of els) {
        const nm = String(el?.elementName ?? el?.ElementName ?? '')
        // 取第一個時段的值
        const t0 = toArr(el?.time ?? el?.Time)[0]
        const val = firstText(t0)
        if (/風|Wind|WD|WS/i.test(nm) && val) wind = wind ?? val
        if (/浪|波|Wave|Wav/i.test(nm) && val) {
          waveText = waveText ?? val
          const m = num((val.match(/([\d.]+)\s*(?:公尺|m)/) ?? [])[1])
          if (Number.isFinite(m)) waveM = m
        }
      }
      if (wind || waveText) out.push({ area, wind, waveM, waveText })
    }
    return out.length ? out.slice(0, 12) : null
  } catch {
    return null
  }
}

/** 從一個時段物件盡量抽出可讀文字值。 */
function firstText(t0: any): string | null {
  if (!t0) return null
  const p = t0.parameter ?? t0.Parameter ?? t0.elementValue ?? t0.ElementValue ?? t0
  if (typeof p === 'string') return p
  const arr = toArr(p)
  const parts = arr
    .map((x) => x?.parameterName ?? x?.ParameterName ?? x?.value ?? x?.Value ?? x?.parameterValue)
    .filter((x) => typeof x === 'string')
  return parts.length ? parts.join(' ') : null
}
