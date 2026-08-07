import { useEffect, useRef } from 'react'
import { useTacticalStore } from '../store/tacticalStore'

/** 環境時間動畫控制：播放/暫停 + 時間軸拉桿 + 時間戳。 */
export function EnvAnimControls() {
  const times = useTacticalStore((s) => s.animTimes)
  const epoch = useTacticalStore((s) => s.animEpoch)
  const setEpoch = useTacticalStore((s) => s.setAnimEpoch)
  const playing = useTacticalStore((s) => s.animPlaying)
  const setPlaying = useTacticalStore((s) => s.setAnimPlaying)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const idx = Math.max(0, times.indexOf(epoch))

  // 播放迴圈：每 600ms 前進一小時，到底回頭。
  useEffect(() => {
    if (!playing || times.length === 0) return
    timerRef.current = setInterval(() => {
      const cur = useTacticalStore.getState().animEpoch
      const i = times.indexOf(cur)
      const next = i < 0 || i >= times.length - 1 ? 0 : i + 1
      useTacticalStore.getState().setAnimEpoch(times[next])
    }, 600)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [playing, times])

  const fmt = (e: number) => {
    if (!e) return '—'
    const d = new Date(e)
    const dd = `${d.getMonth() + 1}/${d.getDate()}`
    const hh = String(d.getHours()).padStart(2, '0')
    return `${dd} ${hh}:00`
  }
  const isNow = (e: number) => Math.abs(e - Date.now()) < 1800_000

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-slate-700 bg-tactical-panel/90 p-3">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setPlaying(!playing)}
          disabled={times.length === 0}
          className="flex h-9 w-12 items-center justify-center rounded-lg border border-tactical-cyan bg-tactical-cyan/15 text-lg text-tactical-cyan active:scale-95 disabled:opacity-40"
        >
          {playing ? '⏸' : '▶'}
        </button>
        <div className="flex flex-1 flex-col">
          <span className="font-mono text-sm font-bold text-tactical-green">
            {fmt(epoch)} {isNow(epoch) && <span className="text-tactical-cyan">· 現在</span>}
          </span>
          <span className="text-[0.625rem] text-slate-500">
            {times.length ? `第 ${idx + 1}/${times.length} 小時` : '載入中…'}
          </span>
        </div>
      </div>

      <input
        type="range"
        min={0}
        max={Math.max(0, times.length - 1)}
        step={1}
        value={idx}
        onChange={(e) => {
          setPlaying(false)
          setEpoch(times[Number(e.target.value)] ?? 0)
        }}
        className="w-full accent-cyan-400"
      />

      <div className="flex gap-4 text-[0.625rem] text-slate-500">
        <span>
          <span className="text-tactical-green">▬</span> 洋流
        </span>
        <span>
          <span className="text-tactical-cyan">┄</span> 風向
        </span>
        <span>免金鑰 · Open-Meteo 逐時預報</span>
      </div>
    </div>
  )
}
