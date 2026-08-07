import { useTacticalStore } from '../store/tacticalStore'

/** 攔截疊層顯示時的小工具列：重開面板／清除圖上幾何。 */
export function InterceptControl() {
  const sol = useTacticalStore((s) => s.interceptSolution)
  const setSol = useTacticalStore((s) => s.setInterceptSolution)
  const setOpenTool = useTacticalStore((s) => s.setOpenTool)

  if (!sol) return null

  return (
    <div className="safe-top pointer-events-auto absolute left-1/2 top-0 z-[1100] mt-20 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-amber-500/50 bg-tactical-panel/95 px-3 py-1.5">
      <span className="font-mono text-xs font-bold text-amber-300">🎯 攔截</span>
      <button
        onClick={() => setOpenTool('intercept')}
        className="rounded border border-slate-600 px-2 py-1 text-[0.6875rem] text-slate-300 active:scale-95"
      >
        重新計算
      </button>
      <button
        onClick={() => setSol(null)}
        className="rounded border border-rose-500/60 bg-rose-500/10 px-2 py-1 text-[0.6875rem] text-rose-300 active:scale-95"
      >
        清除
      </button>
    </div>
  )
}
