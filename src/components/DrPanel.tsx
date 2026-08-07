import { useEffect, useMemo, useState } from 'react'
import { useTacticalStore } from '../store/tacticalStore'
import { CoordField } from './CoordField'
import { projectPosition, courseToText } from '../lib/intercept'
import { buildSitrep, shareReport } from '../lib/report'
import { fmtDDM } from '../lib/coordParse'

const MINS = [15, 30, 60, 120]

/**
 * 推算船位（🧭 dead reckoning）：從起點以定航向、定航速直航一段時間後的位置，
 * 以及回推來時位置。用來預判「目標若維持航向航速，X 分鐘後會在哪」以佈署攔截，
 * 或回推嫌疑船從何處來。可從 AIS 挑起點、釘上地圖、一鍵通報。純幾何、免金鑰。
 */
export function DrPanel() {
  const openTool = useTacticalStore((s) => s.openTool)
  const setOpenTool = useTacticalStore((s) => s.setOpenTool)
  const open = openTool === 'dr'
  const setOpen = (v: boolean) => setOpenTool(v ? 'dr' : null)

  const ownPosition = useTacticalStore((s) => s.ownPosition)
  const mapView = useTacticalStore((s) => s.mapView)
  const vessels = useTacticalStore((s) => s.vessels)
  const gotoCoord = useTacticalStore((s) => s.gotoCoord)
  const addSavedCoord = useTacticalStore((s) => s.addSavedCoord)
  const setStatus = useTacticalStore((s) => s.setStatus)
  const targetPrefill = useTacticalStore((s) => s.targetPrefill)
  const setTargetPrefill = useTacticalStore((s) => s.setTargetPrefill)

  const [start, setStart] = useState<{ lat: number; lng: number } | null>(null)
  const [course, setCourse] = useState(90)
  const [speed, setSpeed] = useState(12)
  const [minutes, setMinutes] = useState(30)
  const [pick, setPick] = useState('')

  // 從地圖點船「推算此船」帶入起點與航向航速。
  useEffect(() => {
    if (open && targetPrefill) {
      setStart({ lat: targetPrefill.lat, lng: targetPrefill.lng })
      setCourse(Math.round(targetPrefill.cog))
      setSpeed(Math.round(targetPrefill.sog))
      setStatus(`起點鎖定「${targetPrefill.name}」`)
      setTargetPrefill(null)
    }
  }, [open, targetPrefill, setStatus, setTargetPrefill])

  const startPt = start ?? ownPosition ?? { lat: mapView.lat, lng: mapView.lng }
  const usingGps = !start && Boolean(ownPosition)

  const future = useMemo(() => projectPosition(startPt, course, speed, minutes), [startPt.lat, startPt.lng, course, speed, minutes])
  const past = useMemo(() => projectPosition(startPt, course, speed, -minutes), [startPt.lat, startPt.lng, course, speed, minutes])

  const q = pick.trim().toLowerCase()
  const matches = q ? vessels.filter((v) => v.name.toLowerCase().includes(q) || v.mmsi.includes(q)).slice(0, 8) : []
  const pickVessel = (v: (typeof vessels)[number]) => {
    setStart({ lat: v.lat, lng: v.lng })
    setCourse(Math.round(v.cog))
    setSpeed(Math.round(v.sog))
    setPick('')
    setStatus(`起點鎖定「${v.name}」`)
  }

  const goto = (p: { lat: number; lng: number }) => {
    gotoCoord(p.lat, p.lng, 11)
    setOpen(false)
  }
  const pinPoint = (p: { lat: number; lng: number }, tag: string) => {
    addSavedCoord({ lat: p.lat, lng: p.lng, pinned: true, label: `推算${tag}${minutes}分` })
    setStatus(`已釘選推算船位（${tag}${minutes}分）到地圖`)
  }
  const report = async (p: { lat: number; lng: number }, tag: string) => {
    const body =
      buildSitrep({ lat: p.lat, lng: p.lng, label: `推算船位（${tag}${minutes}分）`, own: ownPosition }) +
      `\n依據：起點 ${fmtDDM(startPt.lat, startPt.lng)}｜航向 ${Math.round(course)}° 航速 ${speed} 節`
    const how = await shareReport(body)
    setStatus(how === 'shared' ? '推算通報已分享' : how === 'copied' ? '推算通報已複製' : '⚠ 分享失敗')
  }

  if (!open) return null

  return (
    <div className="pointer-events-auto fixed inset-0 z-[2000] flex items-end justify-center bg-black/60 p-3 pt-[calc(0.75rem+env(safe-area-inset-top))] md:items-center">
      <div className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-xl border border-slate-700 bg-tactical-bg p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-bold text-tactical-cyan">🧭 推算船位</h2>
          <button onClick={() => setOpen(false)} className="text-slate-400 active:scale-95">✕</button>
        </div>

        {/* 起點 */}
        <div className="rounded-lg border border-sky-500/40 bg-sky-500/5 p-2.5">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[0.6875rem] font-semibold text-sky-300">📍 起點（目前船位）</span>
            <span className="font-mono text-[0.625rem] text-slate-400">
              {usingGps ? '📍GPS' : start ? '手動' : '◎畫面中心'} {startPt.lat.toFixed(3)},{startPt.lng.toFixed(3)}
            </span>
          </div>
          <input
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            spellCheck={false}
            placeholder="🔎 從 AIS 挑起點（自動帶航向航速）"
            className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm text-slate-100"
          />
          {q && (
            <div className="mt-1 flex max-h-32 flex-col gap-0.5 overflow-y-auto">
              {matches.length === 0 && <span className="px-1 text-[0.5625rem] text-slate-500">查無相符</span>}
              {matches.map((v) => (
                <button
                  key={v.mmsi}
                  onClick={() => pickVessel(v)}
                  className="flex items-center justify-between gap-2 rounded border border-slate-700 bg-slate-800/60 px-2 py-1 text-left active:scale-95"
                >
                  <span className="min-w-0 flex-1 truncate text-[0.6875rem] font-semibold text-slate-200">🔺 {v.name}</span>
                  <span className="shrink-0 font-mono text-[0.5625rem] text-slate-400">{v.cog.toFixed(0)}°／{v.sog.toFixed(0)}kn</span>
                </button>
              ))}
            </div>
          )}
          <div className="mt-1.5">
            <CoordField onParsed={(lat, lng) => setStart({ lat, lng })} />
          </div>
          {start && (
            <button onClick={() => setStart(null)} className="mt-1 text-[0.625rem] text-slate-500 underline active:scale-95">
              改回 GPS/畫面中心
            </button>
          )}
        </div>

        {/* 航向/航速/時間 */}
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="flex items-center gap-1.5 text-[0.6875rem] text-slate-300">
            <span className="shrink-0 whitespace-nowrap">航向</span>
            <input
              type="number"
              value={course}
              onChange={(e) => setCourse(((+e.target.value % 360) + 360) % 360)}
              className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1 text-right font-mono text-sm text-slate-100"
            />
            °
          </label>
          <label className="flex items-center gap-1.5 text-[0.6875rem] text-slate-300">
            <span className="shrink-0 whitespace-nowrap">航速</span>
            <input
              type="number"
              value={speed}
              min={0}
              onChange={(e) => setSpeed(Math.max(0, +e.target.value || 0))}
              className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1 text-right font-mono text-sm text-slate-100"
            />
            節
          </label>
        </div>

        <div className="mt-2 flex items-center gap-1.5">
          <span className="text-[0.6875rem] text-slate-400">時間</span>
          {MINS.map((m) => (
            <button
              key={m}
              onClick={() => setMinutes(m)}
              className={`rounded border px-2 py-0.5 text-[0.625rem] font-semibold active:scale-95 ${
                minutes === m ? 'border-tactical-cyan bg-tactical-cyan/15 text-tactical-cyan' : 'border-slate-700 text-slate-400'
              }`}
            >
              {m < 60 ? `${m}分` : `${m / 60}時`}
            </button>
          ))}
          <input
            type="number"
            value={minutes}
            min={1}
            onChange={(e) => setMinutes(Math.max(1, +e.target.value || 0))}
            className="ml-auto w-16 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-right font-mono text-sm text-slate-100"
          />
          <span className="text-[0.6875rem] text-slate-400">分</span>
        </div>

        {/* 未來位置 */}
        <ResultCard
          title={`➡️ ${minutes} 分後（維持航向航速）`}
          p={future}
          accent="green"
          onGoto={() => goto(future)}
          onPin={() => pinPoint(future, '後')}
          onReport={() => report(future, '後')}
          sub={`往 ${courseToText(course)}方 · ${(speed * (minutes / 60)).toFixed(1)} 浬`}
        />
        {/* 回推位置 */}
        <ResultCard
          title={`⬅️ ${minutes} 分前（回推來時）`}
          p={past}
          accent="amber"
          onGoto={() => goto(past)}
          onPin={() => pinPoint(past, '前')}
          onReport={() => report(past, '前')}
          sub={`來自 ${courseToText((course + 180) % 360)}方`}
        />

        <p className="mt-3 text-[0.625rem] leading-relaxed text-slate-500">
          定航向定航速直航推算（不含風流偏移）。要含海流／風漂的搜救漂移，請用搜救模式的漂流預判。
        </p>
      </div>
    </div>
  )
}

