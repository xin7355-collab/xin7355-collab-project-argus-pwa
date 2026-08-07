import { useEffect, useRef, useState } from 'react'
import { isCwaConfigured } from '../lib/config'
import { fetchCwaAlerts } from '../lib/cwaAlerts'
import { useTacticalStore } from '../store/tacticalStore'

/**
 * CWA 天氣警特報浮動小卡（🚨）：只有「目前有生效警特報」時才出現。
 * 收合＝一顆小藥丸（⚠ N 則）；點開＝清單（海上相關標紅在前）。
 * 簡單操作：不干擾、要看才點開。每 15 分鐘自動更新。
 */
export function CwaAlertBanner() {
  const alerts = useTacticalStore((s) => s.cwaAlerts)
  const setCwaAlerts = useTacticalStore((s) => s.setCwaAlerts)
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!isCwaConfigured()) return
    let cancelled = false
    const load = async () => {
      const a = await fetchCwaAlerts()
      if (!cancelled) setCwaAlerts(a && a.length ? a : null)
    }
    load()
    timer.current = setInterval(load, 15 * 60 * 1000) // 每 15 分鐘更新
    return () => {
      cancelled = true
      if (timer.current) clearInterval(timer.current)
    }
  }, [setCwaAlerts])

  if (!alerts || !alerts.length) return null
  const seaCount = alerts.filter((a) => a.sea).length

  return (
    <div className="safe-top pointer-events-auto absolute left-1/2 top-0 z-[1150] mt-9 flex w-[min(92vw,26rem)] -translate-x-1/2 flex-col items-center">
      {/* 收合藥丸 */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[0.6875rem] font-bold active:scale-95 ${
          seaCount > 0
            ? 'border-rose-500/70 bg-rose-500/20 text-rose-100'
            : 'border-amber-500/70 bg-amber-500/20 text-amber-100'
        }`}
      >
        <span className="animate-pulse">🚨</span>
        <span>氣象警特報 {alerts.length} 則{seaCount > 0 ? `（海上相關 ${seaCount}）` : ''}</span>
        <span className="opacity-70">{open ? '▲' : '▼'}</span>
      </button>

      {/* 展開清單 */}
      {open && (
        <div className="mt-1 max-h-[55vh] w-full overflow-y-auto rounded-xl border border-slate-700 bg-tactical-bg/95 p-2 shadow-lg">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[0.6875rem] font-semibold text-tactical-cyan">🚨 中央氣象署 目前生效警特報</span>
            <button onClick={() => setOpen(false)} className="text-slate-400 active:scale-95">✕</button>
          </div>
          <div className="flex flex-col gap-1.5">
            {alerts.map((a, i) => (
              <div
                key={a.phenomena + a.significance + i}
                className={`rounded-lg border p-2 ${
                  a.sea ? 'border-rose-500/50 bg-rose-500/10' : 'border-amber-500/40 bg-amber-500/5'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className={`text-[0.8125rem] font-bold ${a.sea ? 'text-rose-200' : 'text-amber-200'}`}>
                    {a.sea ? '🌊' : '⚠'} {a.phenomena}
                    {a.significance ? ` · ${a.significance}` : ''}
                  </span>
                </div>
                {a.areas.length > 0 && (
                  <div className="mt-0.5 text-[0.625rem] leading-relaxed text-slate-300">
                    影響：{a.areas.slice(0, 12).join('、')}
                    {a.areas.length > 12 ? ` …等 ${a.areas.length} 區` : ''}
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-[0.5625rem] leading-relaxed text-slate-500">
            資料：中央氣象署 W-C0033-002（目前生效）。海上相關（強風／濃霧／長浪／大雨）以紅色標示並排前。每 15 分鐘更新。
          </p>
        </div>
      )}
    </div>
  )
}
