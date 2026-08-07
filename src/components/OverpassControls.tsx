import { useTacticalStore } from '../store/tacticalStore'
import { overpassForecast, crossingsText } from '../lib/overpass'
import { fmtDay } from '../lib/timefmt'
import { SatelliteQuickLinks } from './SatelliteQuickLinks'

function dayTime(epoch: number): string {
  const d = new Date(epoch)
  return `${fmtDay(epoch)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const KIND_STYLE: Record<string, string> = {
  雷達: 'border-tactical-cyan/50 text-tactical-cyan',
  光學: 'border-amber-500/50 text-amber-300',
  '夜間/每日': 'border-violet-500/50 text-violet-300',
}

/**
 * 衛星過境預報：哪顆衛星、幾點過境、可看什麼影像，好排偵搜/取像時機。
 * 太陽同步軌道近似（過境時段準；每日型給具體時刻，多日重訪給時段＋週期）。
 */
export function OverpassControls() {
  const mapView = useTacticalStore((s) => s.mapView)
  const rows = overpassForecast(Date.now())
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-slate-700 bg-tactical-panel/90 p-3">
      <div className="flex items-center gap-2">
        <span className="text-2xl">🛰️</span>
        <div className="flex flex-col">
          <span className="text-base font-bold text-tactical-cyan">衛星過境預報</span>
          <span className="text-[0.6875rem] text-slate-400">
            幾點有新衛星影像可看 · 以畫面中心 {mapView.lat.toFixed(2)},{mapView.lng.toFixed(2)} 近似
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        {rows.map(({ sat, nextEpoch }) => (
          <div key={sat.id} className="rounded-lg border border-slate-700 bg-slate-900/50 p-2">
            <div className="flex items-center gap-2">
              <span className="text-lg">{sat.emoji}</span>
              <span className="flex-1 truncate text-xs font-bold text-slate-200">{sat.name}</span>
              <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[0.5625rem] font-semibold ${KIND_STYLE[sat.kind]}`}>
                {sat.kind}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[0.625rem] text-slate-400">
              <span>解析度 {sat.resText}</span>
              <span>掃幅 {sat.swathKm} km</span>
              <span>{sat.revisitText}</span>
            </div>
            <div className="mt-1 text-[0.6875rem] leading-snug text-slate-300">🎯 {sat.use}</div>
            {nextEpoch != null ? (
              <div className="mt-1 rounded bg-tactical-green/10 px-2 py-1 text-[0.6875rem] font-semibold text-tactical-green">
                🕐 下次過境 ~ {dayTime(nextEpoch)}（本地時間近似）
              </div>
            ) : (
              <div className="mt-1 rounded bg-slate-800/60 px-2 py-1 text-[0.625rem] leading-snug text-slate-400">
                🕐 過境時段 ~ <b className="text-slate-200">{crossingsText(sat.crossings)}</b> 本地 · {sat.revisitText}
                （確切日期見 {sat.via}）
              </div>
            )}
          </div>
        ))}
      </div>

      <p className="rounded-md bg-slate-800/60 px-2 py-1.5 text-[0.625rem] leading-relaxed text-slate-500">
        說明：太陽同步衛星每天約在固定「地方時」過境，故<b className="text-slate-300">時段」很準</b>；但窄掃幅衛星
        （Sentinel/Landsat）<b className="text-slate-300">確切哪一天</b>涵蓋你這點，仍要到 Copernicus/USGS 查實際影像。
      </p>

      {/* 一鍵查此位置的免費衛星檔案（鎖定今天）*/}
      <SatelliteQuickLinks
        lat={mapView.lat}
        lng={mapView.lng}
        date={today}
        title="🛰️ 查此位置的免費衛星影像（外部全解析檔案）"
      />
    </div>
  )
}
