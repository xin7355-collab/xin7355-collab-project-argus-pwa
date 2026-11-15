// ── MCP 工具：把 App 裡的海域計算開放給 Claude 等 AI 助理呼叫 ─────────────
//
// 用途：在 Claude（網頁、iPhone App）裡直接問「從基隆港到彭佳嶼多遠、方位多少」、
// 「目標 12 節往 045°，我 20 節要怎麼攔」、「今晚幾點完全天黑、月亮多亮」，
// 由這些工具算，答案跟 App 裡的一樣。
//
// 除了 nearby_aircraft（查 adsb.lol 公開資料）以外都是純計算：不連網、不讀任何金鑰、
// 不碰使用者存在手機裡的點位。所以沒有登入也不會洩漏東西（見 worker/mcp.js 的說明）。
// 純函式，可離線測；查飛機用的 fetch 由呼叫端注入。

import { parseCoord, fmtDDM, fmtDecimal } from './coordParse.ts'
import { solveIntercept, projectPosition } from './intercept.ts'
import { opticalHorizonKm } from './lookout.ts'
import { getSunTimes, getMoonIllumination, moonPhaseName, computeNightPlan } from './astro.ts'
import { buildSearchPattern } from './searchPattern.ts'
import { adsbAnchor, normalizeAircraft, emergencyText, aircraftName, altText, ADSB_MAX_DIST_NM, type AdsbAnchor } from './adsb.ts'

const NM_KM = 1.852
const DEG = Math.PI / 180

/** 使用者輸入不對：訊息直接給模型看，讓它改了再試。 */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolInputError'
  }
}

export interface ToolResult {
  text: string
  structured?: unknown
}

export interface ToolDeps {
  /** 查 adsb.lol 快照（Worker 端用同一套快取）。 */
  fetchAdsb?: (a: AdsbAnchor) => Promise<{ ac: unknown[]; ageSec: number; stale: boolean }>
  now?: () => Date
}

export interface ToolDef {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  annotations: Record<string, unknown>
  run: (args: Record<string, unknown>, deps: ToolDeps) => Promise<ToolResult> | ToolResult
}

// ── 小工具 ───────────────────────────────────────────────

const POSITION_HELP = '位置可寫「25.13, 121.74」、「25°07.8\'N 121°44.5\'E」或「N25 07.8 E121 44.5」（WGS84）'

function pos(args: Record<string, unknown>, key: string): { lat: number; lng: number } {
  const v = args[key]
  if (typeof v !== 'string' || !v.trim()) throw new ToolInputError(`缺少 ${key}。${POSITION_HELP}`)
  const p = parseCoord(v)
  if (!p) throw new ToolInputError(`${key}「${v.slice(0, 60)}」看不懂。${POSITION_HELP}`)
  return p
}

function num(args: Record<string, unknown>, key: string, o: { min: number; max: number; def?: number; label: string }): number {
  const raw = args[key]
  if (raw === undefined || raw === null || raw === '') {
    if (o.def !== undefined) return o.def
    throw new ToolInputError(`缺少 ${key}（${o.label}）`)
  }
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
  if (!Number.isFinite(n)) throw new ToolInputError(`${key}（${o.label}）要是數字`)
  if (n < o.min || n > o.max) throw new ToolInputError(`${key}（${o.label}）要在 ${o.min}～${o.max} 之間，收到 ${n}`)
  return n
}

const deg3 = (d: number) => `${String(Math.round(((d % 360) + 360) % 360) % 360).padStart(3, '0')}°`
const nmText = (nm: number) => `${nm.toFixed(nm < 10 ? 2 : 1)} 浬（${(nm * NM_KM).toFixed(1)} 公里）`
const posText = (p: { lat: number; lng: number }) => `${fmtDDM(p.lat, p.lng)}（${fmtDecimal(p.lat, p.lng)}）`

/** 大圓距離（浬）與起始真方位（度）。 */
export function greatCircle(a: { lat: number; lng: number }, b: { lat: number; lng: number }): { nm: number; bearing: number } {
  const φ1 = a.lat * DEG
  const φ2 = b.lat * DEG
  const dφ = φ2 - φ1
  const dλ = (b.lng - a.lng) * DEG
  const h = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2
  const km = 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)))
  const y = Math.sin(dλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ)
  return { nm: km / NM_KM, bearing: ((Math.atan2(y, x) / DEG) + 360) % 360 }
}

