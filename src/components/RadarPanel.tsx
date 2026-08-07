import { useEffect, useState } from 'react'
import { useTacticalStore } from '../store/tacticalStore'
import { RADAR_TYPES, coverageKm, radarHorizonKm, type RadarType } from '../lib/radar'
import { terrainCoverage } from '../lib/terrain'
import { CoordField } from './CoordField'

/** 常見天線高快捷（m）。 */
const ANTENNA_PRESETS = [15, 25, 40, 60, 100]
/** 目標高快捷（m）：小艇/舢舨/漁船/貨輪。 */
const TARGET_PRESETS = [
  { m: 2, label: '小艇 2m' },
  { m: 3, label: '舢舨 3m' },
  { m: 6, label: '小漁船 6m' },
  { m: 10, label: '漁船 10m' },
  { m: 20, label: '貨輪 20m' },
]

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

  const [name, setName] = useState('')
  const [type, setType] = useState<RadarType>('coast')
  const [antennaM, setAntennaM] = useState(40)
  const [targetM, setTargetM] = useState(2)
  const [maxRangeKm, setMaxRangeKm] = useState(40)
  const [useGps, setUseGps] = useState(false)
  const [manLat, setManLat] = useState('')
  const [manLng, setManLng] = useState('')

  // 點地圖記號或清單✏️→帶入該雷達站資料到表單編輯
  useEffect(() => {
    if (!editingId) return
    const s = sites.find((x) => x.id === editingId)
    if (!s) return
    setName(s.name)
    setType(s.type)
    setAntennaM(s.antennaM)
    setTargetM(s.targetM)
    setMaxRangeKm(s.maxRangeKm)
    setManLat(String(s.lat))
    setManLng(String(s.lng))
    setUseGps(false)
    setOpen(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId])

  const resetForm = () => {
    setName('')
    setManLat('')
    setManLng('')
    setEditingId(null)
  }

  const previewKm = coverageKm({ antennaM, targetM, maxRangeKm } as never)
  const horizon = radarHorizonKm(antennaM, targetM)

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
      targetM,
      maxRangeKm,
    }
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
              <button onClick={() => { setEditingId(null); setOpen(false) }} className="text-slate-400 active:scale-95">
                ✕
              </button>
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

              <label className="text-[0.625rem] text-slate-400">📡 天線高 {antennaM}m</label>
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

              <label className="text-[0.625rem] text-slate-400">🎯 目標高 {targetM}m（越矮涵蓋越短）</label>
              <div className="flex flex-wrap gap-1">
                {TARGET_PRESETS.map((t) => (
                  <button
                    key={t.m}
                    onClick={() => setTargetM(t.m)}
                    className={`rounded border px-2 py-1 text-[0.625rem] active:scale-95 ${
                      targetM === t.m ? 'border-amber-400 bg-amber-400/15 text-amber-300' : 'border-slate-600 text-slate-300'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <label className="text-[0.625rem] text-slate-400">📏 裝備量程上限 {maxRangeKm}km</label>
              <input
                type="range"
                min={10}
                max={120}
                step={5}
                value={maxRangeKm}
                onChange={(e) => setMaxRangeKm(Number(e.target.value))}
                className="w-full accent-cyan-400"
              />

              <div className="rounded bg-slate-800/60 p-1.5 text-[0.6875rem] text-slate-200">
                預估涵蓋 <b className="text-tactical-cyan">{previewKm.toFixed(1)} km</b>
                <span className="text-slate-500">（地平線 {horizon.toFixed(1)}km{horizon > maxRangeKm ? '，受量程限制' : ''}）</span>
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
                  <div key={s.id} className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900/50 px-2.5 py-2">
                    <div className="flex flex-col">
                      <span className="text-xs font-semibold text-slate-200">📡 {s.name}</span>
                      <span className="text-[0.625rem] text-slate-400">
                        {RADAR_TYPES.find((r) => r.id === s.type)?.label}｜天線{s.antennaM}m/目標{s.targetM}m｜涵蓋 {coverageKm(s).toFixed(1)}km
                      </span>
                    </div>
                    <div className="ml-2 flex shrink-0 items-center gap-2">
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
