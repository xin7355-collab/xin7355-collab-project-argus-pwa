import { useEffect, useMemo, useState } from 'react'
import { useTacticalStore } from '../store/tacticalStore'
import { CoordField } from './CoordField'
import { solveIntercept, courseToText } from '../lib/intercept'
import { buildSitrep, shareReport } from '../lib/report'

/**
 * 攔截計算（🎯）：輸入目標位置／航向／航速與我方航速，算出「該往哪個方向開、
 * 幾分鐘攔到、攔截點在哪」。可從 AIS 選定目標、圖上顯示幾何、一鍵通報。
 * 平面幾何、免金鑰、可離線。
 */
export function InterceptPanel() {
  const openTool = useTacticalStore((s) => s.openTool)
  const setOpenTool = useTacticalStore((s) => s.setOpenTool)
  const open = openTool === 'intercept'
  const setOpen = (v: boolean) => setOpenTool(v ? 'intercept' : null)

  const ownPosition = useTacticalStore((s) => s.ownPosition)
  const mapView = useTacticalStore((s) => s.mapView)
  const vessels = useTacticalStore((s) => s.vessels)
  const gotoCoord = useTacticalStore((s) => s.gotoCoord)
  const setStatus = useTacticalStore((s) => s.setStatus)
  const setInterceptSolution = useTacticalStore((s) => s.setInterceptSolution)
  const targetPrefill = useTacticalStore((s) => s.targetPrefill)
  const setTargetPrefill = useTacticalStore((s) => s.setTargetPrefill)

  const [ownSpeed, setOwnSpeed] = useState(25)
  const [own, setOwn] = useState<{ lat: number; lng: number } | null>(null)
  const [target, setTarget] = useState<{ lat: number; lng: number } | null>(null)
  const [tCourse, setTCourse] = useState(90)
  const [tSpeed, setTSpeed] = useState(12)
  const [pickTarget, setPickTarget] = useState('')

  // 從地圖點船「攔截此船」帶入：設定目標位置與航向航速後清掉旗標。
  useEffect(() => {
    if (open && targetPrefill) {
      setTarget({ lat: targetPrefill.lat, lng: targetPrefill.lng })
      setTCourse(Math.round(targetPrefill.cog))
      setTSpeed(Math.round(targetPrefill.sog))
      setStatus(`目標鎖定「${targetPrefill.name}」`)
      setTargetPrefill(null)
    }
  }, [open, targetPrefill, setStatus, setTargetPrefill])

  // 我方預設用 GPS，否則畫面中心（可用萬用座標覆蓋）
  const ownPt = own ?? ownPosition ?? { lat: mapView.lat, lng: mapView.lng }
  const usingGps = !own && Boolean(ownPosition)

  const result = useMemo(() => {
    if (!target) return null
    return solveIntercept({
      own: ownPt,
      ownSpeedKn: ownSpeed,
      target,
      targetCourseDeg: tCourse,
      targetSpeedKn: tSpeed,
    })
  }, [ownPt.lat, ownPt.lng, ownSpeed, target, tCourse, tSpeed])

  // 從 AIS 挑目標：自動帶入位置、航向(COG)、航速(SOG)
  const q = pickTarget.trim().toLowerCase()
  const matches = q
    ? vessels.filter((v) => v.name.toLowerCase().includes(q) || v.mmsi.includes(q)).slice(0, 8)
    : []
  const pickVessel = (v: (typeof vessels)[number]) => {
    setTarget({ lat: v.lat, lng: v.lng })
    setTCourse(Math.round(v.cog))
    setTSpeed(Math.round(v.sog))
    setPickTarget('')
    setStatus(`目標鎖定「${v.name}」`)
  }

  const showOnMap = () => {
    if (!result?.feasible || !target) return
    setInterceptSolution({ own: ownPt, target, point: result.point })
    gotoCoord(result.point.lat, result.point.lng, 10)
    setOpen(false)
    setStatus(`攔截點已顯示：操${courseToText(result.courseDeg)}向 ${Math.round(result.courseDeg)}°，約 ${Math.round(result.timeMin)} 分`)
  }

  const report = async () => {
    if (!result?.feasible || !target) return
    const extra =
      `\n操向：${courseToText(result.courseDeg)}方 ${Math.round(result.courseDeg)}°｜我方航速 ${ownSpeed} 節` +
      `\n預計 ${Math.round(result.timeMin)} 分後攔截（航程 ${result.ownDistNm.toFixed(1)} 浬）` +
      `\n目標：航向 ${Math.round(tCourse)}° 航速 ${tSpeed} 節`
    const body = buildSitrep({ lat: result.point.lat, lng: result.point.lng, label: '攔截點', own: ownPt }) + extra
    const how = await shareReport(body)
    setStatus(how === 'shared' ? '攔截通報已分享' : how === 'copied' ? '攔截通報已複製' : '⚠ 分享失敗')
  }

  if (!open) return null

  return (
    <div className="pointer-events-auto fixed inset-0 z-[2000] flex items-end justify-center bg-black/60 p-3 pt-[calc(0.75rem+env(safe-area-inset-top))] md:items-center">
      <div className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-xl border border-slate-700 bg-tactical-bg p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-bold text-tactical-cyan">🎯 攔截計算</h2>
          <button onClick={() => setOpen(false)} className="text-slate-400 active:scale-95">✕</button>
        </div>

        {/* 我方 */}
        <div className="rounded-lg border border-sky-500/40 bg-sky-500/5 p-2.5">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[0.6875rem] font-semibold text-sky-300">🚤 我方</span>
            <span className="font-mono text-[0.625rem] text-slate-400">
              {usingGps ? '📍GPS' : own ? '手動' : '◎畫面中心'} {ownPt.lat.toFixed(3)},{ownPt.lng.toFixed(3)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[0.6875rem] text-slate-300">航速</label>
            <input
              type="number"
              value={ownSpeed}
              min={1}
              onChange={(e) => setOwnSpeed(Math.max(1, +e.target.value || 0))}
              className="w-20 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-right font-mono text-sm text-slate-100"
            />
            <span className="text-[0.6875rem] text-slate-400">節</span>
            {own && (
              <button onClick={() => setOwn(null)} className="ml-auto text-[0.625rem] text-slate-500 underline active:scale-95">
                改回 GPS
              </button>
            )}
          </div>
          <div className="mt-1.5">
            <CoordField onParsed={(lat, lng) => setOwn({ lat, lng })} />
          </div>
        </div>

        {/* 目標 */}
        <div className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5">
          <div className="mb-1 text-[0.6875rem] font-semibold text-amber-300">🎯 目標</div>

          {/* 從 AIS 挑 */}
          <input
            value={pickTarget}
            onChange={(e) => setPickTarget(e.target.value)}
            spellCheck={false}
            placeholder="🔎 從 AIS 挑目標（船名／MMSI，自動帶航向航速）"
            className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm text-slate-100"
          />
          {q && (
            <div className="mt-1 flex max-h-32 flex-col gap-0.5 overflow-y-auto">
              {matches.length === 0 && <span className="px-1 text-[0.5625rem] text-slate-500">查無相符（船需已回報上圖）</span>}
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
            <CoordField onParsed={(lat, lng) => setTarget({ lat, lng })} />
          </div>
          {target && (
            <div className="mt-1 font-mono text-[0.625rem] text-slate-400">
              目標位置 {target.lat.toFixed(4)}, {target.lng.toFixed(4)}
            </div>
          )}

          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="flex items-center gap-1.5 text-[0.6875rem] text-slate-300">
              <span className="shrink-0 whitespace-nowrap">航向</span>
              <input
                type="number"
                value={tCourse}
                onChange={(e) => setTCourse(((+e.target.value % 360) + 360) % 360)}
                className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1 text-right font-mono text-sm text-slate-100"
              />
              °
            </label>
            <label className="flex items-center gap-1.5 text-[0.6875rem] text-slate-300">
              <span className="shrink-0 whitespace-nowrap">航速</span>
              <input
                type="number"
                value={tSpeed}
                min={0}
                onChange={(e) => setTSpeed(Math.max(0, +e.target.value || 0))}
                className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1 text-right font-mono text-sm text-slate-100"
              />
              節
            </label>
          </div>
        </div>

        {/* 結果 */}
        {!target && (
          <p className="mt-3 text-[0.6875rem] leading-relaxed text-slate-500">
            填入目標位置（或從 AIS 挑），即時算出該操航向與攔截時間。
          </p>
        )}
        {result && !result.feasible && (
          <div className="mt-3 rounded-lg border border-rose-500/50 bg-rose-500/10 p-2.5 text-[0.6875rem] leading-relaxed text-rose-200">
            ⚠ 無法攔截：{result.reason}
            <div className="mt-1 font-mono text-[0.625rem] text-slate-400">
              目標現距 {result.rangeNm.toFixed(1)} 浬／方位 {Math.round(result.bearingDeg)}°
            </div>
          </div>
        )}
        {result && result.feasible && (
          <div className="mt-3 rounded-lg border border-tactical-green/50 bg-tactical-green/10 p-3">
            <div className="text-[0.625rem] text-slate-400">該操航向（真北）</div>
            <div className="font-mono text-2xl font-bold text-white">
              {courseToText(result.courseDeg)} {Math.round(result.courseDeg)}°
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[0.6875rem] text-slate-200">
              <span className="text-slate-500">攔截時間</span>
              <span>{fmtMin(result.timeMin)}</span>
              <span className="text-slate-500">我方航程</span>
              <span>{result.ownDistNm.toFixed(1)} 浬</span>
              <span className="text-slate-500">目前距離</span>
              <span>{result.rangeNm.toFixed(1)} 浬（{Math.round(result.bearingDeg)}°）</span>
              <span className="text-slate-500">接近速率</span>
              <span>{result.closingKn.toFixed(1)} 節</span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                onClick={showOnMap}
                className="rounded border border-tactical-cyan bg-tactical-cyan/15 py-1.5 text-xs font-bold text-tactical-cyan active:scale-95"
              >
                🗺️ 圖上顯示
              </button>
              <button
                onClick={report}
                className="rounded border border-tactical-green/60 bg-tactical-green/10 py-1.5 text-xs font-bold text-tactical-green active:scale-95"
              >
                📋 攔截通報
              </button>
            </div>
          </div>
        )}

        <p className="mt-3 text-[0.625rem] leading-relaxed text-slate-500">
          定常方位攔截解（假設雙方等速直航）。平面近似、純幾何、可離線；供快速決策參考，
          實際請並用雷達 ARPA 與現場判斷。
        </p>
      </div>
    </div>
  )
}

function fmtMin(min: number): string {
  if (min < 60) return `${Math.round(min)} 分`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return `${h} 時 ${m} 分`
}
