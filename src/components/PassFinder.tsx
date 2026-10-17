import { useCallback, useEffect, useRef, useState } from 'react'
import { useTacticalStore } from '../store/tacticalStore'
import { fetchFleetTle } from '../lib/satFleet'
import {
  planPasses,
  topPerSat,
  isGrazing,
  passDurationText,
  passKey,
  toOverlay,
  type PassPlan,
  type PlannedPass,
} from '../lib/passPlan'
import { tleAgeText } from '../lib/satTrack'
import { formatDist } from '../lib/units'
import { Hint } from './Hint'

// ── 「下一趟會不會拍到我這片海」─────────────────────────
//
// 這個面板回答的是先前答不出來的那個問題。以前只能說「一趟掃幅夠不夠寬」，
// 因為算地面軌跡需要軌道根數（TLE），而 celestrak 沒送 CORS 標頭，
// 瀏覽器直連被擋。現在 TLE 由自家 Worker 代抓，SGP4 在前端跑。
//
// 兩件事刻意做得很明顯：
//  1. 「找不到根數」「根數推不動」「真的沒過境」分開顯示。顯示成一片空白
//     等於告訴使用者「這幾天沒有衛星會經過」——那是錯的，而且錯得很貴。
//  2. 「掃得到」不等於「會拍」。Sentinel／Landsat 都有取像排程，
//     開闊外海常常不在排程內。軌道算不出排程，所以照實講。

const WINDOWS: { h: number; label: string }[] = [
  { h: 24, label: '未來 24 小時' },
  { h: 72, label: '未來 3 天' },
  { h: 120, label: '未來 5 天' },
]

const KIND_STYLE: Record<string, string> = {
  雷達: 'border-tactical-cyan/50 text-tactical-cyan',
  光學: 'border-amber-500/50 text-amber-300',
  '夜間/每日': 'border-violet-500/50 text-violet-300',
}

const STATE_TEXT: Record<string, { icon: string; cls: string; text: string }> = {
  none: { icon: '○', cls: 'text-slate-400', text: '這段時間掃不到這裡' },
  noTle: {
    icon: '⚠',
    cls: 'text-amber-300',
    text: '軌道根數清單裡找不到這顆——不代表沒有過境，是算不出來',
  },
  badTle: {
    icon: '⚠',
    cls: 'text-rose-300',
    text: '根數壞掉或衛星已脫軌，推算不出位置',
  },
}

