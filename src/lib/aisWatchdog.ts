// ── AIS 即時性看門狗 ───────────────────────────────────────
//
// 核心觀念（參考 gods-eye-view, MIT License, Copyright (c) 2026 Bilawal Sidhu
// 的 src/data/aisWatchdog.js 設計）：
//
//   **存活要看「有沒有資料」，不是看 socket 狀態。**
//
// aisstream 可以握手成功之後就完全沉默——不送訊框、不報錯、也不關閉。
// 這時 readyState 永遠是 OPEN，onclose 永遠不會觸發，只證明「曾經握手成功過」。
//
// 本 App 原本的寫法正中這個陷阱：只在 onopen 之後設一次 15 秒計時器，
// 收到第一筆訊息就清掉、不再重設。於是連線中途靜默時會一直顯示「已連線」，
// 永遠不重連，而且繼續把幾小時前的船位當成即時資料。
//
// 對這個 App 來說那特別危險：亮點掃描的「無 AIS = 可疑」就是拿這份資料比對的。
// 船位過期會同時造成兩種錯——移走的船留在舊位置害目標被誤判為「已知」，
// 真的在那裡的船因為位置沒更新而被標成「可疑」。兩個方向都會害人做錯判斷。
// 所以過期時要回報「比不了」，不是硬比。
//
// 兩個預算刻意分開：
//   staleMs        多久沒資料就「告訴使用者」資料不新了（快）
//   recycleAfterMs 多久沒資料才真的砍掉重連（慢）
// 分開的原因：aisstream 免費版同一把金鑰只允許一條連線，重連太積極會自己打自己。
//
// 時間一律用單調時鐘（performance.now）量。用牆上時鐘的話，手機校時往回跳
// 會讓「過期」被誤判成「剛更新」。

export type AisHealth =
  | 'idle'
  | 'connecting'
  /** 最近有收到資料，可以信任。 */
  | 'live'
  /** 連著但太久沒資料——還不重連，但使用者要知道資料不新了。 */
  | 'stale'
  /** 沉默太久，socket 不會自己關，要主動砍掉重連。 */
  | 'recycle'
  /** 金鑰被拒。重試再多次也沒用，要等使用者換金鑰。 */
  | 'auth-blocked'

export interface WatchdogBudgets {
  /** 多久沒資料算不新（毫秒）。 */
  staleMs: number
  /** 多久沒資料要強制重連（毫秒）。 */
  recycleAfterMs: number
}

export const AIS_WATCHDOG_DEFAULTS: WatchdogBudgets = {
  // 船位回報本來就疏（靜止船可能數分鐘才一筆），兩分鐘沒東西才算不新。
  staleMs: 120_000,
  // 五分鐘完全沉默＝這條連線已經死了但不自知。
  recycleAfterMs: 300_000,
}

export interface WatchdogState {
  /** 最後一次收到「有效 AIS 資料」的單調時間。null＝還沒收過。 */
  lastDataAt: number | null
  /** 連線建立（握手成功）的單調時間。null＝沒有連線。 */
  connectedAt: number | null
  /** 金鑰被拒就設 true，直到使用者換金鑰。 */
  authBlocked: boolean
}

export function initialWatchdogState(): WatchdogState {
  return { lastDataAt: null, connectedAt: null, authBlocked: false }
}

export interface WatchdogVerdict {
  health: AisHealth
  /** 距離最後一筆資料多久（毫秒）。沒收過資料回 null。 */
  ageMs: number | null
  /** 掃描等需要「可信 AIS」的功能可不可以用這份資料。 */
  usable: boolean
  /** 給使用者看的一句話。空字串＝沒什麼好說的。 */
  message: string
}

function ageText(ms: number): string {
  const min = Math.round(ms / 60000)
  if (min < 1) return '不到 1 分鐘'
  if (min < 60) return `${min} 分鐘`
  return `${Math.round(min / 60)} 小時`
}

/**
 * 判斷目前這條 AIS 連線能不能信。
 *
 * now 要傳單調時鐘（performance.now），不要傳 Date.now。
 */
