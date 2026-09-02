import { useMemo, useState } from 'react'
import { useTacticalStore } from '../store/tacticalStore'
import { analyzePath, pathDistanceKm, type PathAnalysis } from '../lib/pathProfile'
import { MICROWAVE_BANDS, compareBands, linkBudget } from '../lib/microwave'
import { formatDist } from '../lib/units'
import { CoordField } from './CoordField'

/** 端點：可從既有站台清單挑，或手動輸入座標。 */
interface Endpoint {
  lat: number
  lng: number
  name: string
}

/** 常見碟形天線增益（dBi）——隨頻率而變，這裡給常見組合的概數。 */
const DISH_PRESETS = [
  { id: 'd03', label: '0.3m 碟', gain: 28 },
  { id: 'd06', label: '0.6m 碟', gain: 34 },
  { id: 'd12', label: '1.2m 碟', gain: 40 },
]

/**
 * 微波備用鏈路（📶）：兩個已知端點之間的路徑剖面分析。
 * 回答三件事——途中有沒有遮蔽物、Fresnel 淨空夠不夠、暴雨時還通不通。
 */
export function MicrowavePanel() {
  const openTool = useTacticalStore((s) => s.openTool)
  const setOpenTool = useTacticalStore((s) => s.setOpenTool)
  const repeaters = useTacticalStore((s) => s.repeaters)
  const radarSites = useTacticalStore((s) => s.radarSites)
  const mapView = useTacticalStore((s) => s.mapView)
  const ownPosition = useTacticalStore((s) => s.ownPosition)
  const unit = useTacticalStore((s) => s.distUnit)
  const setMwPath = useTacticalStore((s) => s.setMwPath)
  const setStatus = useTacticalStore((s) => s.setStatus)
  const open = openTool === 'microwave'

  // 可挑選的既有站台（微波通常打到中繼台或雷達站）
  const stations = useMemo<Endpoint[]>(
    () => [
      ...repeaters.map((r) => ({ lat: r.lat, lng: r.lng, name: `📻 ${r.name}` })),
      ...radarSites.map((r) => ({ lat: r.lat, lng: r.lng, name: `📡 ${r.name}` })),
    ],
    [repeaters, radarSites],
  )

  const [aPt, setAPt] = useState<Endpoint | null>(null)
  const [bPt, setBPt] = useState<Endpoint | null>(null)
  const [aAnt, setAAnt] = useState(30)
  const [bAnt, setBAnt] = useState(30)
  const [freqGhz, setFreqGhz] = useState(7)
  const [clutterM, setClutterM] = useState(3)
  const [dishGain, setDishGain] = useState(34)
  const [txDbm, setTxDbm] = useState(25)
  const [rxSens, setRxSens] = useState(-78)
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<PathAnalysis | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const distKm = aPt && bPt ? pathDistanceKm(aPt.lat, aPt.lng, bPt.lat, bPt.lng) : 0

  const run = async () => {
    if (!aPt || !bPt) {
      setErr('請先設定兩端端點')
      return
    }
    setBusy(true)
    setErr(null)
    setStatus('微波鏈路：查詢路徑地形中…')
    try {
      const r = await analyzePath({
        a: { lat: aPt.lat, lng: aPt.lng, antennaM: aAnt },
        b: { lat: bPt.lat, lng: bPt.lng, antennaM: bAnt },
        freqGhz,
        clutterMarginM: clutterM,
      })
      setRes(r)
      setMwPath({
        a: aPt,
        b: bPt,
        worst: r.worst
          ? { lat: r.worst.lat, lng: r.worst.lng, km: r.worst.km, ratio: r.worst.fresnelRatio, groundM: r.worst.groundM }
          : null,
        ok: r.fresnelOk,
        blocked: r.losBlocked,
        totalKm: r.totalKm,
      })
      setStatus(
        r.losBlocked
          ? '微波鏈路：視線被地形擋住，需加高或改中繼'
          : r.fresnelOk
            ? '微波鏈路：視線通、Fresnel 淨空達標'
            : '微波鏈路：視線通但 Fresnel 淨空不足，會有繞射損耗',
      )
    } catch {
      setErr('地形高程取得失敗（需連網）。請稍後再試。')
      setStatus('⚠ 微波鏈路：高程查詢失敗')
    } finally {
      setBusy(false)
    }
  }

  const budget = distKm > 0
    ? linkBudget({ freqGhz, km: distKm, txDbm, txGainDbi: dishGain, rxGainDbi: dishGain, rxSensDbm: rxSens })
    : null

  const EndpointPicker = ({
    label,
    value,
    onPick,
  }: {
    label: string
    value: Endpoint | null
    onPick: (e: Endpoint) => void
  }) => (
    <div className="flex flex-col gap-1 rounded border border-slate-700 bg-slate-900/50 p-2">
      <div className="text-[0.6875rem] font-bold text-tactical-cyan">{label}</div>
      <div className="text-[0.625rem] text-slate-300">
        {value ? (
          <>
            <b>{value.name}</b>{' '}
            <span className="text-slate-500">
              {value.lat.toFixed(4)}, {value.lng.toFixed(4)}
            </span>
          </>
        ) : (
          <span className="text-slate-500">尚未設定</span>
        )}
      </div>
      {stations.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {stations.map((s, i) => (
            <button
              key={i}
              onClick={() => onPick(s)}
              className="rounded border border-slate-600 px-1.5 py-0.5 text-[0.5625rem] text-slate-300 active:scale-95"
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-1">
        <button
          onClick={() => onPick({ lat: mapView.lat, lng: mapView.lng, name: '畫面中心' })}
          className="flex-1 rounded border border-slate-600 py-1 text-[0.5625rem] text-slate-300 active:scale-95"
        >
          畫面中心
        </button>
        <button
          onClick={() => ownPosition && onPick({ ...ownPosition, name: '我的位置' })}
          disabled={!ownPosition}
          className="flex-1 rounded border border-slate-600 py-1 text-[0.5625rem] text-slate-300 active:scale-95 disabled:opacity-40"
        >
          我的 GPS
        </button>
      </div>
      <CoordField onParsed={(la, ln) => onPick({ lat: la, lng: ln, name: '手動座標' })} />
    </div>
  )

  if (!open) return null

  return (
    <div className="pointer-events-auto fixed inset-0 z-[2000] flex items-end justify-center bg-black/60 p-3 pt-[calc(0.75rem+env(safe-area-inset-top))] md:items-center">
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl border border-slate-700 bg-tactical-bg p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-bold text-tactical-cyan">📶 微波備用鏈路</h2>
          <button onClick={() => setOpenTool(null)} className="text-slate-400 active:scale-95">
            ✕
          </button>
        </div>
        <p className="mb-3 text-[0.625rem] leading-relaxed text-slate-400">
          兩端點之間的<b>路徑剖面</b>分析：途中有沒有遮蔽物、Fresnel 淨空夠不夠、
          <b className="text-amber-300">暴雨時還通不通</b>。微波實務要求第一 Fresnel 區 60% 淨空，
          只是「沒撞到山」並不夠。
        </p>

        <div className="mb-2 flex flex-col gap-2">
          <EndpointPicker label="A 端（發話端）" value={aPt} onPick={setAPt} />
          <EndpointPicker label="B 端（要打到的站台）" value={bPt} onPick={setBPt} />
        </div>

        {distKm > 0 && (
          <div className="mb-2 rounded bg-slate-800/60 p-1.5 text-center text-[0.6875rem] text-slate-200">
            路徑長 <b className="text-tactical-cyan">{formatDist(distKm, unit)}</b>
          </div>
        )}

        {/* 天線高與頻段 */}
        <div className="mb-2 grid grid-cols-2 gap-1.5">
          <label className="flex flex-col gap-0.5 text-[0.625rem] text-slate-400">
            A 端天線高 (m)
            <input
              type="number"
              value={aAnt}
              onChange={(e) => setAAnt(Math.max(1, Number(e.target.value) || 1))}
              className="rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-slate-100"
            />
          </label>
          <label className="flex flex-col gap-0.5 text-[0.625rem] text-slate-400">
            B 端天線高 (m)
            <input
              type="number"
              value={bAnt}
              onChange={(e) => setBAnt(Math.max(1, Number(e.target.value) || 1))}
              className="rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-slate-100"
            />
          </label>
        </div>

        <label className="text-[0.625rem] text-slate-400">📶 頻段</label>
        <div className="mb-1 grid grid-cols-4 gap-1">
          {MICROWAVE_BANDS.map((m) => (
            <button
              key={m.ghz}
              onClick={() => setFreqGhz(m.ghz)}
              className={`rounded border py-1 text-[0.5625rem] font-bold active:scale-95 ${
                freqGhz === m.ghz
                  ? 'border-tactical-cyan bg-tactical-cyan/15 text-tactical-cyan'
                  : 'border-slate-600 text-slate-300'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="mb-2 text-[0.5625rem] leading-tight text-slate-500">
          {MICROWAVE_BANDS.find((m) => m.ghz === freqGhz)?.note}
        </div>

        <label className="text-[0.625rem] text-slate-400">
          🌳 額外雜波餘裕 {clutterM}m（路徑經市區/林地時加）
        </label>
        <input
          type="range"
          min={0}
          max={20}
          step={1}
          value={clutterM}
          onChange={(e) => setClutterM(Number(e.target.value))}
          className="mb-2 w-full accent-cyan-400"
        />

        <button
          onClick={run}
          disabled={busy || !aPt || !bPt}
          className="mb-2 w-full rounded-lg border border-tactical-cyan bg-tactical-cyan/15 py-2 text-sm font-bold text-tactical-cyan active:scale-95 disabled:opacity-40"
        >
          {busy ? '⏳ 查詢路徑地形中…' : '🔍 分析路徑遮蔽'}
        </button>
        {err && <div className="mb-2 rounded bg-rose-500/15 p-2 text-[0.6875rem] text-rose-300">{err}</div>}

        {/* 遮蔽判定結果 */}
        {res && (
          <div
            className={`mb-2 flex flex-col gap-1 rounded-lg border p-2 ${
              res.losBlocked
                ? 'border-rose-500/60 bg-rose-500/10'
                : res.fresnelOk
                  ? 'border-tactical-green/60 bg-tactical-green/10'
                  : 'border-amber-400/60 bg-amber-400/10'
            }`}
          >
            <div className="text-xs font-bold">
              {res.losBlocked ? (
                <span className="text-rose-300">❌ 視線被擋住 — 這條打不通</span>
              ) : res.fresnelOk ? (
                <span className="text-tactical-green">✅ 通，且 Fresnel 淨空達標</span>
              ) : (
                <span className="text-amber-300">⚠ 視線通，但 Fresnel 淨空不足</span>
              )}
            </div>
            <div className="text-[0.625rem] leading-relaxed text-slate-300">
              兩端天線頂海拔：A {Math.round(res.aTopM)}m ／ B {Math.round(res.bTopM)}m
              {res.worst && (
                <>
                  <br />
                  最糟點在 <b className="text-slate-100">{formatDist(res.worst.km, unit)}</b> 處
                  （地面 {Math.round(res.worst.groundM)}m）：
                  <br />
                  淨空 <b className={res.worst.clearanceM < 0 ? 'text-rose-300' : 'text-slate-100'}>
                    {res.worst.clearanceM.toFixed(1)}m
                  </b>
                  ，為第一 Fresnel 區（{res.worst.fresnelM.toFixed(1)}m）的{' '}
                  <b className={res.worst.fresnelRatio < 0.6 ? 'text-amber-300' : 'text-tactical-green'}>
                    {(res.worst.fresnelRatio * 100).toFixed(0)}%
                  </b>
                  <span className="text-slate-500">（需 ≥60%）</span>
                </>
              )}
              {res.neededRaiseM != null && (
                <>
                  <br />
                  <b className="text-amber-300">兩端各再加高 {res.neededRaiseM}m</b> 即可達標
                  <span className="text-slate-500">（或改走中繼點）</span>
                </>
              )}
            </div>
          </div>
        )}

        {/* 鏈路預算與雨衰 */}
        {budget && (
          <div className="mb-2 flex flex-col gap-1 rounded-lg border border-slate-700 bg-slate-900/40 p-2">
            <div className="text-[0.6875rem] font-bold text-tactical-cyan">📊 鏈路預算與雨衰</div>
            <div className="grid grid-cols-3 gap-1">
              {DISH_PRESETS.map((d) => (
                <button
                  key={d.id}
                  onClick={() => setDishGain(d.gain)}
                  className={`rounded border py-1 text-[0.5625rem] active:scale-95 ${
                    dishGain === d.gain
                      ? 'border-tactical-cyan bg-tactical-cyan/15 text-tactical-cyan'
                      : 'border-slate-600 text-slate-300'
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <label className="flex flex-col gap-0.5 text-[0.5625rem] text-slate-400">
                發射功率 (dBm)
                <input
                  type="number"
                  value={txDbm}
                  onChange={(e) => setTxDbm(Number(e.target.value) || 0)}
                  className="rounded border border-slate-600 bg-slate-800 px-1 py-1 text-[0.6875rem] text-slate-100"
                />
              </label>
              <label className="flex flex-col gap-0.5 text-[0.5625rem] text-slate-400">
                接收靈敏度 (dBm)
                <input
                  type="number"
                  value={rxSens}
                  onChange={(e) => setRxSens(Number(e.target.value) || -78)}
                  className="rounded border border-slate-600 bg-slate-800 px-1 py-1 text-[0.6875rem] text-slate-100"
                />
              </label>
            </div>
            <div className="text-[0.625rem] leading-relaxed text-slate-300">
              晴天餘裕 <b className="text-slate-100">{budget.fadeMarginDb.toFixed(1)} dB</b>
              　−　暴雨雨衰 <b className="text-amber-300">{budget.rainDb.toFixed(1)} dB</b>
              <br />
              暴雨時剩餘{' '}
              <b className={budget.survivesRain ? 'text-tactical-green' : 'text-rose-300'}>
                {budget.marginInRainDb.toFixed(1)} dB
              </b>{' '}
              {budget.survivesRain ? '✅ 仍可通' : '❌ 會斷線'}
            </div>

            {/* 選頻建議：備援鏈路最該看的一張表 */}
            <div className="mt-1 border-t border-slate-700 pt-1">
              <div className="mb-0.5 text-[0.5625rem] text-slate-400">
                同天線同功率下各頻段的暴雨餘裕（{formatDist(distKm, unit)}）
              </div>
              <div className="flex flex-col gap-0.5">
                {compareBands({
                  km: distKm,
                  txDbm,
                  txGainDbi: dishGain,
                  rxGainDbi: dishGain,
                  rxSensDbm: rxSens,
                }).map(({ ghz, b }) => (
                  <div key={ghz} className="flex items-center justify-between text-[0.5625rem]">
                    <span className={ghz === freqGhz ? 'font-bold text-tactical-cyan' : 'text-slate-400'}>
                      {ghz} GHz
                    </span>
                    <span className={b.survivesRain ? 'text-tactical-green' : 'text-rose-300'}>
                      雨衰 {b.rainDb.toFixed(0)}dB → 剩 {b.marginInRainDb.toFixed(0)}dB{' '}
                      {b.survivesRain ? '✅' : '❌'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="text-[0.5rem] leading-tight text-slate-500">
          地形來源為 90m 網格 DSM（已含建築植被但被抹平），單棟高樓可能未計入——路徑經市區請用雜波餘裕手動補。
          雨衰採 ITU-R P.838／P.530 簡化式，台灣 0.01% 降雨強度取 80mm/h。此為規劃參考，正式施工仍須現場實勘。
        </div>
      </div>
    </div>
  )
}