function md(ms: number): string {
  const d = new Date(ms)
  return `${d.getMonth() + 1}/${d.getDate()}`
}
function hm(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function PassFinder() {
  const mapView = useTacticalStore((s) => s.mapView)
  const unit = useTacticalStore((s) => s.distUnit)
  const satPass = useTacticalStore((s) => s.satPass)
  const setSatPass = useTacticalStore((s) => s.setSatPass)

  const [hours, setHours] = useState(72)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [plan, setPlan] = useState<PassPlan | null>(null)
  const [at, setAt] = useState<{ lat: number; lng: number } | null>(null)
  const [groupErrors, setGroupErrors] = useState<string[]>([])
  const [perSat, setPerSat] = useState(1)
  // 算完才回寫 state；元件在算的途中被卸載（切模式）就丟掉結果，不要 setState。
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const run = useCallback(
    async (h: number) => {
      setBusy(true)
      setErr('')
      const lat = mapView.lat
      const lng = mapView.lng
      try {
        const fleet = await fetchFleetTle()
        setGroupErrors(fleet.groupErrors ?? [])
        // 先讓瀏覽器把「計算中」畫出來。SGP4 掃三天約數百毫秒，
        // 直接接著算的話按鈕會像沒反應（主執行緒被佔住，連按鈕回饋都不會動）。
        await new Promise((r) => setTimeout(r, 0))
        const p = planPasses(fleet, lat, lng, Date.now(), { windowHours: h })
        if (!alive.current) return
        setPlan(p)
        setAt({ lat, lng })
        setPerSat(1)
      } catch (e) {
        if (!alive.current) return
        setPlan(null)
        setGroupErrors([])
        setErr(e instanceof Error ? e.message : '取不到軌道根數')
      } finally {
        if (alive.current) setBusy(false)
      }
    },
    [mapView.lat, mapView.lng],
  )

  const now = Date.now()
  const moved =
    at && (Math.abs(at.lat - mapView.lat) > 0.05 || Math.abs(at.lng - mapView.lng) > 0.05)

  const rows = plan ? topPerSat(plan.passes, perSat) : []
  const more = plan ? plan.passes.length - rows.length : 0
  const age = plan?.oldestEpochMs != null ? tleAgeText(plan.oldestEpochMs, now) : null

  const toggle = (p: PlannedPass) => {
    if (satPass?.key === passKey(p)) {
      setSatPass(null)
      return
    }
    const ov = toOverlay(p, `${p.craft} ${md(p.startMs)} ${hm(p.startMs)}`)
    // points 空的代表根數重算不出來。放一個空疊層上去，使用者會以為
    // 「這趟沒掃到任何地方」——那是錯的結論，寧可講算不出來。
    if (ov.points.length < 2) {
      setErr(`${p.craft} 這一趟的軌跡算不出來（根數可能已失效），請重新整理根數`)
      return
    }
    setErr('')
    setSatPass(ov)
  }

  return (
    <div className="rounded-lg border border-violet-500/40 bg-violet-500/5 p-2">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-sm font-bold text-violet-300">
          🎯 哪顆衛星會掃到這片海
        </span>
        <select
          value={hours}
          onChange={(e) => {
            const h = Number(e.target.value)
            setHours(h)
            if (plan) void run(h)
          }}
          className="rounded border border-slate-600 bg-slate-900 px-1.5 py-1 text-[0.6875rem] text-slate-200"
        >
          {WINDOWS.map((w) => (
            <option key={w.h} value={w.h}>
              {w.label}
            </option>
          ))}
        </select>
      </div>

      <button
        onClick={() => void run(hours)}
        disabled={busy}
        className={`mt-2 w-full rounded-lg border py-2 text-sm font-bold active:scale-95 ${
          busy
            ? 'border-slate-700 text-slate-500'
            : 'border-violet-400 bg-violet-500/20 text-violet-200'
        }`}
      >
        {busy ? '計算中…（抓軌道根數並推算）' : plan ? '🔄 以目前畫面中心重算' : '▶ 開始計算'}
      </button>

      {moved && !busy && (
        <p className="mt-1.5 text-[0.625rem] text-amber-300">
          ⚠ 地圖移動過了。下面這份是用 {at.lat.toFixed(2)}, {at.lng.toFixed(2)} 算的，按上面重算。
        </p>
      )}

      {err && (
        <p className="mt-2 rounded bg-rose-500/10 px-2 py-1.5 text-[0.6875rem] leading-relaxed text-rose-300">
          ⚠ {err}
          <br />
          <span className="text-slate-400">
            軌道根數由本站自己的伺服器向 celestrak 代抓。海上網路不穩時稍後再按一次；
            一直失敗代表上游或代理有問題，不是你這邊設定錯。
          </span>
        </p>
      )}

      {plan && (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 text-[0.625rem] text-slate-400">
            <span>
              以 {at?.lat.toFixed(2)}, {at?.lng.toFixed(2)} 為目標
            </span>
            {age && (
              <span className={age.stale ? 'text-amber-300' : 'text-slate-400'}>
                · {age.text}
                {age.stale ? '（偏舊，誤差會變大）' : ''}
              </span>
            )}
          </div>

          {groupErrors.length > 0 && (
            <p className="mt-1.5 rounded bg-amber-500/10 px-2 py-1.5 text-[0.625rem] leading-relaxed text-amber-300">
              ⚠ 有 {groupErrors.length} 組根數這次沒抓到（{groupErrors.join('；')}）。
              <span className="text-slate-400">
                　下面標成「找不到這顆」的，可能只是這次沒下載到，不是真的沒有——按上面重算再試一次。
              </span>
            </p>
          )}

          {rows.length === 0 ? (
            <p className="mt-2 rounded bg-slate-800/60 px-2 py-1.5 text-[0.6875rem] leading-relaxed text-slate-300">
              這段時間內，下面列出的衛星都沒有掃到這個位置。
              <br />
              <span className="text-slate-400">
                窄掃幅的 Sentinel／Landsat 本來就要好幾天才輪到同一點，把時窗拉長到 5 天再看一次。
              </span>
            </p>
          ) : (
            <div className="mt-2 flex flex-col gap-1.5">
              {rows.map((p) => {
                const on = satPass?.key === passKey(p)
                return (
                  <button
                    key={passKey(p)}
                    onClick={() => toggle(p)}
                    className={`rounded-lg border p-2 text-left active:scale-[0.99] ${
                      on
                        ? 'border-violet-400 bg-violet-500/15'
                        : 'border-slate-700 bg-slate-900/50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-base">{p.emoji}</span>
                      <span className="flex-1 truncate text-xs font-bold text-slate-200">
                        {p.craft}
                      </span>
                      <span
                        className={`shrink-0 rounded border px-1.5 py-0.5 text-[0.5625rem] font-semibold ${KIND_STYLE[p.kind]}`}
                      >
                        {p.kind}
                      </span>
                    </div>
                    <div className="mt-1 font-mono text-[0.8125rem] font-bold text-tactical-green">
                      {md(p.startMs)} {hm(p.startMs)} – {hm(p.endMs)}
                      <span className="ml-1 font-sans text-[0.625rem] font-normal text-slate-400">
                        {passDurationText(p)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-[0.625rem] text-slate-400">
                      <span className={isGrazing(p) ? 'text-amber-300' : undefined}>
                        最接近 {formatDist(p.closestKm, unit)}
                      </span>
                      <span>解析度 {p.resText}</span>
                      <span>掃幅 {formatDist(p.swathKm, unit, 0)}</span>
                    </div>
                    {isGrazing(p) && (
                      <div className="mt-0.5 text-[0.625rem] leading-relaxed text-amber-300/90">
                        ⚠ 擦邊：目標在掃描帶最外緣，解析度最差，而且推算誤差可能讓它根本沒掃到
                      </div>
                    )}
                    <div className="mt-1 text-[0.625rem] text-violet-300/90">
                      {on ? '✓ 已畫在地圖上（再按一次收起來）' : '按一下在地圖上畫出這趟的掃描帶'}
                    </div>
                  </button>
                )
              })}
              {more > 0 && (
                <button
                  onClick={() => setPerSat((n) => n + 2)}
                  className="rounded border border-slate-600 py-1.5 text-[0.6875rem] text-slate-300 active:scale-95"
                >
                  還有 {more} 趟，展開更多
                </button>
              )}
            </div>
          )}

          {/* 算不出來的那幾顆一定要講，不能顯示成「沒有過境」 */}
          {plan.status.some((s) => s.state !== 'passes') && (
            <div className="mt-2 flex flex-col gap-0.5 rounded bg-slate-800/60 px-2 py-1.5">
              {plan.status
                .filter((s) => s.state !== 'passes')
                .map((s) => {
                  const d = STATE_TEXT[s.state]
                  return (
                    <div key={s.satId} className="text-[0.625rem] leading-relaxed">
                      <span className={d.cls}>
                        {d.icon} {s.emoji} {s.satName}
                      </span>
                      <span className="text-slate-400">　{d.text}</span>
                    </div>
                  )
                })}
            </div>
          )}
        </>
      )}

      <Hint
        id="passfinder-limits"
        tone="warn"
        title="這份預報準到什麼程度？"
        gist="位置是真的（SGP4＋真實根數）；但「掃得到」不等於「一定會拍」"
      >
        <div>
          <b className="text-slate-200">位置是真的。</b>
          用的是 SGP4（業界標準軌道推算）加上 celestrak 的真實軌道根數（TLE），
          不是示意圖。根數每天更新幾次；三天內的推算誤差通常在幾公里內，
          越往後誤差越大，所以時窗最多開到 5 天。
        </div>
        <div>
          <b className="text-amber-300">但「掃得到」不等於「會拍」。</b>
          這裡算的是幾何：衛星飛過去的時候，感測器的掃幅涵不涵蓋你這個點。
          Sentinel／Landsat 實際上都有取像排程，<b className="text-slate-200">開闊外海常常不在排程內</b>，
          飛過去也不會按快門。排程不是軌道算得出來的，所以這個面板不會假裝知道。
        </div>
        <div>
          <b className="text-slate-200">沒驗到：</b>
          實際排程內容與各任務的取像策略，我沒有可靠來源可以在 App 裡查證。
          要確認某一趟是不是真的有影像，還是得到下面的 Copernicus Browser／
          USGS EarthExplorer 查那一天有沒有那一景。
        </div>
        <div>
          掃幅邊緣幾公里內不要當精準值——真正的取像邊界還受衛星姿態影響。
          另外每顆列的是「最早的幾趟」，不是全部。
        </div>
      </Hint>
    </div>
  )
}