/** 某個時區（小時）的「時:分」。 */
function hhmm(d: Date, tzHours: number): string {
  if (!Number.isFinite(d.getTime())) return '—（這天沒有）'
  const t = new Date(d.getTime() + tzHours * 3600_000)
  return `${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`
}

const PURE = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }

const posProp = (desc: string) => ({ type: 'string', description: `${desc}。${POSITION_HELP}` })

// ── 工具 ───────────────────────────────────────────────

export const TOOLS: ToolDef[] = [
  {
    name: 'parse_position',
    title: '座標換算',
    description: '把各種寫法的座標（十進位、度分、度分秒、帶 N/E）換成十進位與度分兩種寫法。Convert a coordinate string into decimal and degrees-minutes formats.',
    inputSchema: { type: 'object', properties: { text: posProp('要換算的座標') }, required: ['text'], additionalProperties: false },
    annotations: PURE,
    run: (args) => {
      const p = pos(args, 'text')
      return { text: `十進位：${fmtDecimal(p.lat, p.lng)}\n度分：${fmtDDM(p.lat, p.lng)}`, structured: { lat: p.lat, lng: p.lng } }
    },
  },
  {
    name: 'distance_bearing',
    title: '距離與方位',
    description: '兩點之間的大圓距離（浬）與起始真方位、反方位。Great-circle distance (nautical miles) and initial true bearing between two positions.',
    inputSchema: {
      type: 'object',
      properties: { from: posProp('起點'), to: posProp('終點') },
      required: ['from', 'to'],
      additionalProperties: false,
    },
    annotations: PURE,
    run: (args) => {
      const a = pos(args, 'from')
      const b = pos(args, 'to')
      const g = greatCircle(a, b)
      const back = greatCircle(b, a)
      return {
        text: `距離 ${nmText(g.nm)}\n起點往終點的真方位 ${deg3(g.bearing)}；從終點看回來 ${deg3(back.bearing)}`,
        structured: { distanceNm: g.nm, distanceKm: g.nm * NM_KM, bearingDeg: g.bearing, reverseBearingDeg: back.bearing },
      }
    },
  },
  {
    name: 'dead_reckoning',
    title: '推算船位',
    description: '從起點以固定航向、航速走一段時間後的位置；分鐘給負數就是回推來時的位置。平面近似，數十浬內誤差可忽略。Dead reckoning position.',
    inputSchema: {
      type: 'object',
      properties: {
        start: posProp('起點'),
        course_deg: { type: 'number', minimum: 0, maximum: 360, description: '航向（度，真北）' },
        speed_kn: { type: 'number', minimum: 0, maximum: 100, description: '航速（節）' },
        minutes: { type: 'number', minimum: -10080, maximum: 10080, description: '經過幾分鐘（負數＝回推）' },
      },
      required: ['start', 'course_deg', 'speed_kn', 'minutes'],
      additionalProperties: false,
    },
    annotations: PURE,
    run: (args) => {
      const s = pos(args, 'start')
      const c = num(args, 'course_deg', { min: 0, max: 360, label: '航向度' })
      const v = num(args, 'speed_kn', { min: 0, max: 100, label: '航速節' })
      const m = num(args, 'minutes', { min: -10080, max: 10080, label: '分鐘' })
      const p = projectPosition(s, c, v, m)
      const run = Math.abs((v * m) / 60)
      return {
        text: `${m >= 0 ? `${m} 分鐘後` : `${-m} 分鐘前`}約在 ${posText(p)}\n航程 ${nmText(run)}（航向 ${deg3(c)}、${v} 節）`,
        structured: { lat: p.lat, lng: p.lng, runNm: run },
      }
    },
  },
  {
    name: 'intercept_course',
    title: '攔截計算',
    description: '我方位置與航速、目標位置與航向航速 → 該操的航向、幾分鐘追上、攔截點。追不上會說原因。Intercept course to steer and time to intercept.',
    inputSchema: {
      type: 'object',
      properties: {
        own: posProp('我方位置'),
        own_speed_kn: { type: 'number', minimum: 0.1, maximum: 100, description: '我方航速（節）' },
        target: posProp('目標位置'),
        target_course_deg: { type: 'number', minimum: 0, maximum: 360, description: '目標航向（度，真北）' },
        target_speed_kn: { type: 'number', minimum: 0, maximum: 100, description: '目標航速（節）' },
      },
      required: ['own', 'own_speed_kn', 'target', 'target_course_deg', 'target_speed_kn'],
      additionalProperties: false,
    },
    annotations: PURE,
    run: (args) => {
      const r = solveIntercept({
        own: pos(args, 'own'),
        ownSpeedKn: num(args, 'own_speed_kn', { min: 0.1, max: 100, label: '我方航速節' }),
        target: pos(args, 'target'),
        targetCourseDeg: num(args, 'target_course_deg', { min: 0, max: 360, label: '目標航向度' }),
        targetSpeedKn: num(args, 'target_speed_kn', { min: 0, max: 100, label: '目標航速節' }),
      })
      const now = `目標現在在 ${deg3(r.bearingDeg)} 方向 ${nmText(r.rangeNm)}`
      if (!r.feasible) return { text: `追不上：${r.reason ?? '我方太慢'}\n${now}`, structured: r }
      return {
        text: `操 ${deg3(r.courseDeg)}，約 ${Math.round(r.timeMin)} 分鐘追上\n攔截點 ${posText(r.point)}\n我方要走 ${nmText(r.ownDistNm)}；${now}`,
        structured: r,
      }
    },
  },
  {
    name: 'horizon_range',
    title: '雷達／無線電／目視距離',
    description:
      '天線（或眼睛）高度與目標高度決定的最遠看得到／通得到的距離（含大氣折射）。radar、radio 用等效地球半徑 k（預設 4/3）；optical 是目視。Radar/radio/optical horizon range.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['radar', 'radio', 'optical'], description: 'radar 雷達、radio 無線電、optical 目視；預設 radar' },
        antenna_height_m: { type: 'number', minimum: 0, maximum: 5000, description: '天線頂（或眼睛）離海面高度（公尺）' },
        target_height_m: { type: 'number', minimum: 0, maximum: 20000, description: '目標高度（公尺），小船約 3、漁船約 10；預設 0（海面）' },
        k_factor: { type: 'number', minimum: 0.5, maximum: 10, description: '等效地球半徑係數，標準大氣 4/3；強波導可到 2.5 以上' },
      },
      required: ['antenna_height_m'],
      additionalProperties: false,
    },
    annotations: PURE,
    run: (args) => {
      const kind = args.kind === undefined ? 'radar' : args.kind
      if (kind !== 'radar' && kind !== 'radio' && kind !== 'optical') throw new ToolInputError('kind 只能是 radar、radio 或 optical')
      const h1 = num(args, 'antenna_height_m', { min: 0, max: 5000, label: '天線高公尺' })
      const h2 = num(args, 'target_height_m', { min: 0, max: 20000, def: 0, label: '目標高公尺' })
      const k = num(args, 'k_factor', { min: 0.5, max: 10, def: 4 / 3, label: 'k 係數' })
      // 跟 App 的雷達、無線電、瞭望哨面板同一個公式，答案才對得起來
      const km = kind === 'optical' ? opticalHorizonKm(h1, h2) : 3.569 * Math.sqrt(k) * (Math.sqrt(h1) + Math.sqrt(h2))
      const name = kind === 'radar' ? '雷達地平線' : kind === 'radio' ? '無線電視距' : '目視地平線'
      return {
        text: `${name}約 ${nmText(km / NM_KM)}（天線 ${h1} 公尺、目標 ${h2} 公尺${kind === 'optical' ? '' : `、k=${k.toFixed(2)}`}）\n只算地球曲率與折射；功率、雜波、天候會讓實際距離更短`,
        structured: { km, nm: km / NM_KM },
      }
    },
  },
  {
    name: 'sun_moon',
    title: '日月光照',
    description: '某地某日的日出日落、曙暮光、月相照明度，以及當晚月亮在地平線下的黑暗時段。時間預設台灣時間（UTC+8）。Sun and moon times for night operations.',
    inputSchema: {
      type: 'object',
      properties: {
        position: posProp('地點'),
        date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: '日期 YYYY-MM-DD（當地日期）；預設今天' },
        tz_offset_hours: { type: 'number', minimum: -12, maximum: 14, description: '時區（小時），預設 8（台灣）' },
      },
      required: ['position'],
      additionalProperties: false,
    },
    annotations: PURE,
    run: (args, deps) => {
      const p = pos(args, 'position')
      const tz = num(args, 'tz_offset_hours', { min: -12, max: 14, def: 8, label: '時區小時' })
      let day: string
      if (args.date === undefined) {
        const t = new Date((deps.now?.() ?? new Date()).getTime() + tz * 3600_000)
        day = t.toISOString().slice(0, 10)
      } else if (typeof args.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.date) && Number.isFinite(Date.parse(args.date))) {
        day = args.date
      } else {
        throw new ToolInputError('date 要寫成 YYYY-MM-DD，例如 2026-11-15')
      }
      // 當地中午：用它算「這一天」的日出日落，不會因為時區跨到前一天
      const noon = new Date(Date.parse(`${day}T12:00:00Z`) - tz * 3600_000)
      const s = getSunTimes(noon, p.lat, p.lng)
      const moon = getMoonIllumination(noon)
      const plan = computeNightPlan(noon, p.lat, p.lng)
      const dark =
        plan.darkStart && plan.darkEnd ? `${hhmm(plan.darkStart, tz)}～${hhmm(plan.darkEnd, tz)}（約 ${Math.round(plan.darkMinutes)} 分鐘）` : '沒有（整晚月亮都在天上）'
      return {
        text: [
          `${day}（UTC${tz >= 0 ? '+' : ''}${tz}）`,
          `日出 ${hhmm(s.sunrise, tz)}、日落 ${hhmm(s.sunset, tz)}`,
          `航海曙光 ${hhmm(s.nauticalDawn, tz)}、航海暮光 ${hhmm(s.nauticalDusk, tz)}`,
          `天文暮光結束（完全天黑）${hhmm(plan.astroDusk, tz)}；明晨天文曙光 ${hhmm(plan.astroDawn, tz)}`,
          `月相：${moonPhaseName(moon.phase)}，照明 ${Math.round(moon.fraction * 100)}%`,
          `今晚月亮在地平線下的黑暗時段：${dark}`,
          plan.verdict,
        ].join('\n'),
        structured: { date: day, tzOffsetHours: tz, moonIllumination: moon.fraction, darkMinutes: plan.darkMinutes },
      }
    },
  },
  {
    name: 'search_pattern',
    title: '搜索航線（平行梳掃）',
    description: '在搜索中心周圍的方形區，依航線間距產生平行梳掃（割草機式）航點與總航程。Parallel-track search pattern waypoints.',
    inputSchema: {
      type: 'object',
      properties: {
        center: posProp('搜索中心'),
        radius_nm: { type: 'number', minimum: 0.1, maximum: 50, description: '搜索半徑（浬），涵蓋這個半徑的方形區' },
        spacing_nm: { type: 'number', minimum: 0.05, maximum: 10, description: '航線間距（浬）＝有效搜索寬度' },
        heading_deg: { type: 'number', minimum: 0, maximum: 360, description: '每一腿的走向（度）；預設 90（東西向腿、南北推進）' },
      },
      required: ['center', 'radius_nm', 'spacing_nm'],
      additionalProperties: false,
    },
    annotations: PURE,
    run: (args) => {
      const c = pos(args, 'center')
      const r = buildSearchPattern({
        centerLat: c.lat,
        centerLng: c.lng,
        radiusM: num(args, 'radius_nm', { min: 0.1, max: 50, label: '半徑浬' }) * 1852,
        spacingM: num(args, 'spacing_nm', { min: 0.05, max: 10, label: '間距浬' }) * 1852,
        headingDeg: num(args, 'heading_deg', { min: 0, max: 360, def: 90, label: '走向度' }),
      })
      const shown = r.path.slice(0, 40)
      const lines = shown.map(([la, ln], i) => `${i + 1}. ${fmtDDM(la, ln)}`)
      if (r.path.length > shown.length) lines.push(`…還有 ${r.path.length - shown.length} 個航點（見結構化資料）`)
      return {
        text: `${r.legs} 條腿、${r.path.length} 個航點、總航程 ${nmText(r.lengthM / 1852)}\n${lines.join('\n')}`,
        structured: { legs: r.legs, lengthNm: r.lengthM / 1852, waypoints: r.path.map(([lat, lng]) => ({ lat, lng })) },
      }
    },
  },
  {
    name: 'nearby_aircraft',
    title: '附近飛機（ADS-B）',
    description:
      '查某個位置附近正在飛的飛機（adsb.lol 公開 ADS-B 資料，約 12 秒更新）：呼號、高度、距離方位、緊急代碼（7500/7600/7700）、軍機標記。遠離陸地沒有接收站時會查不到，不代表沒有飛機。Nearby aircraft from adsb.lol (ODbL).',
    inputSchema: {
      type: 'object',
      properties: {
        position: posProp('中心位置'),
        radius_nm: { type: 'number', minimum: 1, maximum: ADSB_MAX_DIST_NM, description: '半徑（浬），預設 50，最多 250' },
      },
      required: ['position'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    run: async (args, deps) => {
      const p = pos(args, 'position')
      const radius = num(args, 'radius_nm', { min: 1, max: ADSB_MAX_DIST_NM, def: 50, label: '半徑浬' })
      const anchor = adsbAnchor(p.lat, p.lng, radius)
      if (!anchor) throw new ToolInputError(`position 超出範圍。${POSITION_HELP}`)
      if (!deps.fetchAdsb) throw new Error('這個環境沒有接飛機資料')
      const snap = await deps.fetchAdsb(anchor)
      const list = (normalizeAircraft({ ac: snap.ac }) ?? [])
        .map((a) => ({ a, g: greatCircle(p, { lat: a.lat, lng: a.lng }) }))
        .filter((x) => x.g.nm <= radius)
        // 發緊急的排最前面（只列前 20 架時不能被擠掉），其餘照距離
        .sort((x, y) => Number(!!emergencyText(y.a)) - Number(!!emergencyText(x.a)) || x.g.nm - y.g.nm)
      const em = list.filter((x) => emergencyText(x.a))
      const head = `${radius} 浬內 ${list.length} 架${em.length ? `，其中 ${em.length} 架發緊急` : ''}${snap.stale ? '（adsb.lol 暫時抓不到，這是舊資料）' : ''}；資料約 ${Math.round(snap.ageSec)} 秒前`
      const lines = list.slice(0, 20).map(({ a, g }) => {
        const flags = [emergencyText(a), a.military ? '軍機' : ''].filter(Boolean).join('、')
        return `${aircraftName(a)}${a.typeCode ? `（${a.typeCode}）` : ''}：${altText(a)}、${a.gsKn === null ? '—' : Math.round(a.gsKn) + ' 節'}，在 ${deg3(g.bearing)} 方向 ${g.nm.toFixed(1)} 浬${flags ? `；${flags}` : ''}`
      })
      if (list.length > 20) lines.push(`…還有 ${list.length - 20} 架`)
      if (list.length === 0) lines.push('沒有收到飛機（遠離陸地沒有接收站時常見，不代表天上沒有飛機）')
      lines.push('資料：© adsb.lol 貢獻者（ODbL）')
      return {
        text: `${head}\n${lines.join('\n')}`,
        structured: {
          count: list.length,
          emergencies: em.length,
          ageSec: snap.ageSec,
          stale: snap.stale,
          aircraft: list.slice(0, 50).map(({ a, g }) => ({
            hex: a.hex,
            callsign: a.callsign,
            reg: a.reg,
            type: a.typeCode,
            altFt: a.altFt,
            onGround: a.onGround,
            gsKn: a.gsKn,
            trackDeg: a.trackDeg,
            squawk: a.squawk,
            emergency: emergencyText(a),
            military: a.military,
            distanceNm: g.nm,
            bearingDeg: g.bearing,
          })),
          attribution: '© adsb.lol contributors, ODbL',
        },
      }
    },
  },
]

export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]))
