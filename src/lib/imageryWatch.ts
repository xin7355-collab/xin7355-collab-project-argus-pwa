// ── 新衛星影像盯梢（給 GitHub Actions 排程跑）─────────────
//
// 解決的問題：使用者不知道「什麼時候有新圖可看」。衛星幾天才過境一次，
// 天天開 App 碰運氣很浪費時間。改成有新影像才通知。
//
// ── 為什麼這樣設計（本 repo 是公開的）───────────────────
// 1. 監控範圍（你在盯哪片海）放 GitHub secret，**不 commit 進 repo**。
//    座標一旦進 repo 就是公開的，等於昭告天下你在看哪裡。
// 2. 通知內容**不帶座標、不帶影像編號**。Sentinel 的場景編號本身就編碼了
//    地理磚位（例如 T51QTF），放進通知等於洩漏範圍。通知只說「有幾筆新影像」，
//    細節回 App 看。
// 3. **完全不存狀態**。每次只查「上一次執行到現在」這段時間窗，
//    有就通知、沒有就閉嘴。不需要把 last-seen 寫回 repo（那也會洩漏範圍），
//    也不需要 Actions 快取。
//
// ── 沒驗到 ───────────────────────────────────────────────
// Copernicus 目錄端點在本專案的開發沙箱連不出去（網路政策），
// 所以「線上實際回傳長什麼樣」沒有驗到。解析刻意寫得寬容，
// 而且 workflow 有 --self-test 模式可以在真的排程之前先手動驗一次整條管線。

export interface Bbox {
  west: number
  south: number
  east: number
  north: number
}

export interface Scene {
  /** 感測時間（毫秒）。 */
  sensed: number
  /** 來源標示，例如 Sentinel-2。通知裡只會出現這個，不會出現場景編號。 */
  collection: string
  /** 雲量百分比，取不到為 null。 */
  cloudPct: number | null
}

/**
 * 解析 "west,south,east,north"。
 * 範圍不合法就丟錯——與其拿壞座標去查一個空範圍然後永遠不通知（看起來像壞掉），
 * 不如讓 workflow 直接紅燈，才看得出是設定錯了。
 */
export function parseBbox(s: string): Bbox {
  const parts = s.split(',').map((x) => Number(x.trim()))
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error('WATCH_BBOX 格式應為 west,south,east,north（四個數字，逗號分隔）')
  }
  const [west, south, east, north] = parts
  if (Math.abs(west) > 180 || Math.abs(east) > 180) throw new Error('經度須在 -180..180')
  if (Math.abs(south) > 90 || Math.abs(north) > 90) throw new Error('緯度須在 -90..90')
  if (south >= north) throw new Error('south 必須小於 north')
  if (west >= east) throw new Error('west 必須小於 east（本工具不支援跨換日線的範圍）')
  return { west, south, east, north }
}

/**
 * Copernicus 公開 STAC 目錄（免金鑰，實測不需要任何 token）。
 *
 * 為什麼是這個主機而不是 stac.opensearch.dataspace.copernicus.eu：
 * 兩個都能用，但 collection id 打錯時行為不同——
 *   stac.dataspace…          → 400（大聲失敗）
 *   stac.opensearch.dataspace… → 200 + features: []（安靜回空）
 * 安靜回空會被讀成「這段時間沒有新影像」，而這正是使用者拿來決定
 * 要不要出海的那句話。寧可紅燈也不要靜悄悄地騙人。
 *
 * 歷史：原本用的是 /resto/api/collections/{coll}/search.json（OpenSearch），
 * 上游已經把它汰除，實測對所有 collection 名稱都回 404。
 */
export const CATALOG_BASE = 'https://stac.dataspace.copernicus.eu/v1'

/** STAC 的 collection id。實測是小寫；大寫的 SENTINEL-2 會被拒絕。 */
export const COLLECTIONS = {
  Sentinel2: 'sentinel-2-l2a',
  Sentinel1: 'sentinel-1-grd',
} as const

export type CollectionKey = keyof typeof COLLECTIONS

/**
 * Copernicus STAC 的查詢網址（免金鑰）。
 * base 可換成代理或自架端點——App 本身也有走 edge Worker 繞 CORS 的機制。
 */
export function buildCatalogUrl(
  collection: CollectionKey,
  box: Bbox,
  fromMs: number,
  toMs: number,
  maxRecords = 50,
  base = CATALOG_BASE,
): string {
  const id = COLLECTIONS[collection]
  if (!id) throw new Error(`未知的 collection：${collection}`)
  const qs = new URLSearchParams({
    collections: id,
    bbox: [box.west, box.south, box.east, box.north].map((n) => n.toFixed(4)).join(','),
    // STAC 的時間區間是用斜線分隔的 ISO 區間，不是兩個獨立參數
    datetime: `${new Date(fromMs).toISOString()}/${new Date(toMs).toISOString()}`,
    limit: String(maxRecords),
    sortby: '-datetime',
  })
  return `${base.replace(/\/+$/, '')}/search?${qs}`
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : null
}

