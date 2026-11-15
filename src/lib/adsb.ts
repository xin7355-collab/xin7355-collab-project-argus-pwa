// ── 飛機（ADS-B，資料來自 adsb.lol）─────────────────────────────
//
// 為什麼要看飛機：搜救直升機、海巡機、軍機的動態，和發出緊急代碼（7700）的飛機，
// 對海上勤務都有用；同一份資料還能推估 GPS 干擾（見 gnssIntegrity.ts）。
//
// 為什麼用 adsb.lol：免金鑰、資料授權 ODbL（商業、非商業都能用，要註明出處；
// 改作後再公開的資料庫要用同樣授權）。OpenSky 的授權限非商業用途，所以不用。
// adsb.lol 沒送 CORS 標頭，瀏覽器不能直連，一律經 Worker 的 /api/adsb 轉手（worker/adsb.js）。
//
// 這個檔案 App 和 Worker 共用：「請求要對齊到哪個格點」只寫一份，
// 兩邊算出來的快取鍵才會一樣。純函式（fetchAdsb 除外），可離線測。

/** Worker 轉給 App 的欄位（其他欄位丟掉：省手機流量，海上訊號差時差很多）。 */
export const ADSB_KEEP_FIELDS = [
  'hex',
  'flight',
  'r',
  't',
  'category',
  'alt_baro',
  'gs',
  'track',
  'squawk',
  'emergency',
  'lat',
  'lon',
  'seen_pos',
  'type',
  'version',
  'nic',
  'nac_p',
  'gpsOkBefore',
  'gpsOkLat',
  'gpsOkLon',
  'tisb',
  'mlat',
  'dbFlags',
] as const

/** 查詢半徑只用這幾種（浬）：附近的人看相近的範圍，就會共用同一份快取。adsb.lol 上限 250。 */
export const ADSB_DIST_BUCKETS = [25, 50, 100, 150, 250] as const
export const ADSB_MAX_DIST_NM = 250

export interface AdsbAnchor {
  lat: number
  lon: number
  dist: number
}

/**
 * 把「畫面中心＋半徑」對齊到格點與固定半徑，讓附近的請求打到同一份快取。
 * 半徑越大、格點越粗。對齊後中心會偏一點，所以半徑要把偏移量加回去，畫面邊緣才不會漏。
 * 不合法回 null。
 */
export function adsbAnchor(lat: number, lon: number, distNm: number): AdsbAnchor | null {
  if (![lat, lon, distNm].every(Number.isFinite) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || distNm <= 0) return null
  const grid = distNm <= 50 ? 0.25 : distNm <= 150 ? 0.5 : 1
  const snap = (v: number) => Number((Math.round(v / grid) * grid).toFixed(2))
  const aLat = Math.max(-90, Math.min(90, snap(lat)))
  const aLon = Math.max(-180, Math.min(180, snap(lon)))
  // 偏移（浬）：緯度 1 度＝60 浬；經度要乘 cos(緯度)
  const offset = Math.hypot((aLat - lat) * 60, (aLon - lon) * 60 * Math.cos((lat * Math.PI) / 180))
  const need = distNm + offset
  const dist = ADSB_DIST_BUCKETS.find((b) => b >= need) ?? ADSB_MAX_DIST_NM
  return { lat: aLat, lon: aLon, dist }
}

/** 快照只留需要的欄位。沒有飛機陣列回 null（格式不對）。 */
export function trimAdsb(payload: unknown): { now: unknown; ac: Record<string, unknown>[] } | null {
  const ac = (payload as { ac?: unknown } | null)?.ac
  if (!Array.isArray(ac)) return null
  const out: Record<string, unknown>[] = []
  for (const a of ac) {
    if (!a || typeof a !== 'object' || typeof (a as Record<string, unknown>).hex !== 'string') continue
    const o: Record<string, unknown> = {}
    for (const k of ADSB_KEEP_FIELDS) {
      const v = (a as Record<string, unknown>)[k]
      if (v !== undefined) o[k] = v
    }
    out.push(o)
  }
  return { now: (payload as { now?: unknown }).now, ac: out }
}

// ── App 端：整理成畫面要的樣子 ─────────────────────────────

