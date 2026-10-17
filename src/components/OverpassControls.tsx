import { useTacticalStore } from '../store/tacticalStore'
import { overpassForecast, crossingsText, swathFit, viewWidthKm } from '../lib/overpass'
import { fmtDay } from '../lib/timefmt'
import { SatelliteQuickLinks } from './SatelliteQuickLinks'
import { isOverhead, issFootprintKm } from '../lib/issTrack'
import { distanceKm, bearingDeg } from '../lib/windRadar'
import { bearingToText } from '../lib/drift'
import { formatDist } from '../lib/units'
import { Hint } from './Hint'
import { PassFinder } from './PassFinder'

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
  const showIss = useTacticalStore((s) => s.showIss)
  const setShowIss = useTacticalStore((s) => s.setShowIss)
  const issFix = useTacticalStore((s) => s.issFix)
  const gotoCoord = useTacticalStore((s) => s.gotoCoord)
  const unit = useTacticalStore((s) => s.distUnit)
  const rows = overpassForecast(Date.now())
  // 畫面實際多寬，用來回答「一趟掃幅蓋不蓋得住我這片海」。
  // 這份時刻表只講「每天大概幾點過境、一趟夠不夠寬」；
  // 「哪一趟會剛好掃過這裡」由上面的 PassFinder 用 SGP4＋真實根數算。
  const viewKm = viewWidthKm(mapView.lat, mapView.zoom, window.innerWidth)
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

      {/* ISS 即時星下點：真的會動的那顆 */}
      <div className="rounded-lg border border-tactical-cyan/40 bg-tactical-cyan/5 p-2">
        <button
          onClick={() => setShowIss(!showIss)}
          className={`w-full rounded-lg border py-2 text-sm font-bold active:scale-95 ${
            showIss
              ? 'border-tactical-cyan bg-tactical-cyan/20 text-tactical-cyan'
              : 'border-slate-600 text-slate-300'
          }`}
        >
          {showIss ? '🛰️ 關閉 ISS 即時位置' : '🛰️ ISS 現在飛到哪（即時）'}
        </button>

        {showIss && !issFix && (
          <p className="mt-2 text-[0.625rem] text-slate-400">定位中…（需要連網，約 10 秒更新一次）</p>
        )}

        {showIss && issFix && (
          <>
            {(() => {
              const km = distanceKm(mapView.lat, mapView.lng, issFix.lat, issFix.lng)
              const brg = bearingDeg(mapView.lat, mapView.lng, issFix.lat, issFix.lng)
              const over = isOverhead(km, issFix.altKm)
              return (
                <>
                  <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[0.6875rem]">
                    <span className="text-slate-400">星下點</span>
                    <span className="text-right font-mono text-slate-200">
                      {issFix.lat.toFixed(2)}, {issFix.lng.toFixed(2)}
                    </span>
                    <span className="text-slate-400">高度</span>
                    <span className="text-right font-mono text-slate-200">
                      {issFix.altKm ? `${Math.round(issFix.altKm)} km` : '無資料'}
                    </span>
                    <span className="text-slate-400">對地速度</span>
                    <span className="text-right font-mono text-slate-200">
                      {issFix.speedKmh ? `${Math.round(issFix.speedKmh).toLocaleString()} km/h` : '無資料'}
                    </span>
                    <span className="text-slate-400">距畫面中心</span>
                    <span className="text-right font-mono text-slate-200">
                      {formatDist(km, unit)}　{bearingToText(brg)}
                    </span>
                    <span className="text-slate-400">可見地平圈</span>
                    <span
                      className={`text-right font-mono ${over ? 'text-tactical-green' : 'text-slate-400'}`}
                    >
                      {over ? '在圈內' : '在圈外'}（半徑 {formatDist(issFootprintKm(issFix.altKm), unit, 0)}）
                    </span>
                  </div>
                  <button
                    onClick={() => gotoCoord(issFix.lat, issFix.lng, 3)}
                    className="mt-2 w-full rounded border border-slate-600 py-1.5 text-[0.6875rem] text-slate-300 active:scale-95"
                  >
                    📍 把地圖移到 ISS 現在的位置
                  </button>
                </>
              )
            })()}
            <p className="mt-1.5 text-[0.625rem] leading-relaxed text-slate-500">
              這是「它現在飛在哪」的星下點，不是可見性預報。圈內只代表幾何上看得到，
              真的要看見還得天黑、它被陽光照到、而且沒雲。10 秒更新一次，
              所以那顆點最多落後約 75 公里（它對地約 7.66 km/s）。來源 {issFix.source}。
            </p>
          </>
        )}
      </div>

      <PassFinder />

      <Hint
        id="overpass-table-vs-finder"
        tone="plain"
        title="上面那個和下面這張表差在哪？"
        gist="上面算「哪一趟掃過這裡」；下面是每天的固定時段與規格"
      >
        <div>
          <b className="text-slate-200">上面的「哪顆衛星會掃到這片海」</b>
          會去抓真實軌道根數，用 SGP4 算出每一趟的地面軌跡，回答
          「幾月幾號幾點到幾點、最接近多少浬」。要排作業時間看那個。
        </div>
        <div>
          <b className="text-slate-200">下面這張表</b>
          是不連網也看得到的規格與固定時段——太陽同步衛星每天大約在同一個
          「地方時」過境，時段很穩定。另外它回答「一趟掃幅蓋不蓋得住目前畫面」。
        </div>
        <div>
          ISS 那一塊是另一回事：它用的是免金鑰的即時位置來源，給的是
          「它現在飛在哪」，不是預報。
        </div>
      </Hint>

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
            {(() => {
              const fit = swathFit(sat.swathKm, viewKm, unit)
              if (!fit.text) return null
              return (
                <div
                  className={`mt-1 text-[0.5625rem] leading-relaxed ${
                    fit.coversView ? 'text-tactical-green/80' : 'text-amber-300/80'
                  }`}
                >
                  {fit.coversView ? '✓ ' : '⚠ '}
                  {fit.text}
                </div>
              )
            })()}
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[0.625rem] text-slate-400">
              <span>解析度 {sat.resText}</span>
              <span>掃幅 {formatDist(sat.swathKm, unit, 0)}</span>
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
