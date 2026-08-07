import { useTacticalStore } from '../store/tacticalStore'

/** 距離圈啟用時，畫面上方的小工具列：重新置中（到 GPS/畫面中心）／清除。 */
export function RangeRingControl() {
  const rangeCenter = useTacticalStore((s) => s.rangeCenter)
  const setRangeCenter = useTacticalStore((s) => s.setRangeCenter)
  const ownPosition = useTacticalStore((s) => s.ownPosition)
  const mapView = useTacticalStore((s) => s.mapView)

  if (!rangeCenter) return null

  return (
    <div className="safe-top pointer-events-auto absolute left-1/2 top-0 z-[1100] mt-12 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-sky-500/50 bg-tactical-panel/95 px-3 py-1.5">
      <span className="font-mono text-xs font-bold text-sky-300">◎ 距離圈</span>
      <button
        onClick={() => setRangeCenter(ownPosition ?? { lat: mapView.lat, lng: mapView.lng })}
        className="rounded border border-slate-600 px-2 py-1 text-[0.6875rem] text-slate-300 active:scale-95"
      >
        {ownPosition ? '置中到我' : '置中畫面'}
      </button>
      <button
        onClick={() => setRangeCenter(null)}
        className="rounded border border-rose-500/60 bg-rose-500/10 px-2 py-1 text-[0.6875rem] text-rose-300 active:scale-95"
      >
        清除
      </button>
    </div>
  )
}
