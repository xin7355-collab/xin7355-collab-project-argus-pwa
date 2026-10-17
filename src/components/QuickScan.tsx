import { useEffect, useRef, useState } from 'react'
import { useTacticalStore } from '../store/tacticalStore'
import { isAisConfigured, isSentinelConfigured } from '../lib/config'
import {
  PHASE_LABEL,
  planQuickScan,
  summarizeScan,
  type QuickScanPhase,
  type ScanSummary,
} from '../lib/quickScan'
import { formatDist } from '../lib/units'
import { distM } from '../lib/detection'

/**
 * 一鍵「這片海現在有什麼」。
 *
 * 原本要走完：切沿岸光學 → 挑來源 → 挑日期 → 等圖磚 → 按掃描 → 自己讀結果，
 * 六個動作散在三個面板。這顆按鈕一次跑完，並且把結果講成人話。
 *
 * 決策邏輯（挑來源、挑日期、結論怎麼講）在 lib/quickScan.ts，有單元測試。
 * 這裡只負責副作用：切模式、等圖磚載完、觸發掃描、顯示結果。
 */

/** 等圖磚載完。回傳是否真的載到東西。 */
async function waitForTiles(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  let lastCount = -1
  let stableFor = 0
  while (Date.now() < deadline) {
    // 同 BrightSpotLayer：className 在容器 div 上，圖磚本身是 .leaflet-tile。
    const holder = document.querySelector<HTMLElement>('.gibs-imagery')
    const imgs = holder ? [...holder.querySelectorAll<HTMLImageElement>('img')] : []
    const ready = imgs.filter((i) => i.complete && i.naturalWidth > 0)
    // 圖磚是陸續進來的：要等「數量不再變動」而不是等某個固定數字，
    // 否則在慢速行動網路上會抓到只載一半的畫面去掃描。
    if (ready.length > 0 && ready.length === lastCount) {
      stableFor += 1
      if (stableFor >= 3) return true
    } else {
      stableFor = 0
    }
    lastCount = ready.length
    await new Promise((r) => setTimeout(r, 300))
  }
  return lastCount > 0
}