export interface Aircraft {
  hex: string
  /** 呼號（航班號），沒有就空字串。 */
  callsign: string
  /** 註冊號（機尾號）。 */
  reg: string
  /** 機型代碼（例如 A321、S76）。 */
  typeCode: string
  category: string
  /** 氣壓高度（呎）；在地面或沒給是 null。 */
  altFt: number | null
  onGround: boolean
  gsKn: number | null
  trackDeg: number | null
  squawk: string | null
  /** adsb.lol 的緊急狀態欄位（none 以外才有）。 */
  emergency: string | null
  lat: number
  lng: number
  /** 位置是幾秒前的（相對於快照時間）。 */
  seenPosSec: number
  /** adsb.lol 資料庫標記為軍機（dbFlags 第 1 位）。 */
  military: boolean
  /** 位置來源（adsb_icao、mlat、tisb_…）。 */
  source: string
}

/** 超過 60 秒的位置不畫：飛機一分鐘可以飛 7 浬，畫出來是錯的位置。 */
const MAX_POS_AGE_S = 60
const HEX = /^~?[0-9a-f]{6}$/

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export function normalizeAircraft(payload: unknown): Aircraft[] | null {
  const ac = (payload as { ac?: unknown } | null)?.ac
  if (!Array.isArray(ac)) return null
  const out: Aircraft[] = []
  const seen = new Set<string>()
  for (const raw of ac) {
    if (!raw || typeof raw !== 'object') continue
    const a = raw as Record<string, unknown>
    const hex = typeof a.hex === 'string' ? a.hex.toLowerCase() : ''
    if (!HEX.test(hex) || seen.has(hex)) continue
    const lat = num(a.lat)
    const lng = num(a.lon)
    const age = num(a.seen_pos)
    if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue
    if (age === null || age < 0 || age > MAX_POS_AGE_S) continue
    seen.add(hex)
    const onGround = a.alt_baro === 'ground'
    const emergency = typeof a.emergency === 'string' && a.emergency !== 'none' ? a.emergency : null
    const squawk = typeof a.squawk === 'string' && /^[0-7]{4}$/.test(a.squawk) ? a.squawk : null
    const track = num(a.track)
    out.push({
      hex,
      callsign: typeof a.flight === 'string' ? a.flight.trim() : '',
      reg: typeof a.r === 'string' ? a.r.trim() : '',
      typeCode: typeof a.t === 'string' ? a.t.trim() : '',
      category: typeof a.category === 'string' ? a.category : '',
      altFt: onGround ? null : num(a.alt_baro),
      onGround,
      gsKn: num(a.gs),
      trackDeg: track !== null && track >= 0 && track < 360 ? track : null,
      squawk,
      emergency,
      lat,
      lng,
      seenPosSec: age,
      military: ((num(a.dbFlags) ?? 0) & 1) === 1,
      source: typeof a.type === 'string' ? a.type : '',
    })
  }
  return out
}

/** 特殊詢答碼（國際通用）。 */
const SQUAWK_MEANING: Record<string, string> = {
  '7500': '劫機',
  '7600': '無線電失效',
  '7700': '一般緊急',
}

/** adsb.lol 的 emergency 欄位。 */
const EMERGENCY_MEANING: Record<string, string> = {
  general: '一般緊急',
  lifeguard: '醫療／救護優先',
  minfuel: '燃油不足',
  nordo: '無線電失效',
  unlawful: '非法干擾（劫機）',
  downed: '迫降／墜毀',
  reserved: '緊急（保留碼）',
}

/** 這架有沒有發緊急：有就回一句話，沒有回 null。詢答碼和緊急欄位任一個有就算。 */
export function emergencyText(a: Pick<Aircraft, 'squawk' | 'emergency'>): string | null {
  const meaning = a.squawk ? SQUAWK_MEANING[a.squawk] : undefined
  const sq = meaning ? `詢答碼 ${a.squawk}（${meaning}）` : null
  const em = a.emergency ? (EMERGENCY_MEANING[a.emergency] ?? `緊急（${a.emergency}）`) : null
  // 7700 加上 general 講的是同一件事，只講詢答碼那句
  if (sq && em === meaning) return sq
  return [em, sq].filter(Boolean).join('、') || null
}

const CATEGORY_TEXT: Record<string, string> = {
  A1: '輕型機',
  A2: '小型機',
  A3: '大型機',
  A4: '大型機（高渦流）',
  A5: '重型機',
  A6: '高性能機',
  A7: '直升機',
  B1: '滑翔機',
  B2: '氣球／飛船',
  B4: '超輕型機',
  B6: '無人機',
  B7: '太空載具',
  C1: '地面緊急車輛',
  C2: '地面服務車輛',
}
export function categoryText(c: string): string {
  return CATEGORY_TEXT[c] ?? ''
}
export const isHelicopter = (a: Pick<Aircraft, 'category'>) => a.category === 'A7'

