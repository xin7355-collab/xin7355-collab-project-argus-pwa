import { useState } from 'react'
import { useTacticalStore } from '../store/tacticalStore'
import { haversineNm, bearingDeg } from '../map/MeasureLayer'

const SPEEDS = [10, 15, 20, 25, 30]

/**
 * 量測工具：右上浮動鈕開關「點地圖量距離/方位」，開啟時顯示總距離、各段方位，
 * 以及在選定航速下走完全程的預估時間（ETA），當快速航程規劃用。
 */
export function MeasureControl() {
  const measuring = useTacticalStore((s) => s.measuring)
  const points = useTacticalStore((s) => s.measurePoints)
  const clear = useTacticalStore((s) => s.clearMeasure)
  const popPoint = useTacticalStore((s) => s.popMeasurePoint)
  const toggleMeasure = useTacticalStore((s) => s.toggleMeasure)
  const [speed, setSpeed] = useState(20)

  let total = 0
  for (let i = 1; i < points.length; i++) {
    total += haversineNm(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng)
  }
  const last =
    points.length >= 2
      ? bearingDeg(
          points[points.length - 2].lat,
          points[points.length - 2].lng,
          points[points.length - 1].lat,
          points[points.length - 1].lng,
        )
      : null

  return (
    <>
      {measuring && (
        <div className="safe-top pointer-events-auto absolute left-1/2 top-0 z-[1100] mt-12 flex max-w-[95vw] -translate-x-1/2 flex-col gap-1 rounded-lg border border-tactical-cyan/50 bg-tactical-panel/95 px-3 py-2">
          <div className="flex items-center gap-3">
            <div className="flex min-w-0 flex-col">
              <span className="font-mono text-sm font-bold text-tactical-cyan">
                {points.length < 2 ? '點地圖加點量測' : `${total.toFixed(2)} 浬`}
              </span>
              <span className="text-[0.625rem] text-slate-400">
                {points.length < 2
                  ? '點大概位置後可拖曳控點微調'
                  : `末段方位 ${last != null ? Math.round(last) : '—'}° · ${points.length} 點`}
              </span>
            </div>
            <button
              onClick={popPoint}
              disabled={points.length === 0}
              className="rounded border border-slate-600 px-2 py-1 text-[0.6875rem] text-slate-300 active:scale-95 disabled:opacity-40"
            >
              ↩ 撤銷
            </button>
            <button
              onClick={clear}
              className="rounded border border-slate-600 px-2 py-1 text-[0.6875rem] text-slate-300 active:scale-95"
            >
              清除
            </button>
            <button
              onClick={toggleMeasure}
              className="rounded border border-rose-500/60 bg-rose-500/10 px-2 py-1 text-[0.6875rem] text-rose-300 active:scale-95"
            >
              結束
            </button>
          </div>
          {points.length >= 2 && (
            <div className="flex items-center gap-1.5 border-t border-slate-700/70 pt-1.5">
              <span className="text-[0.625rem] text-slate-400">航速</span>
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  onClick={() => setSpeed(s)}
                  className={`rounded border px-1.5 py-0.5 text-[0.625rem] font-semibold active:scale-95 ${
                    speed === s
                      ? 'border-tactical-cyan bg-tactical-cyan/15 text-tactical-cyan'
                      : 'border-slate-700 text-slate-400'
                  }`}
                >
                  {s}
                </button>
              ))}
              <span className="ml-auto font-mono text-[0.6875rem] text-tactical-green">
                🕑 {fmtEta(total / speed)}
              </span>
            </div>
          )}
          <span className="text-[0.5625rem] text-slate-500">💡 點地圖加點，再<b className="text-slate-300">拖曳圓形控點</b>到精準位置；「撤銷」刪最後一點。</span>
        </div>
      )}
    </>
  )
}

/** 小時（可為小數）→「H 時 M 分」。 */
function fmtEta(hours: number): string {
  const totalMin = Math.round(hours * 60)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return h > 0 ? `${h} 時 ${m} 分` : `${m} 分`
}
