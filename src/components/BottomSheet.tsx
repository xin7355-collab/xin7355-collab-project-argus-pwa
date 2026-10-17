import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { nearestSnap, snapHeights, tapCycle, type Snap } from '../lib/sheet'

/**
 * 可拖曳的底部抽屜（像 Google／Apple 地圖）。
 *
 * 做法：抽屜永遠是「全開」那麼高，用 translateY 往下推到只露出目前那一段。
 * 拖的時候只改 transform（不重新排版，iPhone 上才跟得上手指），
 * 放手後才把內容區的高度設成那一段，讓清單能捲到底。
 *
 * 只有把手和標題列能拖。內容區留給捲動——兩者搶同一個手勢，
 * 使用者會在想捲清單時把抽屜拖走。
 */
export function BottomSheet({
  snap,
  onSnap,
  header,
  children,
}: {
  snap: Snap
  onSnap: (s: Snap) => void
  /** 收起時仍看得到的那一段。 */
  header: ReactNode
  children: ReactNode
}) {
  const headerRef = useRef<HTMLDivElement>(null)
  const probeRef = useRef<HTMLDivElement>(null)
  const topProbeRef = useRef<HTMLDivElement>(null)
  const [vh, setVh] = useState(() => window.innerHeight)
  const [headH, setHeadH] = useState(96)
  const [safeBottom, setSafeBottom] = useState(0)
  const [safeTop, setSafeTop] = useState(0)
  const [dragH, setDragH] = useState<number | null>(null)
  const drag = useRef<{ y0: number; h0: number; samples: { t: number; y: number }[]; moved: boolean } | null>(
    null,
  )

  // 畫面高度：iPhone 轉向、鍵盤彈出都會變
  useEffect(() => {
    const on = () => setVh(window.visualViewport?.height ?? window.innerHeight)
    on()
    window.addEventListener('resize', on)
    window.visualViewport?.addEventListener('resize', on)
    return () => {
      window.removeEventListener('resize', on)
      window.visualViewport?.removeEventListener('resize', on)
    }
  }, [])

  // 標題列多高 → 收起時露多少。標題列內容會變（模式名稱、迷你時間軸），要一直量
  useLayoutEffect(() => {
    const el = headerRef.current
    if (!el) return
    const measure = () => setHeadH(el.getBoundingClientRect().height)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useLayoutEffect(() => {
    if (probeRef.current) setSafeBottom(probeRef.current.getBoundingClientRect().height)
    if (topProbeRef.current) setSafeTop(topProbeRef.current.getBoundingClientRect().height)
  }, [vh])

  // 把手 22px ＋ 標題列 ＋ Home 指示條
  const GRAB = 22
  const peekH = Math.round(GRAB + headH + safeBottom + 6)
  // 全開也不能蓋住搜尋列（瀏海／動態島＋搜尋列約 60px＋一點間距）
  const hs = snapHeights(vh, peekH, safeTop + 68)
  const target = hs[snap]
  const shown = dragH ?? target

  // 告訴其他浮動元件抽屜現在多高（CSS 變數，拖曳時每格更新）。
  // 抽屜拉得很高時，跟著它往上推的按鈕、比例尺會撞進搜尋列——那時地圖幾乎
  // 被蓋光了，這些按鈕本來就沒用，直接藏起來（sheet-tall）。
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--sheet-h', `${Math.round(shown)}px`)
    root.classList.toggle('sheet-tall', shown > vh * 0.62)
  }, [shown, vh])

  const onDown = (e: React.PointerEvent) => {
    // 標題列上的按鈕（例如「結束」）要能正常按，不能被當成拖曳
    if ((e.target as HTMLElement).closest('button, input, select, a, label')) return
    drag.current = { y0: e.clientY, h0: shown, samples: [{ t: e.timeStamp, y: e.clientY }], moved: false }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dy = e.clientY - d.y0
    if (!d.moved && Math.abs(dy) < 6) return
    if (!d.moved) document.documentElement.classList.add('sheet-dragging')
    d.moved = true
    d.samples.push({ t: e.timeStamp, y: e.clientY })
    if (d.samples.length > 5) d.samples.shift()
    setDragH(Math.max(hs.peek, Math.min(hs.full, d.h0 - dy)))
  }
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    document.documentElement.classList.remove('sheet-dragging')
    if (!d) return
    if (!d.moved) {
      // 點一下把手／標題列空白處：收起→一半→全開→一半
      onSnap(tapCycle(snap))
      return
    }
    const s0 = d.samples[0]
    const s1 = d.samples[d.samples.length - 1]
    const dt = Math.max(1, s1.t - s0.t)
    const v = -(s1.y - s0.y) / dt // 往上為正
    const h = Math.max(hs.peek, Math.min(hs.full, d.h0 - (e.clientY - d.y0)))
    setDragH(null)
    onSnap(nearestSnap(h, v, hs))
  }

  return (
    <div
      className="pointer-events-auto absolute inset-x-0 bottom-0 z-[1000] flex flex-col rounded-t-2xl border-t border-slate-700/80 bg-tactical-bg/95 shadow-[0_-8px_24px_rgba(0,0,0,0.45)] backdrop-blur md:left-3 md:right-auto md:w-[26rem]"
      style={{
        height: hs.full,
        transform: `translateY(${hs.full - shown}px)`,
        transition: dragH === null ? 'transform 260ms cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none',
      }}
    >
      <div ref={probeRef} className="safe-bottom-probe" />
      <div ref={topProbeRef} className="safe-bottom-probe" style={{ height: 'env(safe-area-inset-top)' }} />
      <div
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        className="shrink-0 cursor-grab select-none"
        style={{ touchAction: 'none' }}
      >
        <div className="flex h-[22px] items-center justify-center" aria-label="拖曳或點一下調整面板高度">
          <span className="h-1.5 w-10 rounded-full bg-slate-500/80" />
        </div>
        <div ref={headerRef}>{header}</div>
      </div>
      <div
        className="min-h-0 overflow-y-auto overscroll-contain px-3 pad-safe-bottom"
        style={{ height: Math.max(0, target - GRAB - headH) }}
      >
        {children}
      </div>
    </div>
  )
}
