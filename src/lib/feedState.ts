// ── 每個資料來源的狀態（圖層面板上的燈號）────────────────────
//
// 以前每個圖層各自把結果丟到底部提示，幾秒就消失；而且好幾個圖層「抓失敗」跟「沒資料」
// 長得一樣——能見度抓不到時甚至顯示「目前視野內大致良好」，是錯的放心。
// 改成每個來源留一個狀態，圖層面板在打勾的那一列下面一直顯示。
// 狀態的分法參考 gods-eye-view（MIT，見 docs/licenses/gods-eye-view-MIT.txt）的 src/data/feedState.js，
// 另外照本專案的規則分出「還沒設定」（安靜、灰色）與「真的壞掉」（紅色）。

export type FeedState = 'loading' | 'ok' | 'empty' | 'fallback' | 'stale' | 'error' | 'unconfigured'

export interface FeedStatus {
  state: FeedState
  /** 一句話：載入了什麼，或為什麼不行、可以怎麼做。 */
  text: string
  at: number
}

export const FEED_LOOK: Record<FeedState, { dot: string; label: string; cls: string }> = {
  loading: { dot: '⏳', label: '載入中', cls: 'text-slate-400' },
  ok: { dot: '🟢', label: '正常', cls: 'text-tactical-green' },
  empty: { dot: '⚪', label: '這裡沒有資料', cls: 'text-slate-400' },
  fallback: { dot: '🟡', label: '改用備援', cls: 'text-amber-300' },
  stale: { dot: '🟡', label: '資料不新', cls: 'text-amber-300' },
  error: { dot: '🔴', label: '抓不到', cls: 'text-rose-300' },
  unconfigured: { dot: '⚪', label: '還沒設定', cls: 'text-slate-400' },
}

/** 把錯誤轉成一句話（Error 用它的訊息；其他給通用的）。 */
export function errText(e: unknown, fallback = '連線失敗，稍後再試'): string {
  return e instanceof Error && e.message ? e.message : fallback
}