/**
 * 解析 STAC 的 FeatureCollection。
 *
 * 欄位名是實測來的（在 GitHub Actions 上打真的伺服器，開發沙箱連不出去）：
 *   感測時間 → properties.datetime（與 start_datetime 相同）
 *   雲量     → properties['eo:cloud_cover']（只有光學有；雷達沒有這個欄位，
 *              因為 SAR 本來就穿雲——給 null，不能給 0 讓人以為是大晴天）
 *
 * 舊的 OpenSearch 欄位名（startDate / cloudCover）留著當退路：上游正在搬家，
 * 萬一哪天又換回去或代理端回舊格式，至少不會整個解析不出來。
 */
export function parseScenes(json: unknown, collection: string): Scene[] {
  if (!json || typeof json !== 'object') return []
  const feats = (json as { features?: unknown }).features
  if (!Array.isArray(feats)) return []
  const out: Scene[] = []
  for (const f of feats) {
    if (!f || typeof f !== 'object') continue
    const props = (f as { properties?: unknown }).properties
    const p = (props && typeof props === 'object' ? props : {}) as Record<string, unknown>
    const iso = p.datetime ?? p.start_datetime ?? p.startDate ?? p.completionDate ?? p.published
    const t = typeof iso === 'string' ? Date.parse(iso) : NaN
    if (!Number.isFinite(t)) continue
    const cloud = p['eo:cloud_cover'] ?? p.cloudCover
    out.push({ sensed: t, collection, cloudPct: num(cloud) })
  }
  return out
}

export interface WatchVerdict {
  notify: boolean
  count: number
  /** 要送出的通知內容。刻意不含座標與場景編號。 */
  title: string
  body: string
}

