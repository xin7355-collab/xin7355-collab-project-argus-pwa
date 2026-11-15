import { useTacticalStore } from '../store/tacticalStore'

/**
 * 手機按「🌐 3D 地球」時先問：講清楚會怎樣（要下載多少、耗電、可能被重新載入），
 * 使用者還是可以選「仍要開」——不擅自禁止，只把代價講清楚。
 */
export function GlobeAsk() {
  const why = useTacticalStore((s) => s.globeAsk)
  const setGlobeAsk = useTacticalStore((s) => s.setGlobeAsk)
  const setOpenTool = useTacticalStore((s) => s.setOpenTool)
  if (!why) return null
  return (
    <div className="pointer-events-auto fixed inset-0 z-[2500] flex items-end justify-center bg-black/60 p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] md:items-center">
      <div role="dialog" aria-modal="true" aria-labelledby="globe-ask-title" className="w-full max-w-sm rounded-2xl border border-slate-600 bg-tactical-bg p-4">
        <h2 id="globe-ask-title" className="text-base font-bold text-tactical-cyan">
          🌐 3D 地球是桌機功能
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-200">{why}</p>
        <p className="mt-2 text-xs leading-relaxed text-slate-400">
          在電腦上用瀏覽器打開同一個網址就能用；分享畫面（🔗）可以把現在的位置帶過去。
        </p>
        <div className="mt-4 flex gap-2">
          <button onClick={() => setGlobeAsk(null)} className="min-h-[44px] flex-1 rounded-xl border border-slate-500 text-sm font-semibold text-slate-100">
            先不要
          </button>
          <button
            onClick={() => {
              setGlobeAsk(null)
              setOpenTool('globe')
            }}
            className="min-h-[44px] flex-1 rounded-xl bg-amber-400 text-sm font-bold text-slate-900"
          >
            仍要開
          </button>
        </div>
      </div>
    </div>
  )
}
