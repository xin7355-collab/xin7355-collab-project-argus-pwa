// ── AIS 連線路線與診斷 ───────────────────────────────────────
//
// 使用者回報 AIS 一直「連線中斷（code 1006）」。1006 只代表「連線不正常結束」，
// 可能原因至少四種，而且從手機上看起來一模一樣：
//   ① 金鑰無效（實測：aisstream 對無效金鑰是連上約 1 秒就切斷、不給原因）
//   ② aisstream 擋了某條路（官方說不支援瀏覽器直連；也有人回報共用 IP 被擋）
//   ③ 網路不穩
//   ④ 連線正常、金鑰也對，只是這片海沒有任何船回報——aisstream 靠各地志工接收站，
//      有些海域根本沒站
// 所以每條連線都記下來，用紀錄判斷，再用人話講出來。純函式，可離線測。

export type AisRoute = 'relay' | 'direct'

export interface ConnAttempt {
  route: AisRoute
  /** 握手有沒有成功（onopen 有沒有來）。 */
  opened: boolean
  /** 連上到斷線活了多久；沒連上為 null。 */
  aliveMs: number | null
  /** 收到幾則訊息。 */
  msgs: number
  code: number
  reason: string
}

/** 連上多久內就斷、又一筆都沒收到，算「秒斷」。 */
const QUICK_MS = 5_000

function failed(a: ConnAttempt): boolean {
  return a.msgs === 0
}

/**
 * 下一次走哪條路。
 * - 哪條路收到過資料就一直用它
 * - 自家轉接（relay）優先：aisstream 官方建議走伺服器端；
 *   「測試金鑰」測出哪條路收得到，就從那條開始（start）
 * - 同一條路連續兩次失敗（沒收到任何東西）就換另一條試
 */
export function chooseRoute(history: ConnAttempt[], start: AisRoute = 'relay'): AisRoute {
  const good = [...history].reverse().find((a) => a.msgs > 0)
  if (good) return good.route
  const last = history[history.length - 1]
  if (!last) return start
  const lastTwo = history.slice(-2)
  if (lastTwo.length === 2 && lastTwo.every((a) => a.route === last.route && failed(a))) {
    return last.route === 'relay' ? 'direct' : 'relay'
  }
  return last.route
}

export type Verdict =
  | 'ok'
  | 'pending'
  /** 兩條路都秒斷：金鑰幾乎確定無效。 */
  | 'badKey'
  /** 握手都失敗：連不到 aisstream（網路或對方停機）。 */
  | 'unreachable'
  /** 連得上、活得久，但一筆都沒有：多半是這片海沒有接收站。 */
  | 'silent'
  /** 混雜，還看不出來。 */
  | 'unclear'

export interface Diagnosis {
  verdict: Verdict
  text: string
}

/** 給人看的路線名稱。 */
export const ROUTE_NAME: Record<AisRoute, string> = { relay: '本站轉接', direct: '直連' }

export function diagnose(history: ConnAttempt[]): Diagnosis {
  if (history.some((a) => a.msgs > 0)) {
    const r = [...history].reverse().find((a) => a.msgs > 0)!.route
    return { verdict: 'ok', text: `連線正常（${ROUTE_NAME[r]}）。` }
  }
  const routes = new Set(history.map((a) => a.route))
  const opened = history.filter((a) => a.opened)
  const quick = opened.filter((a) => (a.aliveMs ?? 0) < QUICK_MS)
  const long = opened.filter((a) => (a.aliveMs ?? 0) >= QUICK_MS)

  // 活得久卻一筆都沒有：一次就夠下結論（不用等它斷，它可能永遠不斷）
  if (long.length >= 1 && quick.length === 0) {
    return {
      verdict: 'silent',
      text:
        '連線是通的，但一直沒有任何船位進來。最可能是這片海附近沒有 aisstream 的接收站' +
        '（它靠各地志工架站，有些海域完全沒有）。按「測試金鑰」借全球最忙的英吉利海峽收 15 秒：' +
        '收得到＝金鑰沒問題，是這裡沒資料。',
    }
  }
  if (history.length < 2) return { verdict: 'pending', text: '連線中，還在收集資料…' }

  if (opened.length === 0) {
    return {
      verdict: 'unreachable',
      text:
        routes.size > 1
          ? '兩條路線（本站轉接、直連）都連不上 aisstream。可能是網路不通或 aisstream 停機，稍後再試；換 Wi-Fi／行動網路也可以試試。'
          : '連不上 aisstream，正在換另一條路線試…',
    }
  }
  if (quick.length >= 2 && long.length === 0) {
    // 只在一條路上秒斷，可能是那條路被擋，不一定是金鑰——換另一條也試過才下結論
    if (routes.size < 2) {
      return { verdict: 'pending', text: `${ROUTE_NAME[quick[0].route]}一連上就被切斷，正在換另一條路線確認是金鑰還是路線的問題…` }
    }
    return {
      verdict: 'badKey',
      text:
        '每次一連上就被 aisstream 切斷、沒給原因——這幾乎都是金鑰無效。' +
        '到 aisstream.io 登入 → API Keys 重新複製，貼到 ⚙️ 設定的「AISStream 金鑰」。' +
        '也可以按下面「測試金鑰」確認。',
    }
  }
  return { verdict: 'unclear', text: '連線時好時壞，還看不出原因。按「測試金鑰」可以直接確認金鑰。' }
}

