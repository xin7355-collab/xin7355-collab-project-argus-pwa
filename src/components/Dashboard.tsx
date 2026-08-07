import { useState } from 'react'
import { useTacticalStore } from '../store/tacticalStore'
import { fmtClock, driftEpoch, fmtDayHour } from '../lib/timefmt'
import { ModeButtons } from './ModeButtons'
import { OpticalControls } from './OpticalControls'
import { SarControls } from './SarControls'
import { AisControls } from './AisControls'
import { RescueControls } from './RescueControls'
import { SeaStateControls } from './SeaStateControls'
import { EnvAnimControls } from './EnvAnimControls'
import { TyphoonControls } from './TyphoonControls'
import { OverpassControls } from './OverpassControls'

/**
 * Dashboard —— 底部（手機）/ 左側（平板以上）的控制面板。
 * 依當前模式顯示對應的控制項；可收合以看清地圖。
 */
export function Dashboard() {
  const mode = useTacticalStore((s) => s.mode)
  const scrubHours = useTacticalStore((s) => s.scrubHours)
  const setScrubHours = useTacticalStore((s) => s.setScrubHours)
  const driftPoints = useTacticalStore((s) => s.driftPoints)
  const incidentTime = useTacticalStore((s) => s.incidentTime)
  const activeTyphoon = useTacticalStore((s) => s.activeTyphoon)
  const tyScrubHours = useTacticalStore((s) => s.tyScrubHours)
  const setTyScrubHours = useTacticalStore((s) => s.setTyScrubHours)
  const [collapsed, setCollapsed] = useState(false)

  const hasPanel =
    mode === 'orbit' ||
    mode === 'optical' ||
    mode === 'sar' ||
    mode === 'ais' ||
    mode === 'rescue' ||
    mode === 'seastate' ||
    mode === 'envanim' ||
    mode === 'typhoon'
  // 收合時、搜救有結果 → 顯示浮動迷你時間軸（拉桿時不擋地圖）
  const showMiniScrub = collapsed && mode === 'rescue' && driftPoints.length > 0
  // 收合時、颱風模式 → 浮動迷你時間軸（拖曳看暴風圈預判時不擋地圖）
  const tyMaxHours = activeTyphoon
    ? activeTyphoon.track.reduce((m, p) => (p.hours > 0 ? Math.max(m, p.hours) : m), 0)
    : 0
  const showTyMiniScrub = collapsed && mode === 'typhoon' && tyMaxHours > 0

  const controls = (
    <>
      {mode === 'orbit' && <OverpassControls />}
      {mode === 'optical' && <OpticalControls />}
      {mode === 'sar' && <SarControls />}
      {mode === 'ais' && <AisControls />}
      {mode === 'rescue' && <RescueControls />}
      {mode === 'seastate' && <SeaStateControls />}
      {mode === 'envanim' && <EnvAnimControls />}
      {mode === 'typhoon' && <TyphoonControls />}
    </>
  )

  return (
    <div className="safe-bottom pointer-events-none absolute inset-x-0 bottom-0 z-[1000] md:inset-y-0 md:right-auto md:bottom-0 md:flex md:items-stretch md:pt-[3.4rem]">
      {/* 桌面：最左側常駐模式欄（手機隱藏） */}
      <div className="pointer-events-auto hidden md:flex md:flex-col md:overflow-y-auto md:border-r md:border-slate-800 md:bg-tactical-bg/85 md:p-1.5 md:backdrop-blur">
        <ModeButtons variant="rail" />
      </div>

      {/* 共用面板：手機＝底部抽屜；桌面＝左側控制欄（只有需要時佔寬） */}
      <div
        className={`pointer-events-auto flex flex-col gap-2 md:h-full md:overflow-y-auto md:p-3 ${
          hasPanel ? 'md:w-80' : 'md:w-0 md:overflow-hidden md:p-0'
        }`}
      >
        {/* 收合/展開條：手機專用（桌面永遠展開） */}
        {hasPanel && (
          <div className="flex items-center justify-between md:hidden">
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="rounded-lg border border-slate-700 bg-tactical-panel/90 px-3 py-1.5 text-xs font-bold text-slate-200 active:scale-95"
            >
              {collapsed ? '▲ 展開控制面板' : '▾ 收合面板（看地圖）'}
            </button>
          </div>
        )}

        {/* 收合時的浮動迷你時間軸：手機專用 */}
        {showMiniScrub && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-tactical-panel/95 px-3 py-2 md:hidden">
            <span className="shrink-0 font-mono text-[0.6875rem] text-amber-400">
              ⏱{' '}
              {scrubHours === 0
                ? '落海點'
                : fmtClock(driftEpoch(incidentTime, Math.abs(scrubHours), scrubHours < 0))}
            </span>
            <input
              type="range"
              min={-72}
              max={72}
              step={1}
              value={scrubHours}
              onChange={(e) => setScrubHours(Number(e.target.value))}
              className="w-full accent-amber-400"
            />
          </div>
        )}

        {/* 收合時的颱風浮動迷你時間軸 */}
        {showTyMiniScrub && (
          <div className="flex items-center gap-2 rounded-lg border border-tactical-cyan/40 bg-tactical-panel/95 px-3 py-2 md:hidden">
            <span className="shrink-0 font-mono text-[0.6875rem] text-tactical-cyan">
              🌀{' '}
              {tyScrubHours === 0 ? '現在' : `${fmtDayHour(Date.now() + tyScrubHours * 3600000)} +${tyScrubHours}h`}
            </span>
            <input
              type="range"
              min={0}
              max={tyMaxHours}
              step={1}
              value={tyScrubHours}
              onChange={(e) => setTyScrubHours(Number(e.target.value))}
              className="w-full accent-cyan-400"
            />
          </div>
        )}

        {/* 模式專屬控制項：手機收合時隱藏；桌面永遠顯示並自行捲動 */}
        <div
          className={`${collapsed ? 'hidden' : 'flex'} max-h-[46vh] flex-col gap-2 overflow-y-auto overscroll-contain md:flex md:max-h-none md:flex-1 md:overflow-visible`}
        >
          {controls}
        </div>

        {/* 戰術模式按鈕：手機底部橫列（桌面用左側 rail） */}
        <div className="md:hidden">
          <ModeButtons variant="strip" />
        </div>
      </div>
    </div>
  )
}