export function QuickScan() {
  const mode = useTacticalStore((s) => s.mode)
  const setMode = useTacticalStore((s) => s.setMode)
  const setOpticalSource = useTacticalStore((s) => s.setOpticalSource)
  const setOpticalRadar = useTacticalStore((s) => s.setOpticalRadar)
  const setObservationDate = useTacticalStore((s) => s.setObservationDate)
  const bumpScan = useTacticalStore((s) => s.bumpScan)
  const gotoCoord = useTacticalStore((s) => s.gotoCoord)
  const setStatus = useTacticalStore((s) => s.setStatus)
  const unit = useTacticalStore((s) => s.distUnit)
  const mapView = useTacticalStore((s) => s.mapView)

  const [phase, setPhase] = useState<QuickScanPhase>('idle')
  const [summary, setSummary] = useState<ScanSummary | null>(null)
  const [caveat, setCaveat] = useState('')
  const [reason, setReason] = useState('')
  const busy = useRef(false)

  const run = async () => {
    if (busy.current) return
    busy.current = true
    setSummary(null)
    try {
      const plan = planQuickScan({
        hasSentinel: isSentinelConfigured(),
        today: new Date().toISOString().slice(0, 10),
      })
      setReason(plan.reason)
      setCaveat(plan.caveat)

      setPhase('switching')
      if (mode !== 'optical') setMode('optical')
      setOpticalRadar(false)
      if (!plan.usesSentinel) setOpticalSource(plan.source)
      setObservationDate(plan.date)
      // 讓 React 把狀態寫進去、圖層重建後再往下走
      await new Promise((r) => setTimeout(r, 700))

      setPhase('loading')
      const got = await waitForTiles(20000)
      if (!got) {
        setPhase('error')
        setStatus('⚠ 衛星影像載不進來（可能是網路、或這個日期沒有影像）。換個日期再試。')
        return
      }

      setPhase('scanning')
      const before = useTacticalStore.getState().scanDoneTick
      bumpScan()
      // 等掃描「完成」——不能只看有沒有結果，因為「掃完但一個都沒有」也是合法結果
      const deadline = Date.now() + 15000
      while (Date.now() < deadline) {
        if (useTacticalStore.getState().scanDoneTick !== before) break
        await new Promise((r) => setTimeout(r, 200))
      }

      const spots = useTacticalStore.getState().brightSpots
      // 同 BrightSpotLayer：有金鑰 ≠ 資料可信，過期就不要下「可疑」的結論。
      const aisUsable = isAisConfigured() && useTacticalStore.getState().aisUsable
      setSummary(summarizeScan(spots, aisUsable))
      setPhase('done')
    } catch (e) {
      setPhase('error')
      setStatus(`⚠ 一鍵掃描失敗：${e instanceof Error ? e.message : '未知錯誤'}`)
    } finally {
      busy.current = false
    }
  }

  const running = phase === 'switching' || phase === 'loading' || phase === 'scanning'

  // 觸發來源從浮動圓鈕搬到功能清單的「⚡ 一鍵掃描」（store 的計數器每 +1 跑一次）。
  // 掛載時的初始值不算——不然每次重新整理頁面都會自己跑一次。
  const quickScanTick = useTacticalStore((s) => s.quickScanTick)
  const seenTick = useRef(quickScanTick)
  useEffect(() => {
    if (quickScanTick === seenTick.current) return
    seenTick.current = quickScanTick
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickScanTick])
  const sevStyle =
    summary?.severity === 'alert'
      ? 'border-tactical-alert bg-tactical-alert/10 text-tactical-alert'
      : summary?.severity === 'none'
        ? 'border-slate-600 bg-slate-800/60 text-slate-300'
        : 'border-tactical-green bg-tactical-green/10 text-tactical-green'

  return (
    <>
      {(running || summary) && (
        <div className="pointer-events-auto fixed inset-0 z-[2000] flex items-end justify-center bg-black/60 p-3 pt-[calc(0.75rem+env(safe-area-inset-top))] md:items-center">
          <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl border border-slate-700 bg-tactical-bg p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-base font-bold text-tactical-cyan">⚡ 這片海現在有什麼</span>
              {!running && (
                <button
                  onClick={() => {
                    setSummary(null)
                    setPhase('idle')
                  }}
                  className="text-slate-400 active:scale-95"
                >
                  ✕
                </button>
              )}
            </div>

            {running && (
              <div className="flex flex-col gap-2 py-3">
                <div className="text-sm text-slate-200">{PHASE_LABEL[phase]}</div>
                <div className="h-1 overflow-hidden rounded bg-slate-700">
                  <div
                    className="h-full bg-tactical-cyan transition-all duration-500"
                    style={{
                      width: phase === 'switching' ? '25%' : phase === 'loading' ? '60%' : '90%',
                    }}
                  />
                </div>
                <p className="text-[0.625rem] text-slate-500">{reason}</p>
              </div>
            )}

            {summary && !running && (
              <>
                <div className={`rounded-lg border p-2.5 text-sm font-bold ${sevStyle}`}>
                  {summary.headline}
                </div>
                <ul className="mt-2 flex flex-col gap-1">
                  {summary.lines.map((l) => (
                    <li key={l} className="text-[0.6875rem] leading-relaxed text-slate-400">
                      · {l}
                    </li>
                  ))}
                </ul>

                {summary.suspicious.length > 0 && (
                  <div className="mt-3">
                    <div className="mb-1 text-xs font-bold text-tactical-alert">
                      優先查（無 AIS，突出度高的在前）
                    </div>
                    <div className="flex flex-col gap-1">
                      {summary.suspicious.slice(0, 10).map((t, i) => (
                        <button
                          key={`${t.lat},${t.lng}`}
                          onClick={() => {
                            gotoCoord(t.lat, t.lng, 14)
                            setSummary(null)
                            setPhase('idle')
                          }}
                          className="flex items-center gap-2 rounded border border-slate-700 px-2 py-1.5 text-left active:scale-95"
                        >
                          <span className="shrink-0 font-mono text-[0.625rem] text-tactical-alert">
                            #{i + 1}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[0.6875rem] text-slate-200">
                              {t.cls}
                            </span>
                            <span className="block font-mono text-[0.5625rem] text-slate-500">
                              {t.lat.toFixed(3)}, {t.lng.toFixed(3)}　距中心{' '}
                              {formatDist(distM(mapView.lat, mapView.lng, t.lat, t.lng) / 1000, unit)}
                            </span>
                          </span>
                          <span className="shrink-0 text-[0.625rem] text-slate-500">
                            {t.score.toFixed(1)}σ
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* 這段一定要顯示：沒有紅框 ≠ 海上現在沒船 */}
                <p className="mt-3 rounded border border-amber-500/40 bg-amber-500/5 p-2 text-[0.625rem] leading-relaxed text-amber-200/90">
                  {caveat}
                </p>

                <button
                  onClick={run}
                  className="mt-3 w-full rounded-lg border border-slate-600 py-2 text-xs text-slate-300 active:scale-95"
                >
                  🔄 重新掃一次
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