/** 測試金鑰用的海域：英吉利海峽，全球 AIS 回報最密集的地方之一。 */
export const KEY_TEST_BOX: [[number, number], [number, number]] = [
  [50.0, -2.0],
  [51.5, 2.0],
]

export function keyTestVerdict(msgs: number, opened: boolean, error = '', aliveMs: number | null = null): string {
  if (error) return `❌ aisstream 回報「${error}」——到 aisstream.io 確認金鑰，重新複製貼上。`
  if (!opened) return '❌ 兩條路線都連不上 aisstream，無法測試（網路問題或對方停機）。換 Wi-Fi／行動網路再試。'
  if (msgs > 0) return `✅ 金鑰有效（15 秒收到 ${msgs} 筆）。畫面這一帶沒船，是那裡沒有接收站，不是 App 壞了。`
  const how = aliveMs !== null && aliveMs < QUICK_MS ? '一連上就被切斷、一筆都沒收到' : '15 秒一筆都沒收到'
  return `❌ ${how}——金鑰多半無效或已停用。到 aisstream.io 重新複製金鑰再貼一次。`
}

// ── 單次探測（測試金鑰用）─────────────────────────────────
// 抽成可注入 socket 的純流程，才能離線測「秒斷」「連不上」「有資料」三種情況。

/** WebSocket 的最小介面（瀏覽器 WebSocket 符合；測試用假的）。 */
export interface ProbeSocket {
  onopen: ((ev: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: ((ev: { code: number; reason: string }) => void) | null
  onerror: ((ev: unknown) => void) | null
  send(data: string): void
  close(): void
}

export interface ProbeResult extends ConnAttempt {
  /** aisstream 回的錯誤文字（金鑰無效時有時會給）。 */
  error: string
}

/** 船位訊息才算數：錯誤訊息、伺服器提示都不算「收到資料」。 */
export function isPositionMessage(raw: unknown): boolean {
  if (typeof raw !== 'string') return false
  try {
    const m = JSON.parse(raw)
    return Boolean(m?.MetaData && m?.MessageType)
  } catch {
    return false
  }
}

function errorText(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  try {
    const m = JSON.parse(raw)
    return String(m?.error || m?.Error || '')
  } catch {
    return ''
  }
}

/**
 * 開一條連線、送出訂閱、聽 listenMs 毫秒後關掉，回報結果。
 * 握手 openTimeoutMs 內沒成功就放棄（不能無限等，使用者在看）。
 */
export function probeOnce(
  route: AisRoute,
  make: () => ProbeSocket,
  subMsg: string,
  { openTimeoutMs = 10_000, listenMs = 15_000, now = () => Date.now() } = {},
): Promise<ProbeResult> {
  return new Promise((resolve) => {
    let ws: ProbeSocket
    let openedAt: number | null = null
    let msgs = 0
    let error = ''
    let done = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const finish = (code: number, reason: string) => {
      if (done) return
      done = true
      if (timer) clearTimeout(timer)
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null
      try {
        ws.close()
      } catch {
        /* 已關閉 */
      }
      resolve({
        route,
        opened: openedAt !== null,
        aliveMs: openedAt === null ? null : now() - openedAt,
        msgs,
        code,
        reason,
        error,
      })
    }
    try {
      ws = make()
    } catch (e) {
      resolve({ route, opened: false, aliveMs: null, msgs: 0, code: 0, reason: String(e), error: '' })
      return
    }
    timer = setTimeout(() => finish(0, '握手逾時'), openTimeoutMs)
    ws.onopen = () => {
      openedAt = now()
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => finish(1000, ''), listenMs)
      try {
        ws.send(subMsg)
      } catch {
        /* 送不出去會接著 onclose */
      }
    }
    ws.onmessage = (ev) => {
      if (isPositionMessage(ev.data)) msgs++
      else error ||= errorText(ev.data)
    }
    ws.onclose = (ev) => finish(ev?.code ?? 0, ev?.reason ?? '')
  })
}

/**
 * 測試金鑰：先走本站轉接，轉接連不上或秒斷才改直連再試一次
 * （秒斷可能是轉接被擋，也可能是金鑰壞——兩條都秒斷才能確定是金鑰）。
 */
export async function runKeyTest(
  make: (route: AisRoute) => ProbeSocket,
  subMsg: string,
  timing?: { openTimeoutMs?: number; listenMs?: number; now?: () => number },
): Promise<{ result: ProbeResult; text: string }> {
  let result = await probeOnce('relay', () => make('relay'), subMsg, timing)
  const relayBad = result.msgs === 0 && (!result.opened || (result.aliveMs ?? 0) < QUICK_MS)
  if (relayBad) {
    const direct = await probeOnce('direct', () => make('direct'), subMsg, timing)
    // 直連表現比較好（收到資料、或至少活得比較久）就用直連的結果。
    if (direct.msgs > 0 || (direct.opened && !result.opened) || (direct.aliveMs ?? 0) > (result.aliveMs ?? 0)) {
      result = { ...direct, error: direct.error || result.error }
    } else {
      result = { ...result, error: result.error || direct.error }
    }
  }
  return { result, text: keyTestVerdict(result.msgs, result.opened, result.msgs > 0 ? '' : result.error, result.aliveMs) }
}
