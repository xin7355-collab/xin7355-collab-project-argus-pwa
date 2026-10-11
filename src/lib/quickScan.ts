import type { Detection } from './detection'
import type { OpticalSource } from './imagerySources'

// ── 一鍵「這片海現在有什麼」──────────────────────────────
//
// 原本要看出「這片海有沒有可疑船」，得自己做完這一串：
//   切到沿岸光學 → 挑影像來源 → 挑日期 → 等圖磚載完 → 按掃描 → 自己讀結果
// 六個動作散在三個面板裡。這支把決策的部分集中起來，讓畫面上只剩一顆按鈕。
//
// 這個模組刻意只放「純函式」：挑來源、挑日期、把結果講成人話。
// 真正的副作用（切模式、等圖磚、觸發掃描）留在 QuickScanButton 元件裡，
// 這樣這裡才能直接丟給 Node 跑單元測試。
//
// 誠實定位：免費影像看不到「此刻」。planQuickScan 會回一個 caveat 字串，
// 一定要原樣顯示給使用者——不然他會以為畫面上沒有紅框就代表海上現在沒船。

/** 掃描計畫：要用哪個來源、哪一天，以及一句「為什麼選它」。 */
export interface QuickScanPlan {
  /** 沒有 Sentinel 金鑰時要切到哪個免金鑰來源。 */
  source: OpticalSource
  /** 觀測日期（YYYY-MM-DD）。 */
  date: string
  /** 有 Sentinel 金鑰時走 WMS，來源欄位就不生效。 */
  usesSentinel: boolean
  /** 為什麼這樣挑，一句話。 */
  reason: string
  /** 這次掃描「看不到什麼」。必須顯示，不能省略。 */
  caveat: string
}

/**
 * 挑出「最有機會看到船」的來源與日期。
 *
 * 有 Sentinel 金鑰 → Sentinel-2 10m（近 10 日最少雲一景），這是免費來源裡
 * 唯一真的看得到小艇、又標得出拍攝日期的。
 *
 * 沒有金鑰 → Esri 高解析空拍。它沿岸可到次公尺級，但那是歷年鑲嵌圖，
 * 看得到地形、港口、固定設施，**看不到今天的船**。每日的 VIIRS/MODIS
 * 雖然是當日，但 250–375m／像素，小艇連一個點都不到，拿來掃描等於做白工，
 * 所以不選它。
 */
export function planQuickScan(opts: { hasSentinel: boolean; today: string }): QuickScanPlan {
  // 衛星影像有數小時延遲，用「昨天」當基準最保險。
  const date = daysBefore(opts.today, 1)
  if (opts.hasSentinel) {
    return {
      source: 'esri',
      date,
      usesSentinel: true,
      reason: 'Sentinel-2 真彩 10m — 免費來源裡唯一看得到小艇又標得出拍攝日的',
      caveat:
        '這是「近 10 日最少雲的一景」，不是此刻。畫面上沒有目標＝那一刻沒拍到，' +
        '不代表現在海上沒船。要即時船位請看 AIS。',
    }
  }
  return {
    source: 'esri',
    date,
    usesSentinel: false,
    reason: 'Esri 高解析空拍 — 沒有 Sentinel 金鑰時，解析度最高的免金鑰來源',
    caveat:
      '⚠ 沒有 Sentinel 金鑰：高解析空拍是歷年鑲嵌圖，看得到地形、港口與固定設施，' +
      '但看不到「今天」的船。每日影像（VIIRS/MODIS）是當日沒錯，但 250–375m／像素，' +
      '小艇連一個點都不到。要掃「當日船隻」請到 ⚙️ 設定填 Sentinel 金鑰。',
  }
}

/** YYYY-MM-DD 往前 n 天。 */
export function daysBefore(date: string, n: number): string {
  const t = Date.parse(`${date}T00:00:00Z`)
  if (!Number.isFinite(t)) return date
  return new Date(t - n * 86400000).toISOString().slice(0, 10)
}

export type ScanSeverity = 'none' | 'info' | 'alert'

export interface ScanSummary {
  severity: ScanSeverity
  /** 一句話結論。 */
  headline: string
  /** 細節，每行一條。 */
  lines: string[]
  /** 沒有 AIS 訊號的目標，分數高的在前（值班要優先查的就是這些）。 */
  suspicious: Detection[]
}

/**
 * 把一堆偵測點講成人話。
 *
 * 重點是「要先看哪一個」：有 AIS 比對時，沒有 AIS 訊號的目標排最前面，
 * 那才是值得查的。沒有 AIS 金鑰時要明講「分不出已知與可疑」，
 * 不能讓人誤以為全部都是可疑目標。
 */
export function summarizeScan(targets: Detection[], aisOn: boolean): ScanSummary {
  if (targets.length === 0) {
    return {
      severity: 'none',
      headline: '這個畫面沒有明顯目標',
      lines: ['可以放大一點、換個日期，或把靈敏度調高再掃一次。'],
      suspicious: [],
    }
  }

  const suspicious = targets
    .filter((t) => t.ais === 'none')
    .sort((a, b) => b.score - a.score)

  // 依尺度分類統計，讓人一眼知道是小艇還是大船居多。
  const byCls = new Map<string, number>()
  for (const t of targets) byCls.set(t.cls, (byCls.get(t.cls) ?? 0) + 1)
  const breakdown = [...byCls.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cls, n]) => `${cls} ×${n}`)

  if (!aisOn) {
    return {
      severity: 'info',
      headline: `找到 ${targets.length} 個目標，但分不出已知或可疑`,
      lines: [
        '沒有 AIS 金鑰，無法比對「哪些船有回報身分」——所以這些目標不等於可疑。',
        ...breakdown,
      ],
      suspicious: [],
    }
  }

  if (suspicious.length === 0) {
    return {
      severity: 'info',
      headline: `${targets.length} 個目標全部對得到 AIS`,
      lines: ['畫面上每個目標都有船舶自動識別訊號，沒有「影像上有、AIS 上沒有」的。', ...breakdown],
      suspicious: [],
    }
  }

  return {
    severity: 'alert',
    headline: `⚠ ${suspicious.length} 個目標沒有 AIS 訊號（共 ${targets.length} 個）`,
    lines: [
      '「影像上有、AIS 上沒有」的優先查。注意：關機、小船免裝、訊號被遮蔽都會造成沒有 AIS，不等於違法。',
      ...breakdown,
    ],
    suspicious,
  }
}

/** 一鍵掃描的進行階段，用來顯示進度。 */
export type QuickScanPhase =
  | 'idle'
  | 'switching'
  | 'loading'
  | 'scanning'
  | 'done'
  | 'error'

export const PHASE_LABEL: Record<QuickScanPhase, string> = {
  idle: '',
  switching: '切到沿岸光學、挑影像來源…',
  loading: '等衛星影像載入…',
  scanning: '掃描亮點、比對 AIS…',
  done: '完成',
  error: '失敗',
}