export function evaluateWatchdog(
  state: WatchdogState,
  now: number,
  budgets: WatchdogBudgets = AIS_WATCHDOG_DEFAULTS,
): WatchdogVerdict {
  if (state.authBlocked) {
    return {
      health: 'auth-blocked',
      ageMs: state.lastDataAt === null ? null : now - state.lastDataAt,
      usable: false,
      message: 'AIS：金鑰被拒，重試無效。請到 ⚙️ 設定換一把有效的 aisstream 金鑰。',
    }
  }
  if (state.connectedAt === null) {
    return { health: 'idle', ageMs: null, usable: false, message: '' }
  }
  if (state.lastDataAt === null) {
    // 握手成功但一筆都還沒來。給它一個 staleMs 的寬限，之後就算沉默。
    const waited = now - state.connectedAt
    if (waited < budgets.staleMs) {
      return { health: 'connecting', ageMs: null, usable: false, message: '' }
    }
    if (waited >= budgets.recycleAfterMs) {
      return {
        health: 'recycle',
        ageMs: null,
        usable: false,
        message: 'AIS：連上後一直沒有資料，重新連線中…',
      }
    }
    return {
      health: 'stale',
      ageMs: null,
      usable: false,
      message:
        'AIS：已連線但一直沒有船位。最可能是同一把金鑰在別的裝置/分頁也開著' +
        '（免費版限 1 條連線），或金鑰無效／額度用盡。',
    }
  }

  const age = now - state.lastDataAt
  if (age >= budgets.recycleAfterMs) {
    return {
      health: 'recycle',
      ageMs: age,
      usable: false,
      message: `AIS：已經 ${ageText(age)} 沒有新船位，連線可能已經死了，重新連線中…`,
    }
  }
  if (age >= budgets.staleMs) {
    return {
      health: 'stale',
      ageMs: age,
      usable: false,
      message: `AIS：已經 ${ageText(age)} 沒有新船位，畫面上的船位不是最新的。`,
    }
  }
  return { health: 'live', ageMs: age, usable: true, message: '' }
}

/** 重連退避：只有「真的傳輸故障」才走這個梯子。 */
export function backoffMs(attempt: number): number {
  const ladder = [5_000, 15_000, 60_000, 300_000]
  return ladder[Math.min(attempt, ladder.length - 1)]
}

/**
 * aisstream 回的錯誤是不是「金鑰問題」。
 *
 * 要分清楚：金鑰被拒再怎麼重試都沒用，一直重連只是浪費連線數並蓋掉真正的原因；
 * 傳輸故障才值得退避重試。
 */
export function isAuthFailure(errorText: string): boolean {
  const t = errorText.toLowerCase()
  return (
    t.includes('api key') ||
    t.includes('apikey') ||
    t.includes('invalid key') ||
    t.includes('unauthor') ||
    t.includes('forbidden') ||
    t.includes('authentication')
  )
}


// ── 「一連上就被切斷」＝金鑰多半無效 ─────────────────────────
//
// 實測（2026-10，GitHub Actions 打真的 aisstream）：送出無效金鑰後，
// 它約 1 秒就把連線切斷，code 1006、**沒有任何原因文字，也不回錯誤訊息**。
// 所以上面 isAuthFailure 看文字的判斷永遠等不到東西，App 只會一直顯示
// 「連線中斷，幾秒後重連」，使用者完全不知道是金鑰的問題。
//
// 改看行為：連上後很快就斷、而且一筆資料都沒收到，連續發生幾次，
// 幾乎就是金鑰被拒（網路不穩的斷線通常不會「每次都剛好一秒」）。

/** 連上後多快斷線算「秒斷」。 */
export const QUICK_DEATH_MS = 5_000
/** 連續秒斷幾次就判定金鑰有問題。一次可能只是網路抖動。 */
export const QUICK_DEATHS_FOR_KEY = 2

/**
 * 更新連續秒斷次數。
 * @param prev 之前連續秒斷幾次
 * @param aliveMs 這條連線從連上到斷線活了多久；null＝根本沒連上（網路問題，不算）
 * @param gotData 這條連線有沒有收到過任何一筆資料
 */
export function nextQuickDeaths(prev: number, aliveMs: number | null, gotData: boolean): number {
  if (gotData) return 0
  if (aliveMs === null) return prev
  return aliveMs < QUICK_DEATH_MS ? prev + 1 : 0
}

export function looksLikeBadKey(quickDeaths: number): boolean {
  return quickDeaths >= QUICK_DEATHS_FOR_KEY
}
