// ── 工具使用紀錄：讓「常用」排到最前面 ─────────────────────
//
// 工具總表一次攤開 13 個格子、沒有分組也沒有排序，每次都要從頭找。
// 實際上每個人固定只用其中三四個。這裡記住最近用過的，置頂一排。
//
// 只存工具 id，不存時間也不存任何位置資訊——這份紀錄跟著備份一起走，
// 沒必要讓它帶上額外的個資。

const KEY = 'argus.recentTools.v1'
/** 置頂最多幾個。太多就失去「一眼看到」的意義。 */
export const RECENT_MAX = 4

export function loadRecentTools(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const v: unknown = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX) : []
  } catch {
    return []
  }
}

/** 把 id 移到最前面（已存在就往前提，不重複）。 */
export function pushRecentTool(id: string, prev: string[]): string[] {
  const next = [id, ...prev.filter((x) => x !== id)].slice(0, RECENT_MAX)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* 記不住就算了，不影響功能 */
  }
  return next
}