/** 把「最新一筆是多久以前」講成人話。 */
function ago(ms: number): string {
  const min = Math.round(ms / 60000)
  if (min < 60) return `${min} 分鐘前`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr} 小時前`
  return `${Math.round(hr / 24)} 天前`
}

/**
 * 決定要不要通知，以及通知內容。
 *
 * 內容只有「幾筆、哪些感測器、最新一筆多久以前、雲量如何」——
 * 沒有座標、沒有場景編號。要看是哪裡請回 App。
 */
export function decideNotify(scenes: Scene[], nowMs: number): WatchVerdict {
  if (scenes.length === 0) {
    return { notify: false, count: 0, title: '', body: '' }
  }
  const byColl = new Map<string, number>()
  for (const s of scenes) byColl.set(s.collection, (byColl.get(s.collection) ?? 0) + 1)
  const newest = scenes.reduce((a, b) => (b.sensed > a.sensed ? b : a))

  const parts = [...byColl.entries()].map(([c, n]) => `${c} ${n} 筆`)
  // 雲量只對光學有意義；取得到才講，取不到就不要瞎掰
  const clouds = scenes.map((s) => s.cloudPct).filter((c): c is number => c !== null)
  const cloudText =
    clouds.length > 0 ? `　最少雲 ${Math.round(Math.min(...clouds))}%` : ''

  return {
    notify: true,
    count: scenes.length,
    title: '阿爾戈斯：你關注的海域有新衛星影像',
    body:
      `${parts.join('、')}（最新 ${ago(nowMs - newest.sensed)}）${cloudText}\n` +
      '開 App → 沿岸光學 → 把日期調到那一天看。',
  }
}


// ── 「還沒設定」與「真的壞掉」要分開 ───────────────────────
//
// 工作守則：還沒設定的東西要安靜等，不要發失敗通知；真的壞掉才紅燈。
//
// 第一版沒做這個分別——secrets 還沒填就 exit 1，於是排程每 6 小時亮一次紅燈
// 吵使用者，而那其實只是「他還沒設定好」。排程遇到沒設定應該安靜跳過；
// 但手動觸發是使用者「正在設定、想知道結果」，那時候缺東西就該大聲講。

export interface WatchConfig {
  topic: string
  bbox: Bbox
  hours: number
}

export type ConfigResult =
  | { ok: true; config: WatchConfig }
  /**
   * missing 有東西＝還沒設定（安靜跳過）；
   * error 有東西＝填了但填錯（真的壞掉，要紅燈）。
   * 刻意用同一個形狀而不是兩個 union 分支——兩個 ok:false 分支無法被 TS 收窄，
   * 呼叫端讀 .error 會編不過。
   */
  | { ok: false; missing: string[]; error?: string }

/**
 * 讀設定。缺哪些列出來給呼叫端決定要安靜跳過還是紅燈。
 * 格式錯（不是「沒填」而是「填錯」）一律算真的壞掉，直接回 error。
 */
export function readWatchConfig(env: Record<string, string | undefined>): ConfigResult {
  const topic = (env.NTFY_TOPIC || '').trim()
  const bboxRaw = (env.WATCH_BBOX || '').trim()

  const missing: string[] = []
  if (!topic) missing.push('NTFY_TOPIC')
  if (!bboxRaw) missing.push('WATCH_BBOX')
  if (missing.length) return { ok: false, missing }

  let bbox: Bbox
  try {
    bbox = parseBbox(bboxRaw)
  } catch (e) {
    // 填了但填錯 ≠ 還沒設定。這是真的壞掉，要讓人看到。
    return { ok: false, missing: [], error: e instanceof Error ? e.message : '範圍格式錯誤' }
  }

  const h = Number(env.WATCH_HOURS)
  return { ok: true, config: { topic, bbox, hours: Number.isFinite(h) && h > 0 ? h : 7 } }
}

export interface ExitPlan {
  code: number
  /** GitHub Actions 的標註層級：error 會紅燈，notice 不會。 */
  level: 'error' | 'notice'
  message: string
}

/**
 * 還沒設定時該怎麼收場。
 *
 * requireConfig=true 代表使用者是「手動觸發、正在設定」——這時缺東西要紅燈，
 * 否則他會以為設好了。排程（requireConfig=false）則安靜跳過。
 */
export function planUnconfiguredExit(missing: string[], requireConfig: boolean): ExitPlan {
  const names = missing.join('、')
  if (requireConfig) {
    return {
      code: 1,
      level: 'error',
      message:
        `缺少 ${names}。到 Settings → Secrets and variables → Actions 新增後再試一次。` +
        '（設定步驟見 docs/設定教學.md）',
    }
  }
  return {
    code: 0,
    level: 'notice',
    message: `尚未設定 ${names}，這次排程跳過。設定好之後就會自動開始盯梢，不需要再做別的事。`,
  }
}


// ── 重試政策 ───────────────────────────────────────────────
//
// 這支腳本每 6 小時才跑一次。上游一次暫時性的 503，代價不是「晚一點拿到」，
// 而是「這一輪完全沒通知」——真的有新影像也不會知道，而且要等六小時。
// 所以暫時性錯誤值得重試；但永久性錯誤（主題名打錯、範圍格式錯）重試幾次
// 也一樣，只會把紅燈拖晚，不如早點報出來讓人去修。

/** 最多重試幾次（不含第一次嘗試）。 */
export const MAX_RETRIES = 4

/** 單次等待上限。上游叫我們等一小時的話，排程早就被下一輪取代了。 */
export const MAX_BACKOFF_MS = 60_000

/**
 * 這個狀態碼值不值得重試。
 *
 * 429 與 5xx 是暫時性的。其他 4xx 代表請求本身有問題（主題名、參數、授權），
 * 重試不會變對。
 */
export function shouldRetry(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600)
}

/**
 * 第 attempt 次重試要等多久（attempt 從 1 起算）。
 *
 * 基本是 2/4/8/16 秒的指數退避。上游有給 Retry-After 就聽它的——
 * 不聽的話等於在被限流時繼續敲，只會被擋更久。
 * header 可能是秒數，也可能是 HTTP 日期，兩種都要能讀。
 */
export function retryDelayMs(
  attempt: number,
  retryAfter?: string | null,
  nowMs: number = Date.now(),
): number {
  const backoff = Math.min(MAX_BACKOFF_MS, 2000 * Math.pow(2, Math.max(0, attempt - 1)))
  if (!retryAfter) return backoff

  const raw = retryAfter.trim()
  // 純數字 = 秒數
  if (/^\d+$/.test(raw)) {
    const ms = Number(raw) * 1000
    return Math.min(MAX_BACKOFF_MS, Math.max(backoff, ms))
  }
  // HTTP 日期
  const at = Date.parse(raw)
  if (Number.isFinite(at)) {
    // 已經過去的時間點（上游時鐘偏差）不能變成負數等待
    const ms = Math.max(0, at - nowMs)
    return Math.min(MAX_BACKOFF_MS, Math.max(backoff, ms))
  }
  // 看不懂就用自己的退避，不要因為 header 格式怪就不等
  return backoff
}
