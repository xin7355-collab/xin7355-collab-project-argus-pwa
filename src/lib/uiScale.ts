// ── 介面字體大小（小/中/大/特大）──────────────────────────────
//
// 用「根 font-size」縮放：因全站文字/間距/格子皆以 rem 為單位（含已改為 rem 的
// 小字），改根 font-size 會讓文字、按鈕、格子一起等比放大，版面比例不變、
// 不會爆版（面板本身以 w-full 受視窗寬度約束，格內文字自動換行）。

const LS_KEY = 'argus.uiScale.v1'

export interface UiScaleOption {
  id: string
  label: string
  scale: number
}

/** 四段字體大小。中(1.0)＝瀏覽器預設 16px。 */
export const UI_SCALES: UiScaleOption[] = [
  { id: 'sm', label: '小', scale: 0.9 },
  { id: 'md', label: '中', scale: 1.0 },
  { id: 'lg', label: '大', scale: 1.15 },
  { id: 'xl', label: '特大', scale: 1.3 },
]

export function loadUiScale(): number {
  try {
    const v = parseFloat(localStorage.getItem(LS_KEY) || '')
    return Number.isFinite(v) && v >= 0.8 && v <= 1.5 ? v : 1
  } catch {
    return 1
  }
}

export function persistUiScale(v: number) {
  try {
    localStorage.setItem(LS_KEY, String(v))
  } catch {
    /* ignore quota */
  }
}

/** 套用到根元素（改 rem 基準）。地圖圖磚是 px 不受影響，只縮放 UI。 */
export function applyUiScale(v: number) {
  if (typeof document !== 'undefined') {
    document.documentElement.style.fontSize = Math.round(v * 100) + '%'
  }
}
