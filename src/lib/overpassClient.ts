// ── OpenStreetMap Overpass 查詢（共用）──────────────────────────
//
// 以前航道、海底電纜、沙洲、風電場各自抄一份鏡像清單、各自重試，問題有三個：
//   1. 三台都失敗時回空陣列 → 畫面說「此區 OSM 無標定資料」，其實是伺服器忙，資料明明有。
//   2. 剛被限流（429）或逾時的鏡像，下一次還是先打它，又等一次逾時。
//   3. Overpass 忙的時候常回 HTTP 200 但內容是錯誤（remark 寫 runtime error / timed out），
//      被當成「成功、沒資料」。
// 做法參考 gods-eye-view（MIT，見 docs/licenses/gods-eye-view-MIT.txt）的
// server/providers/overpass/transport.js：每台鏡像記冷卻時間、照對方的 Retry-After、
// 認得 200 裡的錯誤；全部失敗才丟錯，而且錯誤要講「這不代表沒有資料」。
// fetch／時鐘可注入，離線可測。

export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]

export interface OsmElement {
  type: string
  id?: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
  geometry?: { lat: number; lon: number }[]
  members?: { role: string; geometry?: { lat: number; lon: number }[] }[]
}

/** 全部鏡像都失敗。message 是給人看的一句話。 */
export class OverpassError extends Error {
  // 不用建構子參數屬性（readonly reasons 寫在參數列）：Node 的 strip-types 不支援，測試會載不進來
  readonly reasons: string[]
  constructor(message: string, reasons: string[]) {
    super(message)
    this.name = 'OverpassError'
    this.reasons = reasons
  }
}

interface Cooldown {
  until: number
  failures: number
}
/** 放在模組層：同一頁裡每個圖層共用，A 圖層剛害某台被限流，B 圖層就不要再去撞。 */
const cooldowns = new Map<string, Cooldown>()

/** 測試用：清掉冷卻紀錄。 */
export function resetOverpassCooldowns(): void {
  cooldowns.clear()
}

/**
 * 冷卻多久（毫秒）。對方有給 Retry-After 就照它（至少 1 秒）；
 * 沒給就 30 秒起跳、每失敗一次加倍，最多 5 分鐘。
 */
export function cooldownMs(failures: number, retryAfterMs: number | null): number {
  if (retryAfterMs !== null && Number.isFinite(retryAfterMs)) return Math.max(1000, retryAfterMs)
  return Math.min(300_000, 30_000 * 2 ** Math.min(Math.max(failures, 1), 4))
}

/** Retry-After：秒數或 HTTP 日期。 */
export function parseRetryAfter(v: string | null, nowMs: number): number | null {
  if (!v) return null
  const t = v.trim()
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t) * 1000
  const at = Date.parse(t)
  return Number.isFinite(at) ? Math.max(0, at - nowMs) : null
}

/** 回應內容看起來是限流或伺服器錯誤（就算 HTTP 是 200）。 */
export function bodyProblem(text: string): string | null {
  if (/rate_limited|quota of your ip address|too many requests/i.test(text)) return '限流'
  try {
    const j = JSON.parse(text)
    const remark = typeof j?.remark === 'string' ? j.remark : ''
    if (/runtime error|timed out|out of memory/i.test(remark)) return '伺服器忙（查詢逾時）'
    if (!Array.isArray(j?.elements)) return '回應格式不對'
    return null
  } catch {
    return '回應不是資料（多半是錯誤頁）'
  }
}

export interface OverpassOpts {
  fetchImpl?: typeof fetch
  now?: () => number
  /** 每台等多久（毫秒）。查詢本身 timeout:60，這裡給 25 秒就換下一台，不讓使用者乾等。 */
  timeoutMs?: number
  /** 呼叫端取消（例如圖層被關掉）。取消不算鏡像的錯，不記冷卻。 */
  signal?: AbortSignal
}

/**
 * 送一個 Overpass 查詢。成功回元素陣列（可能是空的＝這裡真的沒有）；
 * 全部鏡像都失敗才丟 OverpassError。
 */
export async function overpassQuery(query: string, opts: OverpassOpts = {}): Promise<OsmElement[]> {
  const doFetch = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
  const now = opts.now ?? (() => Date.now())
  const timeoutMs = opts.timeoutMs ?? 25_000
  const reasons: string[] = []
  let tried = 0

  for (const ep of OVERPASS_ENDPOINTS) {
    const host = new URL(ep).host
    const cd = cooldowns.get(ep)
    if (cd && cd.until > now()) {
      reasons.push(`${host} 冷卻中`)
      continue
    }
    tried++
    const ctrl = new AbortController()
    const onAbort = () => ctrl.abort()
    opts.signal?.addEventListener('abort', onAbort)
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    let problem: string | null = null
    let retryAfter: number | null = null
    try {
      const res = await doFetch(ep, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
        signal: ctrl.signal,
      })
      const text = await res.text()
      if (res.status === 429) problem = '限流'
      else if (!res.ok) problem = `HTTP ${res.status}`
      else problem = bodyProblem(text)
      if (problem) retryAfter = parseRetryAfter(res.headers.get('retry-after'), now())
      if (!problem) {
        cooldowns.delete(ep)
        return (JSON.parse(text).elements ?? []) as OsmElement[]
      }
    } catch {
      if (opts.signal?.aborted) throw new DOMException('呼叫端取消', 'AbortError')
      problem = ctrl.signal.aborted ? `等了 ${Math.round(timeoutMs / 1000)} 秒沒回應` : '連不上'
    } finally {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
    }
    const failures = (cooldowns.get(ep)?.failures ?? 0) + 1
    cooldowns.set(ep, { failures, until: now() + cooldownMs(failures, retryAfter) })
    reasons.push(`${host} ${problem}`)
  }

  // 全部都在冷卻（剛被別的圖層撞過）：講多久後會再試，比「冷卻中」好懂
  const waitS = Math.ceil(Math.min(...OVERPASS_ENDPOINTS.map((ep) => (cooldowns.get(ep)?.until ?? 0) - now())) / 1000)
  const detail = tried === 0 ? `三台剛剛都失敗過，約 ${Math.max(1, waitS)} 秒後會再試` : reasons.join('、')
  throw new OverpassError(
    `OpenStreetMap 資料伺服器都忙或連不上（${detail}）。這不代表這裡沒有資料，稍後再開一次。`,
    reasons,
  )
}
