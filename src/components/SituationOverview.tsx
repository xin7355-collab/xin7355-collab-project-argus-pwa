import { useEffect, useRef, useState } from 'react'
import { isCwaConfigured } from '../lib/config'
import { fetchCwaAlerts } from '../lib/cwaAlerts'
import { analyzeApproach, analyzeVessels } from '../lib/aisAnomaly'
import { useTacticalStore } from '../store/tacticalStore'

/**
 * 🚨 狀況總覽卡（全模式共用浮動小卡）：把三類即時風險彙整成「一顆藥丸＋可點開清單」。
 *   ① 🎯 趨近我方的船（CPA/TCPA，需 GPS 定位）——碰撞/接觸預警
 *   ② ⚠ 高度可疑船（無身分闖領海／近岸高速…）＋ 光學掃描無 AIS 亮點
 *   ③ 🌊 CWA 海上警特報（強風/濃霧/長浪/大雨…）
 * 有風險才出現；點項目直接在地圖定位。符合「不干擾、要看才點開」。CWA 每 15 分更新。
 */
export function SituationOverview() {
  const vessels = useTacticalStore((s) => s.vessels)
  const ownPosition = useTacticalStore((s) => s.ownPosition)
  const brightSpots = useTacticalStore((s) => s.brightSpots)
  const alerts = useTacticalStore((s) => s.cwaAlerts)
  const setCwaAlerts = useTacticalStore((s) => s.setCwaAlerts)
  const gotoCoord = useTacticalStore((s) => s.gotoCoord)
  const setStatus = useTacticalStore((s) => s.setStatus)
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  // CWA 警特報：只有設定金鑰才抓；每 15 分鐘更新（沿用原 Banner 邏輯）。
  useEffect(() => {
    if (!isCwaConfigured()) return
    let cancelled = false
    const load = async () => {
      const a = await fetchCwaAlerts()
      if (!cancelled) setCwaAlerts(a && a.length ? a : null)
    }
    load()
    timer.current = setInterval(load, 15 * 60 * 1000)
    return () => {
      cancelled = true
      if (timer.current) clearInterval(timer.current)
    }
  }, [setCwaAlerts])

  // ① 趨近我方（需定位）
  const approaches = ownPosition ? analyzeApproach(vessels, ownPosition).slice(0, 8) : []
  // ② 高度可疑船（alert 級）
  const suspects = analyzeVessels(vessels)
    .filter((a) => a.level === 'alert')
    .slice(0, 8)
  // ② 光學掃描無 AIS 亮點（最近一次掃描）
  const noAis = brightSpots.filter((s) => s.ais === 'none').slice(0, 8)
  // ③ CWA 警特報（海上相關排前）
  const warnList = alerts ?? []
  const seaWarn = warnList.filter((a) => a.sea)

  const total = approaches.length + suspects.length + noAis.length + warnList.length
  if (total === 0) return null

  // 有「趨近我方」或「海上警特報」＝高風險（紅）；否則注意（琥珀）。
  const high = approaches.length > 0 || seaWarn.length > 0

  const flyTo = (lat: number, lng: number, label: string) => {
    gotoCoord(lat, lng, 12)
    setStatus(`已定位：${label}`)
  }

  return (
    <div className="safe-top pointer-events-auto absolute left-1/2 top-0 z-[1150] mt-9 flex w-[min(92vw,26rem)] -translate-x-1/2 flex-col items-center">
      {/* 收合藥丸：總數 + 高/中風險配色 */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[0.6875rem] font-bold active:scale-95 ${
          high
            ? 'border-rose-500/70 bg-rose-500/20 text-rose-100'
            : 'border-amber-500/70 bg-amber-500/20 text-amber-100'
        }`}
      >
        <span className="animate-pulse">🚨</span>
        <span>
          狀況總覽 {total}
          {approaches.length > 0 && ` · 🎯${approaches.length}`}
          {suspects.length + noAis.length > 0 && ` · ⚠${suspects.length + noAis.length}`}
          {warnList.length > 0 && ` · 🌊${warnList.length}`}
        </span>
        <span className="opacity-70">{open ? '▲' : '▼'}</span>
      </button>

      {/* 展開清單：三段分組 */}
      {open && (
        <div className="mt-1 max-h-[62vh] w-full overflow-y-auto rounded-xl border border-slate-700 bg-tactical-bg/95 p-2 shadow-lg">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[0.6875rem] font-semibold text-tactical-cyan">🚨 即時狀況總覽</span>
            <button onClick={() => setOpen(false)} className="text-slate-400 active:scale-95">✕</button>
          </div>

          {/* ① 趨近我方 */}
          {approaches.length > 0 && (
            <Section title={`🎯 趨近我方 ${approaches.length}`} tone="rose">
              {approaches.map((a) => (
                <Row
                  key={'ap' + a.vessel.mmsi}
                  onClick={() => flyTo(a.vessel.lat, a.vessel.lng, a.vessel.name)}
                  left={`🔺 ${a.vessel.name}`}
                  right={`最近 ${a.cpaNm.toFixed(1)}浬 · ${Math.round(a.tcpaMin)}分後`}
                  tone="rose"
                />
              ))}
            </Section>
          )}

          {/* ② 可疑船 + 無 AIS 亮點 */}
          {(suspects.length > 0 || noAis.length > 0) && (
            <Section title={`⚠ 可疑目標 ${suspects.length + noAis.length}`} tone="amber">
              {suspects.map((s) => (
                <Row
                  key={'su' + s.vessel.mmsi}
                  onClick={() => flyTo(s.vessel.lat, s.vessel.lng, s.vessel.name)}
                  left={`🔺 ${s.vessel.name}`}
                  right={s.alerts[0] ?? '可疑'}
                  tone="amber"
                />
              ))}
              {noAis.map((s, i) => (
                <Row
                  key={'na' + i}
                  onClick={() => flyTo(s.lat, s.lng, `無AIS亮點 ${s.cls}`)}
                  left={`⚠ 無AIS亮點 · ${s.cls}`}
                  right={`~${Math.round(s.sizeM)}m`}
                  tone="amber"
                />
              ))}
            </Section>
          )}

          {/* ③ CWA 警特報 */}
          {warnList.length > 0 && (
            <Section title={`🌊 氣象警特報 ${warnList.length}`} tone="rose">
              {warnList.map((a, i) => (
                <div
                  key={a.phenomena + a.significance + i}
                  className={`rounded-lg border p-1.5 ${
                    a.sea ? 'border-rose-500/50 bg-rose-500/10' : 'border-amber-500/40 bg-amber-500/5'
                  }`}
                >
                  <span className={`text-[0.75rem] font-bold ${a.sea ? 'text-rose-200' : 'text-amber-200'}`}>
                    {a.sea ? '🌊' : '⚠'} {a.phenomena}
                    {a.significance ? ` · ${a.significance}` : ''}
                  </span>
                  {a.areas.length > 0 && (
                    <div className="mt-0.5 text-[0.5625rem] leading-relaxed text-slate-300">
                      影響：{a.areas.slice(0, 10).join('、')}
                      {a.areas.length > 10 ? ` …等 ${a.areas.length} 區` : ''}
                    </div>
                  )}
                </div>
              ))}
            </Section>
          )}

          <p className="mt-1.5 text-[0.5625rem] leading-relaxed text-slate-500">
            🎯 需開 📍 定位；⚠ 無AIS亮點來自最近一次光學掃描；🌊 CWA W-C0033-002 每 15 分更新。點項目即在地圖定位。輔助研判，非確認身分。
          </p>
        </div>
      )}
    </div>
  )
}

function Section({ title, tone, children }: { title: string; tone: 'rose' | 'amber'; children: React.ReactNode }) {
  return (
    <div className="mb-1.5 flex flex-col gap-1">
      <div className={`text-[0.625rem] font-semibold ${tone === 'rose' ? 'text-rose-300' : 'text-amber-300'}`}>
        {title}
      </div>
      {children}
    </div>
  )
}

function Row({
  left,
  right,
  tone,
  onClick,
}: {
  left: string
  right: string
  tone: 'rose' | 'amber'
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-between gap-2 rounded border px-2 py-1 text-left active:scale-95 ${
        tone === 'rose'
          ? 'border-rose-500/30 bg-rose-500/5'
          : 'border-amber-500/30 bg-amber-500/5'
      }`}
    >
      <span className="min-w-0 flex-1 truncate text-[0.625rem] font-semibold text-slate-100">{left}</span>
      <span className={`shrink-0 font-mono text-[0.5625rem] ${tone === 'rose' ? 'text-rose-200/90' : 'text-amber-200/90'}`}>
        {right}
      </span>
    </button>
  )
}
