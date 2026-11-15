import { useEffect, useRef, useState } from 'react'
import { useTacticalStore } from '../store/tacticalStore'
import { fetchTleGroup } from '../lib/satFleet'
import { SAR_ACCESS_KM, sarOpportunities, type SarSummary } from '../lib/sarOps'
import { formatDist } from '../lib/units'

function hm(ms: number): string {
  const d = new Date(ms)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * 其他國家／商業雷達衛星：未來 24 小時有幾次經過、側擺得到這片海。
 * 按了才算（100 多顆衛星，平常不要在手機上白算）。
 */
export function SarOpsPanel() {
  const mapView = useTacticalStore((s) => s.mapView)
  const unit = useTacticalStore((s) => s.distUnit)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [stale, setStale] = useState<string | null>(null)
  const [rows, setRows] = useState<SarSummary[] | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const run = async () => {
    setBusy(true)
    setErr('')
    try {
      const { text, stale } = await fetchTleGroup('sar')
      const now = Date.now()
      const out = await sarOpportunities(text, mapView.lat, mapView.lng, now, now + 24 * 3600_000, { yieldEvery: 8 })
      if (!alive.current) return
      setStale(stale)
      setRows(out)
    } catch (e) {
      if (!alive.current) return
      setRows(null)
      setErr(`取不到雷達衛星的軌道根數：${e instanceof Error ? e.message : '連線失敗'}。稍後再按一次。`)
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  return (
    <details className="mt-2 rounded-lg border border-slate-700 bg-slate-900/40 p-2">
      <summary className="cursor-pointer text-[0.6875rem] font-semibold text-tactical-cyan">
        📡 其他國家／商業雷達衛星（付費下單才會拍）
      </summary>
      <p className="mt-1.5 text-[0.625rem] leading-relaxed text-slate-400">
        ICEYE、Capella、COSMO-SkyMed、RCM 等雷達衛星多半是有人付費下單才拍，可以側擺、左右都能拍。
        這裡算未來 24 小時有幾次經過、而且這片海在它側擺得到的範圍內——要申請影像時知道找誰、什麼時候。
        <b className="text-amber-300">經過不等於會拍。</b>
        側擺範圍統一用軌跡兩側約 {formatDist(SAR_ACCESS_KM, unit, 0)} 的概估（各家規格不同，沒有逐一查證）。
      </p>
      <button
        onClick={run}
        disabled={busy}
        className="mt-1.5 w-full rounded border border-tactical-cyan/60 bg-tactical-cyan/10 py-1.5 text-[0.6875rem] font-bold text-tactical-cyan active:scale-95 disabled:opacity-60"
      >
        {busy ? '⏳ 計算中（100 多顆，約幾秒）…' : rows ? '🔄 用目前畫面中心重算' : '🔎 算畫面中心未來 24 小時'}
      </button>
      {err && <p className="mt-1.5 text-[0.625rem] leading-relaxed text-rose-300">{err}</p>}
      {stale && <p className="mt-1.5 text-[0.625rem] leading-relaxed text-amber-300">⚠ {stale}</p>}
      {rows && rows.length === 0 && (
        <p className="mt-1.5 text-[0.625rem] text-slate-400">未來 24 小時沒有雷達衛星側擺得到這裡。</p>
      )}
      {rows && rows.length > 0 && (
        <div className="mt-1.5 flex flex-col gap-1">
          {rows.map((r) => (
            <div key={r.operator} className="rounded border border-slate-700 bg-slate-900/60 px-2 py-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[0.6875rem] font-bold text-slate-200">{r.operator}</span>
                <span className="font-mono text-[0.625rem] text-tactical-cyan">{r.count} 次</span>
              </div>
              <div className="text-[0.5625rem] text-slate-500">{r.note}</div>
              <div className="font-mono text-[0.5625rem] text-slate-400">
                最早：{r.next.map((n) => `${hm(n.ms)}（${n.craft}）`).join('、')}
              </div>
            </div>
          ))}
        </div>
      )}
    </details>
  )
}
