// ── Sentinel Hub / CDSE WMS 圖磚模組 ────────────────────────
//
// 我們不自己算雲量：直接在 WMS 請求注入 MAXCC 參數，交給歐洲太空總署
// 的伺服器篩選好再回傳。同理 Sentinel-1 SAR 也是走 WMS layer。

import { getConfig, isSentinelConfigured } from './config'

/** 是否已設定金鑰。未設定時 UI 要顯示提示，而不是嘗試載入而破圖。 */
export { isSentinelConfigured }

export interface SentinelOptions {
  /** WMS layer 名稱，例如 'TRUE-COLOR-S2L2A'（光學）或 'SAR-VV'（雷達）。 */
  layer: string
  /** 觀測日期 YYYY-MM-DD（範圍的結束日）。 */
  date: string
  /** 最大雲量 %（只對光學有意義；SAR 忽略）。 */
  maxCloudCover?: number
  /**
   * 往回幾天的觀測窗（Sentinel 對同一點約每 5 天才過境一次，用單一日期
   * 幾乎每天都空白）。>0 時 TIME 用「起→迄」範圍，伺服器回傳窗內一景，
   * 影像才不會忽有忽無。0/未給＝仍用單一日期。
   */
  lookbackDays?: number
  /**
   * 範圍內挑哪一景：'leastCC'＝最少雲（最看得到海面/船，光學預設）、
   * 'mostRecent'＝最新一景（雷達預設，雷達不受雲影響）。
   */
  priority?: 'leastCC' | 'mostRecent'
}

/** date（YYYY-MM-DD）往回 n 天（UTC，避開時區位移）。 */
function daysBefore(date: string, n: number): string {
  const t = new Date(`${date}T00:00:00Z`).getTime() - n * 86400000
  return new Date(t).toISOString().slice(0, 10)
}

/**
 * 組出 Leaflet L.tileLayer.wms 需要的 base URL 與 params。
 * lookbackDays>0 時 TIME 用日期範圍（回傳窗內最新一景，避免單日多半空白造成
 * 影像忽有忽無）；否則用單一日期。MAXCC 交給 ESA 伺服器過濾雲量。
 */
export function buildWmsConfig(opts: SentinelOptions): {
  url: string
  params: Record<string, string | number | boolean>
} {
  const cfg = getConfig()
  const url = `${cfg.sentinelWmsUrl}/${cfg.sentinelInstanceId || 'MISSING_INSTANCE_ID'}`
  const time =
    opts.lookbackDays && opts.lookbackDays > 0
      ? `${daysBefore(opts.date, opts.lookbackDays)}/${opts.date}`
      : opts.date
  const params: Record<string, string | number | boolean> = {
    layers: opts.layer,
    format: 'image/png',
    transparent: true,
    version: '1.3.0',
    time,
    // 範圍內挑景規則（Sentinel Hub WMS PRIORITY）：光學用最少雲、雷達用最新。
    priority: opts.priority ?? 'mostRecent',
  }
  if (typeof opts.maxCloudCover === 'number' && opts.maxCloudCover < 100) {
    // 只有使用者刻意調低（<100%）才送 MAXCC 過濾；預設 100=不硬篩，
    // 避免多雲季把所有影像篩光變成全黑（改由 priority=leastCC 自動挑最清晰）。
    params.maxcc = opts.maxCloudCover
  }
  return { url, params }
}

/** 預設的 WMS layer 名稱。使用者組態裡沒有時，由 sentinelLayers.ts 從現有圖層挑。 */
export const LAYERS = {
  opticalTrueColor: 'TRUE-COLOR-S2L2A', // Sentinel-2 光學
  sarVV: 'SAR-VV', // Sentinel-1 雷達
} as const

// 讀過 GetCapabilities 後實際要用的圖層 ID。放模組層而不是 store：
// baseLayers 這類純組圖層的函式也要用，不該為此依賴 React。
let resolved: { sar?: string; optical?: string } = {}

/** 設定實際圖層（null＝組態裡沒有，讓 layerFor 回 null）。 */
export function setResolvedLayers(r: { sar: string | null; optical: string | null } | null): void {
  resolved = r ? { sar: r.sar ?? '', optical: r.optical ?? '' } : {}
}

/**
 * 該用哪個圖層 ID。還沒檢查過就用預設名字；檢查過、組態裡沒有就回 null
 * （呼叫端要提示去加圖層，不要掛一層注定空白的 WMS）。
 */
export function layerFor(kind: 'sar' | 'optical'): string | null {
  const r = resolved[kind]
  if (r === undefined) return kind === 'sar' ? LAYERS.sarVV : LAYERS.opticalTrueColor
  return r || null
}
