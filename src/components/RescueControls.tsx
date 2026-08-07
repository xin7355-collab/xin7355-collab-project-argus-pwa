import { useState } from 'react'
import { useTacticalStore } from '../store/tacticalStore'
import { bearingToText, DRIFT_TARGETS } from '../lib/drift'
import { buildReport, shareReport } from '../lib/report'
import { SatelliteQuickLinks } from './SatelliteQuickLinks'
import { CoordField } from './CoordField'
import { parseCoord, fmtDDM } from '../lib/coordParse'
import { sunTimes } from '../lib/sun'
import { fmtClock, driftEpoch } from '../lib/timefmt'
import { bearingDeg } from '../map/MeasureLayer'

/**
 * 搜救推演控制面板：顯示即時海象摘要 + 漂流結果，並提示操作。
 */
export function RescueControls() {
  const env = useTacticalStore((s) => s.rescueEnv)
  const drift = useTacticalStore((s) => s.driftPoints)
  const status = useTacticalStore((s) => s.rescueStatus)
  const mob = useTacticalStore((s) => s.manOverboard)
  const own = useTacticalStore((s) => s.ownPosition)
  const scrubHours = useTacticalStore((s) => s.scrubHours)
  const setScrubHours = useTacticalStore((s) => s.setScrubHours)
  const driftTargetId = useTacticalStore((s) => s.driftTargetId)
  const setDriftTarget = useTacticalStore((s) => s.setDriftTarget)
  const sourcePoints = useTacticalStore((s) => s.sourcePoints)
  const incidentTime = useTacticalStore((s) => s.incidentTime)
  const setIncidentTime = useTacticalStore((s) => s.setIncidentTime)
  const showProbability = useTacticalStore((s) => s.showProbability)
  const setShowProbability = useTacticalStore((s) => s.setShowProbability)
  const showSearchPattern = useTacticalStore((s) => s.showSearchPattern)
  const setShowSearchPattern = useTacticalStore((s) => s.setShowSearchPattern)
  const trackSpacingNm = useTacticalStore((s) => s.trackSpacingNm)
  const setTrackSpacingNm = useTacticalStore((s) => s.setTrackSpacingNm)
  const setMob = useTacticalStore((s) => s.setManOverboard)
  const setResult = useTacticalStore((s) => s.setRescueResult)
  const setStatus = useTacticalStore((s) => s.setStatus)

  const mcSummary = useTacticalStore((s) => s.mcSummary)
  const tide = useTacticalStore((s) => s.cwaTide)
  const savedCoords = useTacticalStore((s) => s.savedCoords)
  const gotoCoord = useTacticalStore((s) => s.gotoCoord)
  const driftTargetLabel =
    DRIFT_TARGETS.find((t) => t.id === driftTargetId)?.label ?? '落海人'

  // 手動輸入座標（實戰時座標常由無線電報來）
  const [manual, setManual] = useState(false)
  const [pickSaved, setPickSaved] = useState(false)
  const [latStr, setLatStr] = useState('')
  const [lngStr, setLngStr] = useState('')
  const placeByCoord = () => {
    // 先試萬用解析（可把整串座標貼在緯度欄），失敗再退回兩欄十進位。
    const p =
      parseCoord(`${latStr} ${lngStr}`.trim()) ??
      (Number.isFinite(parseFloat(latStr)) && Number.isFinite(parseFloat(lngStr))
        ? { lat: parseFloat(latStr), lng: parseFloat(lngStr) }
        : null)
    if (p && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180) {
      setMob({ lat: p.lat, lng: p.lng })
      setManual(false)
    } else {
      setStatus('⚠ 座標格式錯誤（可用十進位/度分/度分秒；或用 📌 座標管理）')
    }
  }

  const clear = () => {
    setMob(null)
    setResult(null, [])
    setScrubHours(0)
    setShowProbability(false)
    setShowSearchPattern(false)
    setStatus('搜救推演模式：點地圖標記落海點，計算漂流')
  }

  const share = async () => {
    if (!mob || !env) return
    const sun = sunTimes(Date.now(), mob.lat, mob.lng)
    const text = buildReport({
      mob,
      env,
      drift,
      targetLabel: driftTargetLabel,
      reverse: false,
      mc: mcSummary ? { peak: mcSummary.peak, radius95: mcSummary.radius95 } : null,
      sun: { sunrise: sun.sunrise, sunset: sun.sunset, dusk: sun.dusk },
      tide,
      fromOwn:
        own && mob
          ? {
              distNm: haversineNm(own.lat, own.lng, mob.lat, mob.lng),
              bearingDeg: bearingDeg(own.lat, own.lng, mob.lat, mob.lng),
            }
          : null,
    })
    const how = await shareReport(text)
    setStatus(how === 'shared' ? '報告已分享' : how === 'copied' ? '報告已複製到剪貼簿' : '⚠ 分享失敗')
  }

  // 我的位置到落海點的距離（浬）
  const distNm =
    own && mob ? haversineNm(own.lat, own.lng, mob.lat, mob.lng) : null

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-700 bg-tactical-panel/90 p-3">
      {/* 落海點/回報時間（datum）＝時間軸的 0 點；一條軸同時看來源與去向 */}
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-[0.625rem] leading-relaxed text-amber-300">
        🔴 順推=未來漂到哪　🟠 逆推=從哪漂來。下方一條時間軸即可拖到任一時刻，
        紅/橙兩條軌跡同時呈現，不必切換方向。
      </div>

      {/* 回報/落海時間（datum，可為過去，用逐時歷史海象積分）*/}
      {
        <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[0.6875rem] font-semibold text-amber-400">🕐 回報/落海時間（基準點）</span>
            <button
              onClick={() => setIncidentTime(Date.now())}
              className="rounded border border-slate-600 px-2 py-0.5 text-[0.625rem] text-slate-300 active:scale-95"
            >
              設為現在
            </button>
          </div>
          <input
            type="datetime-local"
            max={toLocalInput(Date.now())}
            value={toLocalInput(incidentTime)}
            onChange={(e) => {
              const t = new Date(e.target.value).getTime()
              if (Number.isFinite(t)) setIncidentTime(t)
            }}
            className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-200"
          />
          <p className="mt-1 text-[0.625rem] text-slate-500">
            {elapsedHint(incidentTime)}
            ｜⌖綠圈=目標現在位置（自 datum 順推至今）
          </p>
        </div>
      }

      {/* 從已存座標（最愛/釘選）直接選為搜救點 */}
      {savedCoords.length > 0 && (
        <div>
          <button
            onClick={() => setPickSaved(!pickSaved)}
            className="text-[0.6875rem] text-pink-300 underline-offset-2 hover:underline"
          >
            {pickSaved ? '▾ 從我的座標選' : `▸ 從我的座標選（📌最愛/釘選 ${savedCoords.length}）`}
          </button>
          {pickSaved && (
            <div className="mt-1 flex max-h-28 flex-col gap-0.5 overflow-y-auto">
              {savedCoords.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    setMob({ lat: c.lat, lng: c.lng })
                    setPickSaved(false)
                    setStatus(`已用「${c.label}」為搜救點`)
                  }}
                  className="flex items-center justify-between rounded border border-slate-700 bg-slate-900/50 px-2 py-1 text-left active:scale-95"
                >
                  <span className="truncate text-[0.6875rem] text-slate-200">
                    {c.pinned ? '📌' : ''}
                    {c.favorite ? '★' : ''}
                    {c.label}
                  </span>
                  <span className="shrink-0 font-mono text-[0.5625rem] text-slate-500">
                    {c.lat.toFixed(3)}, {c.lng.toFixed(3)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 手動輸入座標 */}
      <div>
        <button
          onClick={() => setManual(!manual)}
          className="text-[0.6875rem] text-tactical-cyan underline-offset-2 hover:underline"
        >
          {manual ? '▾ 手動輸入座標' : '▸ 手動輸入座標（無線電報座標）'}
        </button>
        {manual && (
          <div className="mt-1 flex flex-col gap-1">
            <CoordField onParsed={(la, ln) => { setLatStr(String(la)); setLngStr(String(ln)) }} />
            <div className="flex items-center gap-1">
              <input
                inputMode="decimal"
                placeholder="緯度 24.5"
                value={latStr}
                onChange={(e) => setLatStr(e.target.value)}
                className="w-0 flex-1 rounded border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-200"
              />
              <input
                inputMode="decimal"
                placeholder="經度 122.0"
                value={lngStr}
                onChange={(e) => setLngStr(e.target.value)}
                className="w-0 flex-1 rounded border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-200"
              />
              <button
                onClick={placeByCoord}
                className="shrink-0 rounded border border-tactical-cyan bg-tactical-cyan/10 px-2 py-1.5 text-xs font-bold text-tactical-cyan active:scale-95"
              >
                標記
              </button>
            </div>
          </div>
        )}
      </div>

      {!mob && (
        <p className="text-xs leading-relaxed text-slate-300">
          🆘 <b className="text-tactical-alert">點地圖標記位置</b>（或用上方座標）。系統會同時算出
          <b className="text-tactical-alert">🔴 順推（漂到哪）</b>與<b className="text-amber-400">🟠 逆推（從哪來）</b>兩條軌跡。
        </p>
      )}

      {/* 漂流物體類型（不同風壓係數）*/}
      <div>
        <div className="mb-1 text-[0.6875rem] font-semibold text-slate-400">漂流物體類型</div>
        <div className="grid grid-cols-3 gap-1">
          {DRIFT_TARGETS.map((t) => {
            const active = driftTargetId === t.id
            return (
              <button
                key={t.id}
                onClick={() => setDriftTarget(t.id, t.leeway)}
                className={[
                  'flex flex-col items-center rounded border py-1.5 text-[0.625rem] transition-all active:scale-95',
                  active
                    ? 'border-tactical-alert bg-tactical-alert/15 text-tactical-alert'
                    : 'border-slate-700 bg-slate-900/60 text-slate-400',
                ].join(' ')}
              >
                <span className="text-base">{t.icon}</span>
                {t.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* 海象摘要 + 資料來源徽章 */}
      {env && (
        <div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="🌬 風" value={`${env.windSpeed.toFixed(1)} m/s`} sub={`來自${bearingToText(env.windDir)}`} />
            <Stat
              label="🌊 洋流"
              value={`${env.currentSpeed.toFixed(2)} m/s`}
              sub={`往${bearingToText(env.currentDir)}`}
            />
            <Stat label="〰 浪高" value={`${env.waveHeight.toFixed(1)} m`} sub={env.live ? '即時' : 'climatology'} />
          </div>
          <div
            className={`mt-1 rounded px-2 py-0.5 text-center text-[0.625rem] ${
              env.live ? 'bg-tactical-green/10 text-tactical-green' : 'bg-amber-500/10 text-amber-400'
            }`}
          >
            {env.live ? '海流來源：即時 Open-Meteo（隨位置變化）' : '海流來源：黑潮氣候平均（離線／隨位置變化，非即時）'}
          </div>
        </div>
      )}

      {/* 日照窗口 / 天黑倒數（搜救時機）*/}
      {mob && <DaylightWindow lat={mob.lat} lng={mob.lng} />}

      {/* CWA 在地潮汐（近岸擱淺/潮流窗口）*/}
      {mob && tide && tide.length > 0 && (
        <div className="rounded-lg border border-sky-500/40 bg-sky-500/5 p-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[0.6875rem] font-semibold text-sky-300">🌙 潮汐（CWA · {tide[0].station}）</span>
          </div>
          <div className="flex flex-col gap-0.5">
            {tide.slice(0, 4).map((e, i) => (
              <div key={i} className="flex justify-between font-mono text-[0.6875rem]">
                <span className={e.type.includes('滿') || e.type.includes('高') ? 'text-sky-200' : 'text-slate-400'}>
                  {e.type.includes('滿') || e.type.includes('高') ? '▲ 滿潮' : '▼ 乾潮'}
                </span>
                <span className="text-slate-300">{tideClock(e.time)}</span>
                <span className="text-slate-500">
                  {e.heightCm != null ? `${e.heightCm > 0 ? '+' : ''}${Math.round(e.heightCm)} cm` : '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 漂流結果：順推(未來)+逆推(來源)沿路座標，點一下飛過去 */}
      {status === 'loading' && <p className="text-xs text-tactical-cyan">計算漂流中…</p>}
      {status === 'done' && drift.length > 0 && (
        <div className="flex flex-col gap-2">
          <CoordTrack
            title="🔴 順推 · 未來漂到哪（沿路座標，點擊飛過去）"
            points={drift}
            reverse={false}
            incidentTime={incidentTime}
            color="text-tactical-alert"
            onGo={gotoCoord}
          />
          {sourcePoints.length > 0 && (
            <CoordTrack
              title="🟠 逆推 · 從哪漂來（可能落海來源）"
              points={sourcePoints}
              reverse={true}
              incidentTime={incidentTime}
              color="text-amber-400"
              onGo={gotoCoord}
            />
          )}
        </div>
      )}

      {/* 蒙地卡羅機率密度圖 (SAROPS 式) */}
      {status === 'done' && drift.length > 0 && (
        <button
          onClick={() => setShowProbability(!showProbability)}
          className={[
            'rounded-lg border px-3 py-2 text-xs font-bold transition-all active:scale-95',
            showProbability
              ? 'border-tactical-alert bg-tactical-alert/20 text-tactical-alert'
              : 'border-slate-600 bg-slate-900/60 text-slate-300',
          ].join(' ')}
        >
          🎲 {showProbability ? '關閉機率圖' : '蒙地卡羅機率搜索圖 (SAROPS式)'}
        </button>
      )}
      {showProbability && (
        <p className="-mt-1 text-[0.625rem] leading-relaxed text-slate-500">
          在標記點周圍灑 1200 個亂數粒子，各依偏航±風壓差+風流漂流，紅=機率最高、◎=峰值。
          比單一圈更貼近真實搜索範圍（依國研院海洋中心搜救科學方法）。
        </p>
      )}

      {/* 平行梳掃搜索航線 */}
      {status === 'done' && drift.length > 0 && (
        <div className="flex flex-col gap-2">
          <button
            onClick={() => setShowSearchPattern(!showSearchPattern)}
            className={[
              'rounded-lg border px-3 py-2 text-xs font-bold transition-all active:scale-95',
              showSearchPattern
                ? 'border-tactical-cyan bg-tactical-cyan/20 text-tactical-cyan'
                : 'border-slate-600 bg-slate-900/60 text-slate-300',
            ].join(' ')}
          >
            🧭 {showSearchPattern ? '關閉搜索航線' : '產生搜索航線 (平行梳掃)'}
          </button>
          {showSearchPattern && (
            <div className="flex items-center gap-2">
              <span className="text-[0.6875rem] text-slate-400">航線間距</span>
              {[0.5, 1, 2].map((nm) => (
                <button
                  key={nm}
                  onClick={() => setTrackSpacingNm(nm)}
                  className={`rounded border px-2 py-1 font-mono text-[0.6875rem] active:scale-95 ${
                    trackSpacingNm === nm
                      ? 'border-tactical-cyan text-tactical-cyan'
                      : 'border-slate-600 text-slate-400'
                  }`}
                >
                  {nm} 浬
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 雙向時間軸：一進搜救就顯示；標記落海點前為停用＋提示 */}
      {(() => {
        const ready = status === 'done' && drift.length > 0
        return (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2">
            <div className="mb-1 flex items-center justify-between">
              <label className="text-[0.6875rem] font-semibold text-amber-400">⏱ 雙向時間軸</label>
              <span className="font-mono text-[0.6875rem] text-amber-400">
                {!ready
                  ? '待標記落海點'
                  : scrubHours === 0
                    ? '落海點（0h）'
                    : `${fmtClock(driftEpoch(incidentTime, Math.abs(scrubHours), scrubHours < 0))}（${scrubHours < 0 ? '−' : '+'}${Math.abs(scrubHours)}h ${scrubHours < 0 ? '來源' : '漂流'}）`}
              </span>
            </div>
            <input
              type="range"
              min={-72}
              max={72}
              step={1}
              value={scrubHours}
              disabled={!ready}
              onChange={(e) => setScrubHours(Number(e.target.value))}
              className="w-full accent-amber-400 disabled:opacity-40"
            />
            <div className="mt-0.5 flex justify-between font-mono text-[0.5625rem] text-slate-500">
              <span className="text-amber-400">◀ 逆推 −72h</span>
              <span>落海點 0</span>
              <span className="text-tactical-alert">順推 +72h ▶</span>
            </div>
            {!ready && (
              <p className="mt-1 text-[0.625rem] leading-relaxed text-slate-500">
                先在地圖標記落海點（或用上方座標／我的座標），即可拖曳此軸看
                <b className="text-tactical-alert">順推漂流</b>與<b className="text-amber-400">逆推來源</b>。
              </p>
            )}
          </div>
        )
      })()}

      {/* 免費衛星查詢（以標記點為中心、鎖定回報日期）*/}
      {mob && (
        <SatelliteQuickLinks
          lat={mob.lat}
          lng={mob.lng}
          date={new Date(incidentTime).toISOString().slice(0, 10)}
          title="🛰️ 查此位置在回報當日的免費衛星影像"
        />
      )}

      {/* 我的位置 → 落海點 距離 */}
      {distNm !== null && (
        <div className="flex items-center justify-between rounded border border-sky-500/40 bg-sky-500/5 px-2 py-1.5 text-[0.6875rem]">
          <span className="text-sky-300">📍 我 → 落海點</span>
          <span className="font-mono text-sky-200">{distNm.toFixed(1)} 浬</span>
        </div>
      )}

      {mob && (
        <div className="flex gap-2">
          {status === 'done' && drift.length > 0 && (
            <button
              onClick={share}
              className="flex-1 rounded border border-tactical-green/50 bg-tactical-green/10 py-1.5 text-xs font-semibold text-tactical-green active:scale-95"
            >
              📋 產生並分享報告
            </button>
          )}
          <button
            onClick={clear}
            className="rounded border border-slate-600 px-3 py-1.5 text-xs text-slate-300 active:scale-95"
          >
            ✕ 清除
          </button>
        </div>
      )}

      {/* 圖例 */}
      <div className="flex gap-4 text-[0.625rem] text-slate-500">
        <span>
          <span className="text-tactical-green">▬</span> 洋流
        </span>
        <span>
          <span className="text-tactical-cyan">┄</span> 風向
        </span>
        <span>
          <span className="text-tactical-alert">◯</span> 搜索範圍
        </span>
      </div>
    </div>
  )
}

/** 日照窗口 + 天黑倒數。SAR 最看「還有多久天黑」。 */
function DaylightWindow({ lat, lng }: { lat: number; lng: number }) {
  const now = Date.now()
  const s = sunTimes(now, lat, lng)
  const hm = (e: number | null) => {
    if (e == null) return '—'
    const d = new Date(e)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  // 倒數到「天黑」(民用暮光結束 dusk)；若已過，顯示明日日出。
  let line: string
  let urgent = false
  if (s.polar === 'day') line = '永晝（此緯度目前不會天黑）'
  else if (s.polar === 'night') line = '永夜（此緯度目前無日照）'
  else if (s.dusk && now < s.dusk) {
    const mins = Math.round((s.dusk - now) / 60000)
    const h = Math.floor(mins / 60)
    const m = mins % 60
    line = `距天黑約 ${h > 0 ? `${h} 小時 ` : ''}${m} 分`
    urgent = mins < 90
  } else {
    const next = sunTimes(now + 86400000, lat, lng)
    line = `已入夜，明日日出 ${hm(next.sunrise)}`
    urgent = true
  }
  return (
    <div className={`rounded-lg border p-2 ${urgent ? 'border-amber-500/50 bg-amber-500/5' : 'border-slate-700 bg-slate-900/40'}`}>
      <div className="flex items-center justify-between">
        <span className={`text-[0.6875rem] font-semibold ${urgent ? 'text-amber-400' : 'text-slate-300'}`}>
          ☀ 日照窗口 · {line}
        </span>
      </div>
      <div className="mt-1 flex justify-between font-mono text-[0.625rem] text-slate-400">
        <span>曙光 {hm(s.dawn)}</span>
        <span>日出 {hm(s.sunrise)}</span>
        <span>日落 {hm(s.sunset)}</span>
        <span>天黑 {hm(s.dusk)}</span>
      </div>
    </div>
  )
}

/** 一條方向的沿路座標清單（可點擊飛過去）。 */
function CoordTrack({
  title,
  points,
  reverse,
  incidentTime,
  color,
  onGo,
}: {
  title: string
  points: { hours: number; lat: number; lng: number; driftMeters: number; radiusMeters: number; bearingDeg: number }[]
  reverse: boolean
  incidentTime: number
  color: string
  onGo: (lat: number, lng: number, zoom?: number) => void
}) {
  const border = reverse ? 'border-amber-500/40' : 'border-rose-500/40'
  const bg = reverse ? 'bg-amber-500/5' : 'bg-rose-500/5'
  return (
    <div className={`flex flex-col gap-1 rounded border ${border} ${bg} p-2`}>
      <span className={`text-[0.6875rem] font-semibold ${color}`}>{title}</span>
      {points.map((p) => (
        <button
          key={p.hours}
          onClick={() => onGo(p.lat, p.lng, 12)}
          className="flex flex-col rounded border border-slate-700 bg-slate-900/40 px-2 py-1 text-left active:scale-95"
        >
          <div className="flex items-center justify-between">
            <span className={`font-mono text-[0.6875rem] font-bold ${color}`}>
              {fmtClock(driftEpoch(incidentTime, p.hours, reverse))}
              <span className="ml-1 font-normal text-slate-500">
                {reverse ? '−' : '+'}
                {p.hours}h
              </span>
            </span>
            <span className="font-mono text-[0.625rem] text-slate-400">
              {bearingToText(p.bearingDeg)}方 {(p.driftMeters / 1852).toFixed(1)} 浬
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-mono text-[0.625rem] text-slate-300">{fmtDDM(p.lat, p.lng)}</span>
            <span className="font-mono text-[0.5625rem] text-slate-500">
              半徑 {(p.radiusMeters / 1852).toFixed(1)} 浬
            </span>
          </div>
        </button>
      ))}
    </div>
  )
}

/** 潮汐時間顯示（月/日 時:分）。 */
function tideClock(epoch: number): string {
  const d = new Date(epoch)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`
}

/** epoch → datetime-local input 字串（本地時區）。 */
function toLocalInput(epoch: number): string {
  const d = new Date(epoch - new Date(epoch).getTimezoneOffset() * 60000)
  return d.toISOString().slice(0, 16)
}
/** 距今多久的提示。 */
function elapsedHint(epoch: number): string {
  const h = (Date.now() - epoch) / 3600000
  if (h < 0.5) return '即時（現在）'
  if (h < 24) return `回報距今約 ${h.toFixed(1)} 小時`
  return `回報距今約 ${(h / 24).toFixed(1)} 天`
}

/** 兩點大圓距離（海浬）。 */
function haversineNm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const d = Math.PI / 180
  const a =
    Math.sin(((lat2 - lat1) * d) / 2) ** 2 +
    Math.cos(lat1 * d) * Math.cos(lat2 * d) * Math.sin(((lng2 - lng1) * d) / 2) ** 2
  return (2 * R * Math.asin(Math.sqrt(a))) / 1852
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded border border-slate-700 bg-slate-900/60 py-1.5">
      <div className="text-[0.625rem] text-slate-400">{label}</div>
      <div className="font-mono text-sm font-bold text-tactical-green">{value}</div>
      <div className="text-[0.5625rem] text-slate-500">{sub}</div>
    </div>
  )
}
