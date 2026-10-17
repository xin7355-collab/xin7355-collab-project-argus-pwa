import { useEffect } from 'react'
import { useTacticalStore } from '../store/tacticalStore'
import { fmtClock, driftEpoch, fmtDayHour } from '../lib/timefmt'
import { modeMeta } from '../lib/launcher'
import { BottomSheet } from './BottomSheet'
import { Launcher, LauncherPeek } from './Launcher'
import { OpticalControls } from './OpticalControls'
import { SarControls } from './SarControls'
import { AisControls } from './AisControls'
import { RescueControls } from './RescueControls'
import { SeaStateControls } from './SeaStateControls'
import { EnvAnimControls } from './EnvAnimControls'
import { TyphoonControls } from './TyphoonControls'
import { OverpassControls } from './OverpassControls'

/**
 * 底部抽屜的內容。
 *
 * 沒開任何模式：收起時是最常用的五格，往上拉是全部功能。
 * 開了模式：標題列是「這是什麼模式＋結束鈕」，往上拉是該模式的控制項。
 *
 * 舊版是「固定 46vh 的面板＋底下一排要橫滑的模式大鈕」，實測地圖只剩 38%；
 * 而且要結束模式得「再點一下亮著的那顆」——沒人猜得到。
 */
export function Dashboard() {
  const mode = useTacticalStore((s) => s.mode)
  const setMode = useTacticalStore((s) => s.setMode)
  const snap = useTacticalStore((s) => s.sheetSnap)
  const setSnap = useTacticalStore((s) => s.setSheetSnap)

  // 回到基本地圖時抽屜收起來，把地圖還給使用者
  useEffect(() => {
    if (mode === 'basic') setSnap('peek')
  }, [mode, setSnap])

  const header = mode === 'basic' ? <LauncherPeek /> : <ModeHeader onEnd={() => setMode('basic')} />

  const body =
    mode === 'basic' ? (
      <Launcher />
    ) : (
      <div className="flex flex-col gap-2 pb-2">
        {mode === 'orbit' && <OverpassControls />}
        {mode === 'optical' && <OpticalControls />}
        {mode === 'sar' && <SarControls />}
        {mode === 'ais' && <AisControls />}
        {mode === 'rescue' && <RescueControls />}
        {mode === 'seastate' && <SeaStateControls />}
        {mode === 'envanim' && <EnvAnimControls />}
        {mode === 'typhoon' && <TyphoonControls />}
      </div>
    )

  return (
    <BottomSheet snap={snap} onSnap={setSnap} header={header}>
      {body}
    </BottomSheet>
  )
}

function ModeHeader({ onEnd }: { onEnd: () => void }) {
  const mode = useTacticalStore((s) => s.mode)
  const snap = useTacticalStore((s) => s.sheetSnap)
  const meta = modeMeta(mode)

  return (
    <div className="flex flex-col gap-1.5 px-3 pb-2">
      <div className="flex items-center gap-2.5">
        <span className="text-2xl leading-none">{meta?.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-bold text-tactical-cyan">{meta?.label}</div>
          <div className="truncate text-[0.6875rem] text-slate-400">{meta?.hint}</div>
        </div>
        <button
          onClick={onEnd}
          className="shrink-0 rounded-full border border-slate-600 bg-slate-800/80 px-3 py-1.5 text-xs font-bold text-slate-200 active:scale-95"
          aria-label="結束這個模式，回到地圖"
        >
          ✕ 結束
        </button>
      </div>
      {/* 收起時仍要能拉時間軸：拖時間看漂流／暴風圈時，地圖要整個看得到 */}
      {snap === 'peek' && <MiniScrubbers />}
    </div>
  )
}

function MiniScrubbers() {
  const mode = useTacticalStore((s) => s.mode)
  const scrubHours = useTacticalStore((s) => s.scrubHours)
  const setScrubHours = useTacticalStore((s) => s.setScrubHours)
  const driftPoints = useTacticalStore((s) => s.driftPoints)
  const incidentTime = useTacticalStore((s) => s.incidentTime)
  const activeTyphoon = useTacticalStore((s) => s.activeTyphoon)
  const tyScrubHours = useTacticalStore((s) => s.tyScrubHours)
  const setTyScrubHours = useTacticalStore((s) => s.setTyScrubHours)

  if (mode === 'rescue' && driftPoints.length > 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-slate-900/70 px-3 py-2">
        <span className="shrink-0 font-mono text-[0.6875rem] text-amber-400">
          ⏱ {scrubHours === 0 ? '落海點' : fmtClock(driftEpoch(incidentTime, Math.abs(scrubHours), scrubHours < 0))}
        </span>
        <input
          type="range"
          min={-72}
          max={72}
          step={1}
          value={scrubHours}
          onChange={(e) => setScrubHours(Number(e.target.value))}
          className="w-full accent-amber-400"
          aria-label="漂流時間"
        />
      </div>
    )
  }

  const tyMax = activeTyphoon
    ? activeTyphoon.track.reduce((m, p) => (p.hours > 0 ? Math.max(m, p.hours) : m), 0)
    : 0
  if (mode === 'typhoon' && tyMax > 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-tactical-cyan/40 bg-slate-900/70 px-3 py-2">
        <span className="shrink-0 font-mono text-[0.6875rem] text-tactical-cyan">
          🌀 {tyScrubHours === 0 ? '現在' : `${fmtDayHour(Date.now() + tyScrubHours * 3600000)} +${tyScrubHours}h`}
        </span>
        <input
          type="range"
          min={0}
          max={tyMax}
          step={1}
          value={tyScrubHours}
          onChange={(e) => setTyScrubHours(Number(e.target.value))}
          className="w-full accent-cyan-400"
          aria-label="颱風預報時間"
        />
      </div>
    )
  }
  return null
}
