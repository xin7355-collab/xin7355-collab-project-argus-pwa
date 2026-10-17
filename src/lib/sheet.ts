// ── 底部抽屜的三段高度與「放手後要停在哪」 ─────────────────────
//
// 舊版是「面板固定佔 46vh＋底下一排橫滑模式鈕」，實測地圖只剩 38% 看得到，
// 而且收合要按一顆「▾ 收合面板」。改成 Google Maps 那種可拖的抽屜：
//   收起（peek）：只剩標題列，地圖幾乎全看得到
//   一半（half）：操作和地圖各一半
//   全開（full）：要填表、看清單時
//
// 這裡只放數學，不碰 DOM，才能離線測。

export type Snap = 'peek' | 'half' | 'full'

export interface SnapHeights {
  peek: number
  half: number
  full: number
}

/**
 * 三段高度（px）。
 * @param viewportH 畫面高
 * @param peekH 收起時要露出的高度（把手＋標題列＋底部安全區），由畫面量測
 * @param topReserve 頂端要留給搜尋列的高度——全開也不能蓋住搜尋列
 */
export function snapHeights(viewportH: number, peekH: number, topReserve: number): SnapHeights {
  const full = Math.max(peekH, Math.round(viewportH - topReserve))
  // 一半：約 46%，但至少比收起高 120px（太矮的手機上「一半」不能跟「收起」差不多）
  const half = Math.min(full, Math.max(peekH + 120, Math.round(viewportH * 0.46)))
  return { peek: Math.min(peekH, full), half, full }
}

/** 放手時速度超過這個（px/ms）視為「甩」，照方向跳一格，不看停在哪。 */
export const FLICK_SPEED = 0.45

/**
 * 放手後停哪一段。
 * @param h 放手當下的高度
 * @param v 放手前的速度，往上（變高）為正
 */
export function nearestSnap(h: number, v: number, hs: SnapHeights): Snap {
  const order: Snap[] = ['peek', 'half', 'full']
  // 先找目前最接近的一段
  let idx = 0
  let best = Infinity
  order.forEach((s, i) => {
    const d = Math.abs(hs[s] - h)
    if (d < best) {
      best = d
      idx = i
    }
  })
  if (Math.abs(v) < FLICK_SPEED) return order[idx]

  // 甩：往甩的方向找「第一個還沒越過」的段。
  // 用「越過」而不是「最近的下一段」，否則從收起往上甩，停在半路的高度
  // 比較靠近 half，結果跳到 full——一甩跳兩格，很難控制。
  if (v > 0) {
    for (const s of order) if (hs[s] > h + 1) return s
    return 'full'
  }
  for (let i = order.length - 1; i >= 0; i--) if (hs[order[i]] < h - 1) return order[i]
  return 'peek'
}

/** 點一下把手：收起→一半→全開→一半… 像 Apple 地圖。 */
export function tapCycle(s: Snap): Snap {
  return s === 'peek' ? 'half' : s === 'half' ? 'full' : 'half'
}
