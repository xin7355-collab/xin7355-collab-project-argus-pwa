import { useEffect, useState } from 'react'
import { useTacticalStore } from '../store/tacticalStore'
import {
  RADAR_TYPES,
  RADAR_PRESETS,
  RADAR_PROP_MODES,
  RADAR_DEFAULTS,
  RANGE_PRESETS_NM,
  TARGET_PRESETS,
  antennaTopM,
  coverageKm,
  radarCoverage,
  type RadarType,
} from '../lib/radar'
import { terrainCoverage } from '../lib/terrain'
import { elevation } from '../lib/elevation'
import { formatDist, toUnit, fromUnit, unitLabel, nmToKm } from '../lib/units'
import { CoordField } from './CoordField'

/** 常見天線離地高快捷（m）。 */
const ANTENNA_PRESETS = [10, 25, 40, 60, 100]

/**
 * 雷達涵蓋規劃面板（📡，私密）：新增/管理雷達站，App 依雷達地平線＋目標高度
 * 算出實際偵測距離。圈與圈的縫＝死角。位置預設取畫面中心，可改用 GPS。
 */
export function RadarPanel() {
  const sites = useTacticalStore((s) => s.radarSites)
  const addRadarSite = useTacticalStore((s) => s.addRadarSite)
  const updateRadarSite = useTacticalStore((s) => s.updateRadarSite)
  const removeRadarSite = useTacticalStore((s) => s.removeRadarSite)
  const editingId = useTacticalStore((s) => s.radarEditingId)
  const setEditingId = useTacticalStore((s) => s.setRadarEditingId)
  const mapView = useTacticalStore((s) => s.mapView)
  const ownPosition = useTacticalStore((s) => s.ownPosition)
  const showRadarGap = useTacticalStore((s) => s.showRadarGap)
  const setShowRadarGap = useTacticalStore((s) => s.setShowRadarGap)
  const showWindClutter = useTacticalStore((s) => s.showWindClutter)
  const setShowWindClutter = useTacticalStore((s) => s.setShowWindClutter)
  const secureHasLock = useTacticalStore((s) => s.secureHasLock)
  const secureUnlocked = useTacticalStore((s) => s.secureUnlocked)
  const showRadarTerrain = useTacticalStore((s) => s.showRadarTerrain)
  const setShowRadarTerrain = useTacticalStore((s) => s.setShowRadarTerrain)
  const setRadarTerrainRing = useTacticalStore((s) => s.setRadarTerrainRing)
  const terrainBusy = useTacticalStore((s) => s.radarTerrainBusy)
  const setTerrainBusy = useTacticalStore((s) => s.setRadarTerrainBusy)
  const setStatus = useTacticalStore((s) => s.setStatus)
  const openTool = useTacticalStore((s) => s.openTool)
  const setOpenTool = useTacticalStore((s) => s.setOpenTool)
  const open = openTool === 'radar'
  const setOpen = (v: boolean) => setOpenTool(v ? 'radar' : null)

  const unit = useTacticalStore((s) => s.distUnit)
  const setDistUnit = useTacticalStore((s) => s.setDistUnit)

  const [name, setName] = useState('')
  const [type, setType] = useState<RadarType>('coast')
  const [antennaM, setAntennaM] = useState(30)
  const [siteElev, setSiteElev] = useState<number | null>(null)
  const [elevBusy, setElevBusy] = useState(false)
  const [targetM, setTargetM] = useState(2)
  const [targetRcs, setTargetRcs] = useState(RADAR_DEFAULTS.targetRcsM2)
  const [maxRangeKm, setMaxRangeKm] = useState(110)
  const [powerKw, setPowerKw] = useState<number | null>(25)
  const [gainDbi, setGainDbi] = useState(RADAR_DEFAULTS.gainDbi)
  const [freqGhz, setFreqGhz] = useState(RADAR_DEFAULTS.freqGhz)
  const [kFactor, setKFactor] = useState(RADAR_DEFAULTS.kFactor)
  const [advOpen, setAdvOpen] = useState(false)
  const [useGps, setUseGps] = useState(false)
  const [manLat, setManLat] = useState('')
  const [manLng, setManLng] = useState('')

  /** 一鍵套用裝備預設（不動站名與座標）。 */
  const applyPreset = (p: (typeof RADAR_PRESETS)[number]) => {
    setAntennaM(p.antennaM)
    setPowerKw(p.powerKw)
    setGainDbi(p.gainDbi)
    setFreqGhz(p.freqGhz)
    setMaxRangeKm(p.maxRangeKm)
    setType(p.type)
  }

  // 點地圖記號或清單✏️→帶入該雷達站資料到表單編輯
  useEffect(() => {
    if (!editingId) return
    const s = sites.find((x) => x.id === editingId)
    if (!s) return
    setName(s.name)
    setType(s.type)
    setAntennaM(s.antennaM)
    setSiteElev(s.siteElevM ?? null)
    setTargetM(s.targetM)
    setTargetRcs(s.targetRcsM2 ?? RADAR_DEFAULTS.targetRcsM2)
    setMaxRangeKm(s.maxRangeKm)
    setPowerKw(Number.isFinite(s.powerKw as number) ? (s.powerKw as number) : null)
    setGainDbi(s.gainDbi ?? RADAR_DEFAULTS.gainDbi)
    setFreqGhz(s.freqGhz ?? RADAR_DEFAULTS.freqGhz)
    setKFactor(s.kFactor ?? RADAR_DEFAULTS.kFactor)
    setManLat(String(s.lat))
    setManLng(String(s.lng))
    setUseGps(false)
    setOpen(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId])

  // 手動座標填好 → 自動查該點地面海拔（山頂/岬角站因此自動算出大範圍）
  useEffect(() => {
    const la = parseFloat(manLat)
    const ln = parseFloat(manLng)
    if (!Number.isFinite(la) || !Number.isFinite(ln)) return
    let cancelled = false
    setElevBusy(true)
    elevation(la, ln)
      .then((e) => { if (!cancelled && Number.isFinite(e as number)) setSiteElev(e as number) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setElevBusy(false) })
    return () => { cancelled = true }
  }, [manLat, manLng])

  const resetForm = () => {
    setName('')
    setManLat('')
    setManLng('')
    setSiteElev(null)
    setEditingId(null)
  }

  // 預覽用的虛擬站台：與實際存檔採同一套涵蓋公式，所見即所得。
  const draft = {
    antennaM, siteElevM: siteElev ?? undefined, targetM, targetRcsM2: targetRcs,
    maxRangeKm, powerKw: powerKw ?? undefined, gainDbi, freqGhz,
    minDetDbm: RADAR_DEFAULTS.minDetDbm, kFactor,
  }
  const cov = radarCoverage(draft as never)
  const previewKm = cov.km
  const antTop = antennaTopM(siteElev ?? undefined, antennaM)

  // 算地形：傳 id 只算單站（點站台看它的真實盲區），不傳算全部
  const computeTerrain = async (onlyId?: string) => {
    const targets = onlyId ? sites.filter((s) => s.id === onlyId) : sites
    if (!targets.length || terrainBusy) return
    setTerrainBusy(true)
    setStatus(onlyId ? '雷達地形遮蔽：查詢此站高程中…' : '雷達地形遮蔽：查詢高程中…（依站數需數秒）')
    try {
      for (const s of targets) {
        const ring = await terrainCoverage({
          lat: s.lat,
          lng: s.lng,
          antennaM: s.antennaM,
          targetM: s.targetM,
          maxKm: coverageKm(s),
        })
        if (ring.length >= 3) setRadarTerrainRing(s.id, ring)
      }
      setShowRadarTerrain(true)
      setStatus('雷達地形遮蔽：已依 90m 地形切出真實盲區（岬角/離島遮蔽）')
    } catch {
      setStatus('⚠ 地形高程取得失敗（需連網）；維持圓圈')
      alert('地形高程取得失敗，請確認網路。維持原本圓圈。')
    } finally {
      setTerrainBusy(false)
    }
  }

  const add = () => {
    // 位置優先序：手動萬用座標 > 我的 GPS > 畫面中心
    const mLat = parseFloat(manLat)
    const mLng = parseFloat(manLng)
    let pos: { lat: number; lng: number }
    if (Number.isFinite(mLat) && Number.isFinite(mLng)) {
      pos = { lat: mLat, lng: mLng }
    } else if (useGps) {
      if (!ownPosition) {
        alert('尚無 GPS 定位，無法用我的位置。請改用畫面中心/手動座標，或先開啟定位。')
        return
      }
      pos = ownPosition
    } else {
      pos = mapView
    }
    const data = {
      name: name.trim() || `雷達站 ${sites.length + 1}`,
      lat: pos.lat,
      lng: pos.lng,
      type,
      antennaM,
      siteElevM: siteElev ?? undefined,
      targetM,
      targetRcsM2: targetRcs,
      maxRangeKm,
      powerKw: powerKw ?? undefined,
      gainDbi,
      freqGhz,
      minDetDbm: RADAR_DEFAULTS.minDetDbm,
      kFactor,
    }
    // 註：用畫面中心/GPS 建站時 siteElevM 可能仍為空，交由 RadarLayer 自動補查 DEM
    // （那裡對所有缺高程的站統一補），這裡不重複發請求。
    if (editingId) {
      updateRadarSite(editingId, data)
      setStatus(`已更新「${data.name}」`)
    } else {
      addRadarSite(data)
    }
    resetForm()
    setOpen(false)
  }

  // 機敏鎖：設了 PIN 且未解鎖 → 雷達功能完全隱藏（無按鈕/無痕跡）。
  if (secureHasLock && !secureUnlocked) return null

  return (
    <>
      {open && (
        <div className="pointer-events-auto fixed inset-0 z-[2000] flex items-end justify-center bg-black/60 p-3 pt-[calc(0.75rem+env(safe-area-inset-top))] md:items-center">
          <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl border border-slate-700 bg-tactical-bg p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-base font-bold text-tactical-cyan">📡 雷達涵蓋規劃</h2>
              <div className="flex items-center gap-2">
                {/* 距離單位切換（預設浬）——全 App 共用此設定 */}
                <div className="flex overflow-hidden rounded border border-slate-600">
                  {(['nm', 'km'] as const).map((u) => (
                    <button
                      key={u}
                      onClick={() => setDistUnit(u)}
                      className={`px-2 py-0.5 text-[0.625rem] font-bold active:scale-95 ${
                        unit === u ? 'bg-tactical-cyan/20 text-tactical-cyan' : 'text-slate-400'
                      }`}
                    >
                      {unitLabel(u)}
                    </button>
                  ))}
                </div>
                <button onClick={() => { setEditingId(null); setOpen(false) }} className="text-slate-400 active:scale-95">
                  ✕
                </button>
              </div>
            </div>
            <p className="mb-3 text-[0.625rem] leading-relaxed text-slate-400">
              放上你已知的雷達站，App 依<b>雷達地平線＋目標高度</b>算實際偵測距離。圈與圈的縫＝
              <b className="text-amber-300">死角</b>。資料只存你手機、不上傳、旁人看不到。
            </p>

            {editingId && (
              <div className="mb-3 flex items-center justify-between rounded-lg border border-amber-400/50 bg-amber-400/10 px-2.5 py-1.5">
                <span className="text-xs font-semibold text-amber-300">✏️ 編輯中：{name || '此雷達站'}</span>
                <button
                  onClick={() => computeTerrain(editingId)}
                  disabled={terrainBusy}
                  className="rounded border border-amber-500/60 bg-amber-500/15 px-2 py-1 text-[0.625rem] font-bold text-amber-300 active:scale-95 disabled:opacity-50"
                >
                  {terrainBusy ? '⏳' : '🏔️ 算此站地形'}
                </button>
              </div>
            )}

            {/* 分析疊層開關 */}
            <div className="mb-3 flex flex-col gap-1.5">
              <button
                onClick={() => setShowRadarGap(!showRadarGap)}
                className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 text-left active:scale-95 ${
                  showRadarGap ? 'border-rose-500/60 bg-rose-500/10' : 'border-slate-700 bg-slate-900/50'
                }`}
              >
                <span className={`mt-0.5 text-xs ${showRadarGap ? 'text-rose-400' : 'text-slate-500'}`}>
                  {showRadarGap ? '☑' : '☐'}
                </span>
                <span className="flex flex-col">
                  <span className={`text-xs font-semibold ${showRadarGap ? 'text-rose-300' : 'text-slate-200'}`}>
                    🎯 小艇死角高亮
                  </span>
                  <span className="text-[0.625rem] text-slate-400">每站疊「漁船10m vs 小艇2m」涵蓋，紅環＝只看得到大船、圈縫＝低矮目標死角</span>
                </span>
              </button>
              <button
                onClick={() => setShowWindClutter(!showWindClutter)}
                className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 text-left active:scale-95 ${
                  showWindClutter ? 'border-rose-500/60 bg-rose-500/10' : 'border-slate-700 bg-slate-900/50'
                }`}
              >
                <span className={`mt-0.5 text-xs ${showWindClutter ? 'text-rose-400' : 'text-slate-500'}`}>
                  {showWindClutter ? '☑' : '☐'}
                </span>
                <span className="flex flex-col">
                  <span className={`text-xs font-semibold ${showWindClutter ? 'text-rose-300' : 'text-slate-200'}`}>
                    📡⚠ 離岸風電雷達雜波區
                  </span>
                  <span className="text-[0.625rem] text-slate-400">把離岸風電場標成雜波/陰影區；此區雷達偵測可信度低，建議 AIS/光學交叉查證</span>
                </span>
              </button>

              {/* 地形遮蔽（真實盲區）*/}
              {sites.length > 0 && (
                <div className="flex gap-1.5">
                  <button
                    onClick={() => computeTerrain()}
                    disabled={terrainBusy}
                    className="flex-1 rounded-lg border border-amber-500/60 bg-amber-500/15 py-2 text-xs font-bold text-amber-300 active:scale-95 disabled:opacity-50"
                  >
                    {terrainBusy ? '⏳ 計算中…' : '🏔️ 計算地形遮蔽（真實盲區）'}
                  </button>
                  <button
                    onClick={() => setShowRadarTerrain(!showRadarTerrain)}
                    className={`rounded-lg border px-3 py-2 text-xs active:scale-95 ${showRadarTerrain ? 'border-amber-500 bg-amber-500/15 text-amber-300' : 'border-slate-600 text-slate-300'}`}
                  >
                    {showRadarTerrain ? '圓圈' : '地形'}
                  </button>
                </div>
              )}
            </div>

            {/* 新增表單 */}
            <div className="mb-3 flex flex-col gap-2 rounded-lg border border-slate-700 bg-slate-900/40 p-2.5">
              {/* 快速預設：不懂數值的人一鍵填好（天線高/功率/增益/頻段/量程） */}
              <div className="rounded-lg border border-tactical-cyan/40 bg-tactical-cyan/5 p-2">
                <div className="mb-1.5 text-[0.6875rem] font-bold text-tactical-cyan">
                  📡 快速預設（不確定就選這個）
                </div>
                <div className="grid grid-cols-4 gap-1">
                  {RADAR_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => applyPreset(p)}
                      className="flex flex-col items-center gap-0.5 rounded border border-slate-600 bg-slate-800/60 px-1 py-1.5 active:scale-95"
                    >
                      <span className="text-base leading-none">{p.icon}</span>
                      <span className="text-[0.5625rem] font-bold text-slate-100">{p.label}</span>
                      <span className="text-[0.5rem] leading-tight text-slate-400">{p.desc}</span>
                    </button>
                  ))}
                </div>
                <div className="mt-1 text-[0.5625rem] leading-tight text-slate-400">
                  選完只要填站名＋位置就能新增；下面數值可再手動微調。
                </div>
              </div>

              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="站名（例：富貴角、外傘頂洲燈塔）"
                className="rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-slate-100"
              />
              <div className="grid grid-cols-4 gap-1">
                {RADAR_TYPES.map((rt) => (
                  <button
                    key={rt.id}
                    onClick={() => setType(rt.id)}
                    className={`rounded border px-1 py-1 text-[0.625rem] font-semibold active:scale-95 ${
                      type === rt.id ? 'text-slate-900' : 'border-slate-600 text-slate-300'
                    }`}
                    style={type === rt.id ? { background: rt.color, borderColor: rt.color } : undefined}
                  >
                    {rt.label}
                  </button>
                ))}
              </div>

              <label className="text-[0.625rem] text-slate-400">📡 天線高（鐵塔離地高）{antennaM}m</label>
              <div className="flex flex-wrap gap-1">
                {ANTENNA_PRESETS.map((h) => (
                  <button
                    key={h}
                    onClick={() => setAntennaM(h)}
                    className={`rounded border px-2 py-1 text-[0.625rem] active:scale-95 ${
                      antennaM === h ? 'border-tactical-cyan bg-tactical-cyan/15 text-tactical-cyan' : 'border-slate-600 text-slate-300'
                    }`}
                  >
                    {h}m
                  </button>
                ))}
                <input
                  type="number"
                  value={antennaM}
                  onChange={(e) => setAntennaM(Math.max(1, Number(e.target.value) || 1))}
                  className="w-16 rounded border border-slate-600 bg-slate-800 px-1 py-1 text-[0.6875rem] text-slate-100"
                />
              </div>

              {/* 站點地面海拔（座標自動查）→ 天線頂高。山頂站不必手填海拔。 */}
              <div className="rounded border border-tactical-green/40 bg-tactical-green/5 p-1.5 text-[0.625rem] leading-relaxed text-slate-300">
                🏔️ 站點地面海拔{' '}
                {elevBusy ? (
                  <span className="text-slate-400">查詢中…</span>
                ) : siteElev != null ? (
                  <b className="text-tactical-green">{Math.round(siteElev)}m</b>
                ) : (
                  <span className="text-slate-400">未查（填座標後自動查）</span>
                )}
                {siteElev != null && (
                  <>
                    （座標自動查）＋ 天線 {antennaM}m ＝ 天線頂{' '}
                    <b className="text-tactical-green">{Math.round(antTop)}m</b>。
                    山頂站自動有大範圍，你只要填鐵塔高。
                  </>
                )}
              </div>

              <label className="text-[0.625rem] text-slate-400">
                🎯 目標高 {targetM}m ／ RCS {targetRcs}m²（越矮越小＝涵蓋越短）
              </label>
              <div className="flex flex-wrap gap-1">
                {TARGET_PRESETS.map((t) => (
                  <button
                    key={t.m}
                    onClick={() => { setTargetM(t.m); setTargetRcs(t.rcs) }}
                    className={`rounded border px-2 py-1 text-[0.625rem] active:scale-95 ${
                      targetM === t.m ? 'border-amber-400 bg-amber-400/15 text-amber-300' : 'border-slate-600 text-slate-300'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {/* 功率（瓦數）——雷達方程式的關鍵；不知道就留空不套用此限制 */}
              <div className="grid grid-cols-2 gap-1.5">
                <div className="flex flex-col gap-0.5">
                  <label className="text-[0.625rem] text-slate-400">⚡ 峰值功率 (kW)</label>
                  <input
                    type="number"
                    value={powerKw ?? ''}
                    placeholder="不知道就留空"
                    onChange={(e) => {
                      const v = e.target.value.trim()
                      setPowerKw(v === '' ? null : Math.max(0.1, Number(v) || 0.1))
                    }}
                    className="rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-slate-100"
                  />
                </div>
                <div className="flex flex-col gap-0.5">
                  <label className="text-[0.625rem] text-slate-400">📶 頻段 (GHz)</label>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setFreqGhz(9.4)}
                      className={`flex-1 rounded border px-1 py-1.5 text-[0.625rem] active:scale-95 ${
                        freqGhz === 9.4 ? 'border-tactical-cyan bg-tactical-cyan/15 text-tactical-cyan' : 'border-slate-600 text-slate-300'
                      }`}
                    >
                      X 9.4
                    </button>
                    <button
                      onClick={() => setFreqGhz(3.05)}
                      className={`flex-1 rounded border px-1 py-1.5 text-[0.625rem] active:scale-95 ${
                        freqGhz === 3.05 ? 'border-tactical-cyan bg-tactical-cyan/15 text-tactical-cyan' : 'border-slate-600 text-slate-300'
                      }`}
                    >
                      S 3.05
                    </button>
                  </div>
                </div>
              </div>
              <div className="text-[0.5625rem] leading-tight text-slate-500">
                留空功率＝不套用功率限制，只用視距與規格量程估算（誠實優於瞎猜）。
                S 波段波長長、雨衰小，同功率打得比 X 波段遠。
              </div>

              {/* 規格量程：「目前已知可以打多遠」 */}
              <label className="text-[0.625rem] text-slate-400">
                📏 已知可以打多遠（型錄規格量程）{formatDist(maxRangeKm, unit)}
              </label>
              <div className="flex flex-wrap gap-1">
                {RANGE_PRESETS_NM.map((nm) => {
                  const km = nmToKm(nm)
                  return (
                    <button
                      key={nm}
                      onClick={() => setMaxRangeKm(km)}
                      className={`rounded border px-2 py-1 text-[0.625rem] active:scale-95 ${
                        Math.abs(maxRangeKm - km) < 0.05
                          ? 'border-tactical-cyan bg-tactical-cyan/15 text-tactical-cyan'
                          : 'border-slate-600 text-slate-300'
                      }`}
                    >
                      {formatDist(km, unit, 0)}
                    </button>
                  )
                })}
                <input
                  type="number"
                  value={Number(toUnit(maxRangeKm, unit).toFixed(1))}
                  onChange={(e) => setMaxRangeKm(Math.max(1, fromUnit(Number(e.target.value) || 1, unit)))}
                  className="w-20 rounded border border-slate-600 bg-slate-800 px-1 py-1 text-[0.6875rem] text-slate-100"
                />
                <span className="self-center text-[0.625rem] text-slate-400">{unitLabel(unit)}</span>
              </div>

              {/* 傳播條件：海面逆溫/波導會讓雷達打得更遠 */}
              <label className="text-[0.625rem] text-slate-400">🌐 傳播條件（日夜/大氣折射）</label>
              <div className="grid grid-cols-3 gap-1">
                {RADAR_PROP_MODES.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setKFactor(m.k)}
                    className={`rounded border px-1 py-1.5 text-[0.5625rem] font-semibold active:scale-95 ${
                      kFactor === m.k ? 'border-tactical-cyan bg-tactical-cyan/15 text-tactical-cyan' : 'border-slate-600 text-slate-300'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <div className="text-[0.5625rem] leading-tight text-slate-500">
                {RADAR_PROP_MODES.find((m) => m.k === kFactor)?.hint}
              </div>

              {/* 進階：天線增益 */}
              <button
                onClick={() => setAdvOpen(!advOpen)}
                className="self-start text-[0.625rem] text-tactical-cyan active:scale-95"
              >
                {advOpen ? '▾' : '▸'} 進階（天線增益／接收靈敏度）
              </button>
              {advOpen && (
                <div className="flex flex-col gap-1 rounded border border-slate-700 bg-slate-900/50 p-2">
                  <label className="text-[0.625rem] text-slate-400">天線增益 {gainDbi} dBi</label>
                  <input
                    type="range"
                    min={15}
                    max={45}
                    step={1}
                    value={gainDbi}
                    onChange={(e) => setGainDbi(Number(e.target.value))}
                    className="w-full accent-cyan-400"
                  />
                  <div className="text-[0.5625rem] leading-tight text-slate-500">
                    接收靈敏度固定 {RADAR_DEFAULTS.minDetDbm} dBm。增益每 +6dBi，功率極限距離約 ×1.4。
                  </div>
                </div>
              )}

              {/* 涵蓋預估：看得出是誰在卡 */}
              <div className="rounded bg-slate-800/60 p-1.5 text-[0.6875rem] leading-relaxed text-slate-200">
                預估涵蓋 <b className="text-tactical-cyan">{formatDist(previewKm, unit)}</b>
                <span className="text-slate-500">
                  （
                  {cov.limit === 'horizon' ? '視距限制' : cov.limit === 'power' ? '功率限制' : '規格量程限制'}
                  ：視距 {formatDist(cov.horizonKm, unit)}
                  {Number.isFinite(cov.powerKm) ? ` / 功率 ${formatDist(cov.powerKm, unit)}` : ' / 功率未設'}
                  {' / '}規格 {formatDist(cov.specKm, unit)}）
                </span>
              </div>

              {/* 手動萬用座標（可貼任何格式；填了就以此為準） */}
              <div className="flex flex-col gap-0.5">
                <label className="text-[0.6875rem] text-slate-400">📍 手動座標（可留空 → 用下方 GPS/畫面中心）</label>
                <CoordField onParsed={(la, ln) => { setManLat(String(la)); setManLng(String(ln)) }} />
              </div>

              <label className="flex items-center gap-2 text-[0.6875rem] text-slate-300">
                <input type="checkbox" checked={useGps} onChange={(e) => setUseGps(e.target.checked)} />
                用我的 GPS 位置（否則放在畫面中心 {mapView.lat.toFixed(3)},{mapView.lng.toFixed(3)}）
              </label>

              <div className="flex gap-1.5">
                <button
                  onClick={add}
                  className="flex-1 rounded-lg border border-tactical-cyan bg-tactical-cyan/15 py-2 text-sm font-bold text-tactical-cyan active:scale-95"
                >
                  {editingId ? '💾 儲存修改' : '＋ 新增到地圖'}
                </button>
                {editingId && (
                  <button
                    onClick={() => { resetForm(); setOpen(false) }}
                    className="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-300 active:scale-95"
                  >
                    取消
                  </button>
                )}
              </div>
            </div>

            {/* 已建站清單 */}
            {sites.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <div className="text-[0.6875rem] font-semibold text-slate-400">已建雷達站（{sites.length}）</div>
                {sites.map((s) => (
                  <div
                    key={s.id}
                    className={`flex items-center justify-between rounded-lg border px-2.5 py-2 ${
                      s.off ? 'border-slate-700/60 bg-slate-900/30 opacity-60' : 'border-slate-700 bg-slate-900/50'
                    }`}
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-xs font-semibold text-slate-200">
                        📡 {s.name}{s.off && <span className="ml-1 text-[0.5625rem] text-slate-500">（已關閉）</span>}
                      </span>
                      <span className="text-[0.625rem] text-slate-400">
                        {RADAR_TYPES.find((r) => r.id === s.type)?.label}｜天線頂
                        {Math.round(antennaTopM(s.siteElevM, s.antennaM))}m/目標{s.targetM}m
                        {s.powerKw ? `/${s.powerKw}kW` : ''}｜涵蓋 {formatDist(coverageKm(s), unit)}
                      </span>
                    </div>
                    <div className="ml-2 flex shrink-0 items-center gap-2">
                      {/* 個別開關：關閉＝地圖不畫此站涵蓋/死角環，但保留設定 */}
                      <button
                        onClick={() => updateRadarSite(s.id, { off: !s.off })}
                        className={`rounded border px-1.5 py-0.5 text-[0.5625rem] font-bold active:scale-95 ${
                          s.off
                            ? 'border-slate-600 bg-slate-800 text-slate-400'
                            : 'border-tactical-green/60 bg-tactical-green/10 text-tactical-green'
                        }`}
                        aria-label={s.off ? '開啟' : '關閉'}
                      >
                        {s.off ? '關' : '開'}
                      </button>
                      <button onClick={() => setEditingId(s.id)} className="text-tactical-cyan active:scale-95" aria-label="編輯">✏️</button>
                      <button onClick={() => removeRadarSite(s.id)} className="text-rose-400 active:scale-95" aria-label="刪除">🗑</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
