import { useMemo, useState } from 'react'
import { useTacticalStore } from '../store/tacticalStore'
import { computeNightPlan } from '../lib/astro'

/**
 * 夜勤光照規劃器（🌙）：日落／天文曙暮光／月出月落／月相照明度，並標出天文夜內
 * 「月亮沉入地平線下」最長的黑暗窗口——非法越界/小艇常挑此時登陸。純天文計算，
 * 免金鑰、可離線。以 GPS 我方位置優先，否則用畫面中心。
 */
export function NightOpsPanel() {
  const ownPosition = useTacticalStore((s) => s.ownPosition)
  const mapView = useTacticalStore((s) => s.mapView)
  const openTool = useTacticalStore((s) => s.openTool)
  const setOpenTool = useTacticalStore((s) => s.setOpenTool)
  const open = openTool === 'nightops'
  const setOpen = (v: boolean) => setOpenTool(v ? 'nightops' : null)
  const [dayOffset, setDayOffset] = useState(0) // 0=今晚, 1=明晚…

  const src = ownPosition ?? mapView
  const usingGps = Boolean(ownPosition)

  const plan = useMemo(() => {
    const base = new Date()
    base.setDate(base.getDate() + dayOffset)
    base.setHours(12, 0, 0, 0) // 以中午為基準算「當晚」
    return computeNightPlan(base, src.lat, src.lng)
  }, [src.lat, src.lng, dayOffset])

  if (!open) return null

  return (
    <>
      {open && (
        <div className="pointer-events-auto fixed inset-0 z-[2000] flex items-end justify-center bg-black/60 p-3 pt-[calc(0.75rem+env(safe-area-inset-top))] md:items-center">
          <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl border border-slate-700 bg-tactical-bg p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-base font-bold text-tactical-cyan">🌙 夜勤光照規劃</h2>
              <button onClick={() => setOpen(false)} className="text-slate-400 active:scale-95">
                ✕
              </button>
            </div>

            <div className="mb-3 flex items-center justify-between text-[0.625rem] text-slate-400">
              <span>
                {usingGps ? '📍 我方 GPS' : '◎ 畫面中心'}：{src.lat.toFixed(3)}, {src.lng.toFixed(3)}
              </span>
              <div className="flex gap-1">
                {[0, 1, 2].map((o) => (
                  <button
                    key={o}
                    onClick={() => setDayOffset(o)}
                    className={`rounded border px-2 py-0.5 text-[0.625rem] font-semibold active:scale-95 ${
                      dayOffset === o
                        ? 'border-tactical-cyan bg-tactical-cyan/15 text-tactical-cyan'
                        : 'border-slate-700 text-slate-400'
                    }`}
                  >
                    {o === 0 ? '今晚' : o === 1 ? '明晚' : '後晚'}
                  </button>
                ))}
              </div>
            </div>

            {/* 最暗窗口（主打）*/}
            <div className="mb-3 rounded-lg border border-tactical-cyan/50 bg-tactical-cyan/10 p-2.5">
              <div className="text-[0.6875rem] font-semibold text-tactical-cyan">🕶️ 最暗窗口（月落後的天文夜）</div>
              {plan.darkStart && plan.darkEnd && plan.darkMinutes > 0 ? (
                <>
                  <div className="mt-1 font-mono text-lg font-bold text-white">
                    {hhmm(plan.darkStart)} – {hhmm(plan.darkEnd)}
                  </div>
                  <div className="text-[0.625rem] text-slate-300">
                    共 {Math.floor(plan.darkMinutes / 60)} 時 {plan.darkMinutes % 60} 分——海面最暗、最利登陸；埋伏/巡邏優先時段。
                  </div>
                </>
              ) : (
                <div className="mt-1 text-[0.6875rem] text-slate-300">
                  今晚天文夜內月亮多在地平線上（或月照極低），無明顯「月落黑暗窗口」。
                </div>
              )}
            </div>

            {/* 太陽時刻 */}
            <div className="mb-2 grid grid-cols-2 gap-1.5">
              <Cell label="🌅 日出（明晨）" value={hhmm(plan.sunrise)} />
              <Cell label="🌇 日落" value={hhmm(plan.sunset)} />
              <Cell label="🌘 天文曙光始（亮）" value={hhmm(plan.astroDawn)} sub="黑暗結束" />
              <Cell label="🌒 天文暮光終（暗）" value={hhmm(plan.astroDusk)} sub="全黑開始" />
            </div>

            {/* 月亮 */}
            <div className="mb-2 rounded-lg border border-slate-700 bg-slate-900/40 p-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[0.6875rem] font-semibold text-slate-300">{plan.phaseName}</span>
                <span className="font-mono text-sm font-bold text-amber-300">照明 {Math.round(plan.illum * 100)}%</span>
              </div>
              <div className="mt-1 grid grid-cols-2 gap-1.5 text-[0.625rem]">
                <span className="text-slate-400">🌜 月出：<b className="font-mono text-slate-200">{plan.moonRise ? hhmm(plan.moonRise) : '—'}</b></span>
                <span className="text-slate-400">🌛 月落：<b className="font-mono text-slate-200">{plan.moonSet ? hhmm(plan.moonSet) : '—'}</b></span>
              </div>
            </div>

            {/* 判讀 */}
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-[0.6875rem] leading-relaxed text-amber-100">
              🎯 {plan.verdict}
            </div>

            <p className="mt-3 text-[0.625rem] leading-relaxed text-slate-500">
              時間為裝置本地時區（台灣 UTC+8）。純天文計算、免金鑰、可離線；實際能見度另受雲、霧、雨影響（可搭配降雨雷達圖層）。
            </p>
          </div>
        </div>
      )}
    </>
  )
}

function Cell({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-2">
      <div className="text-[0.625rem] text-slate-400">{label}</div>
      <div className="font-mono text-base font-bold text-slate-100">{value}</div>
      {sub && <div className="text-[0.5625rem] text-slate-500">{sub}</div>}
    </div>
  )
}

function hhmm(d?: Date): string {
  if (!d || isNaN(d.valueOf())) return '—'
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
}