function ResultCard({
  title,
  p,
  accent,
  sub,
  onGoto,
  onPin,
  onReport,
}: {
  title: string
  p: { lat: number; lng: number }
  accent: 'green' | 'amber'
  sub: string
  onGoto: () => void
  onPin: () => void
  onReport: () => void
}) {
  const border = accent === 'green' ? 'border-tactical-green/50 bg-tactical-green/10' : 'border-amber-500/40 bg-amber-500/5'
  return (
    <div className={`mt-2 rounded-lg border p-2.5 ${border}`}>
      <div className="text-[0.6875rem] font-semibold text-slate-200">{title}</div>
      <div className="mt-0.5 font-mono text-sm font-bold text-white">{fmtDDM(p.lat, p.lng)}</div>
      <div className="font-mono text-[0.625rem] text-slate-400">
        {p.lat.toFixed(5)}, {p.lng.toFixed(5)} · {sub}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1">
        <button onClick={onGoto} className="rounded border border-tactical-cyan/60 bg-tactical-cyan/10 py-1 text-[0.6875rem] font-bold text-tactical-cyan active:scale-95">
          跳過去
        </button>
        <button onClick={onPin} className="rounded border border-pink-500/60 bg-pink-500/10 py-1 text-[0.6875rem] font-bold text-pink-300 active:scale-95">
          📌 釘選
        </button>
        <button onClick={onReport} className="rounded border border-slate-600 py-1 text-[0.6875rem] font-bold text-slate-300 active:scale-95">
          📋 通報
        </button>
      </div>
    </div>
  )
}