const SOURCE_TEXT: Record<string, string> = {
  adsb_icao: 'ADS-B',
  adsb_icao_nt: 'ADS-B',
  adsb_other: 'ADS-B',
  adsr_icao: 'ADS-R（地面轉播）',
  adsr_other: 'ADS-R（地面轉播）',
  tisb_icao: 'TIS-B（雷達轉播）',
  tisb_trackfile: 'TIS-B（雷達轉播）',
  tisb_other: 'TIS-B（雷達轉播）',
  mlat: 'MLAT（多站定位，較不準）',
  adsc: 'ADS-C（衛星回報）',
  mode_s: 'Mode S',
}
export function sourceText(s: string): string {
  return SOURCE_TEXT[s] ?? (s || '不明')
}

/** 高度：呎為主（航空慣用），括號附公尺。 */
export function altText(a: Pick<Aircraft, 'altFt' | 'onGround'>): string {
  if (a.onGround) return '地面'
  if (a.altFt === null) return '—'
  return `${Math.round(a.altFt).toLocaleString('en-US')} ft（${Math.round(a.altFt * 0.3048).toLocaleString('en-US')} m）`
}

/** 顯示名稱：呼號 > 註冊號 > ICAO 位址。 */
export function aircraftName(a: Pick<Aircraft, 'callsign' | 'reg' | 'hex'>): string {
  return a.callsign || a.reg || a.hex.toUpperCase()
}

/** 快照時間轉毫秒（adsb.lol 給毫秒；readsb 本機版給秒）。不合法回 null。 */
export function snapshotMs(now: unknown): number | null {
  if (typeof now !== 'number' || !Number.isFinite(now) || now <= 0) return null
  return now > 10_000_000_000 ? now : now * 1000
}

// ── 抓資料 ───────────────────────────────────────────────

export class AdsbError extends Error {
  readonly status: number
  /** 對方說幾秒後再試（限流時）。 */
  readonly retryAfterSec: number | null
  constructor(message: string, status: number, retryAfterSec: number | null) {
    super(message)
    this.name = 'AdsbError'
    this.status = status
    this.retryAfterSec = retryAfterSec
  }
}

export interface AdsbSnapshot {
  ac: unknown[]
  /** 快照在伺服器端已經多舊（秒）：用伺服器的時鐘算，手機時間不準也不影響。 */
  ageSec: number
  /** adsb.lol 暫時抓不到，Worker 拿之前存的那份頂著。 */
  stale: boolean
}

/** 向 Worker 要一份飛機快照。失敗丟 AdsbError，訊息可以直接給使用者看。 */
export async function fetchAdsb(
  a: AdsbAnchor,
  opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<AdsbSnapshot> {
  const doFetch = opts.fetchImpl ?? ((...x: Parameters<typeof fetch>) => fetch(...x))
  let res: Response
  try {
    res = await doFetch(`/api/adsb?lat=${a.lat}&lon=${a.lon}&dist=${a.dist}`, {
      headers: { accept: 'application/json' },
      signal: opts.signal,
    })
  } catch (e) {
    if (opts.signal?.aborted) throw e
    throw new AdsbError('飛機資料連不上（海上訊號不穩時常見），稍後自動再試', 0, null)
  }
  const retry = Number(res.headers.get('retry-after'))
  const retryAfterSec = Number.isFinite(retry) && retry > 0 ? retry : null
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    // 不是 JSON：多半是錯誤頁，下面依狀態碼講
  }
  if (!res.ok) {
    const msg = (body as { error?: unknown } | null)?.error
    throw new AdsbError(
      typeof msg === 'string' && msg ? msg : `飛機資料伺服器回應 ${res.status}，稍後自動再試`,
      res.status,
      retryAfterSec,
    )
  }
  const ac = (body as { ac?: unknown } | null)?.ac
  if (!Array.isArray(ac)) throw new AdsbError('飛機資料格式不對（可能伺服器暫時故障），稍後自動再試', res.status, null)
  const age = Number(res.headers.get('x-adsb-age'))
  return { ac, ageSec: Number.isFinite(age) && age >= 0 ? age : 0, stale: res.headers.get('x-adsb-stale') === '1' }
}
