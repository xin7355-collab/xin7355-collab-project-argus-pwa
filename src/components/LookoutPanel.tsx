import { useRef, useState } from 'react'
import { useTacticalStore } from '../store/tacticalStore'
import {
  lookoutReachKm,
  opticalHorizonKm,
  OPTIC_PRESETS,
  LOOKOUT_TARGETS,
  exportLookoutsJson,
  parseLookoutsJson,
  type Lookout,
} from '../lib/lookout'
import { terrainCoverage } from '../lib/terrain'
import { saveOrShareText, saveResultMsg } from '../lib/fileShare'
import { CoordField } from './CoordField'

const EYE_PRESETS = [2, 5, 10, 30, 100]

/**
 * 瞭望哨視域面板（👁️，私密）：輸入沿岸觀測點，畫可視範圍，
 * 並以 90m DEM 切出被地形擋住的死角——找非法越界小艇可能鑽的縫。
 */
export function LookoutPanel() {
  const list = useTacticalStore((s) => s.lookouts)
  const addLookout = useTacticalStore((s) => s.addLookout)
  const removeLookout = useTacticalStore((s) => s.removeLookout)
  const lookoutTrash = useTacticalStore((s) => s.lookoutTrash)
  const restoreLookout = useTacticalStore((s) => s.restoreLookout)
  const clearLookoutTrash = useTacticalStore((s) => s.clearLookoutTrash)
  const importLookouts = useTacticalStore((s) => s.importLookouts)
  const mapView = useTacticalStore((s) => s.mapView)
  const ownPosition = useTacticalStore((s) => s.ownPosition)
  const showTerrain = useTacticalStore((s) => s.showLookoutTerrain)
  const setShowTerrain = useTacticalStore((s) => s.setShowLookoutTerrain)
  const busy = useTacticalStore((s) => s.lookoutBusy)
  const setBusy = useTacticalStore((s) => s.setLookoutBusy)
  const setRing = useTacticalStore((s) => s.setLookoutRing)
  const setStatus = useTacticalStore((s) => s.setStatus)
  const openTool = useTacticalStore((s) => s.openTool)
  const setOpenTool = useTacticalStore((s) => s.setOpenTool)
  const open = openTool === 'lookout'
  const setOpen = (v: boolean) => setOpenTool(v ? 'lookout' : null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const exportBackup = async () => {
    if (!list.length) return
    const r = await saveOrShareText(
      `argus-lookouts-${new Date().toISOString().slice(0, 10)}.json`,
      exportLookoutsJson(list),
      'application/json',
    )
    setStatus(saveResultMsg(r, `${list.length} 座瞭望哨備份`))
  }
  const importBackup = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const parsed = parseLookoutsJson(String(reader.result || ''))
      if (!parsed || !parsed.length) {
        alert('匯入失敗：檔案格式不符或沒有瞭望哨資料')
        return
      }
      importLookouts(parsed)
      setStatus(`已匯入 ${parsed.length} 座瞭望哨`)
    }
    reader.readAsText(file)
  }

  const [name, setName] = useState('')
  const [pos, setPos] = useState<'coord' | 'center' | 'gps'>('coord')
  const [latStr, setLatStr] = useState('')
  const [lngStr, setLngStr] = useState('')
  const [eyeM, setEyeM] = useState(10)
  const [targetM, setTargetM] = useState(1)
  const [maxKm, setMaxKm] = useState(15)

  const preview: Lookout = { id: '', name, lat: 0, lng: 0, eyeM, targetM, maxKm }
  const reach = lookoutReachKm(preview)
  const horiz = opticalHorizonKm(eyeM, targetM)

  const resolvePos = (): { lat: number; lng: number } | null => {
    if (pos === 'gps') return ownPosition ? { lat: ownPosition.lat, lng: ownPosition.lng } : null
    if (pos === 'center') return { lat: mapView.lat, lng: mapView.lng }
    const la = parseFloat(latStr)
    const ln = parseFloat(lngStr)
    if (!Number.isFinite(la) || !Number.isFinite(ln)) return null
    return { lat: la, lng: ln }
  }

  const add = () => {
    const p = resolvePos()
    if (!p) {
      alert(pos === 'gps' ? '尚無 GPS 定位' : '請輸入有效的緯度、經度')
      return
    }
    addLookout({ name: name.trim() || `瞭望哨 ${list.length + 1}`, lat: p.lat, lng: p.lng, eyeM, targetM, maxKm })
    setName('')
    setLatStr('')
    setLngStr('')
    setOpen(false)
  }

  const computeTerrain = async () => {
    if (!list.length || busy) return
    setBusy(true)
    setStatus('瞭望視域：查詢地形高程中…（依哨數需數秒）')
    try {
      for (const l of list) {
        const ring = await terrainCoverage({
          lat: l.lat,
          lng: l.lng,
          antennaM: l.eyeM,
          targetM: l.targetM,
          maxKm: lookoutReachKm(l),
        })
        if (ring.length >= 3) setRing(l.id, ring)
      }
      setShowTerrain(true)
      setStatus('瞭望視域：已依 90m 地形切出真實可視形狀（含岬角/山遮蔽死角）')
    } catch {
      setStatus('⚠ 地形高程取得失敗（需連網）；維持圓圈估算')
      alert('地形高程取得失敗，請確認網路。維持原本圓圈估算。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {open && (
        <div className="pointer-events-auto fixed inset-0 z-[2000] flex items-end justify-center bg-black/60 p-3 pt-[calc(0.75rem+env(safe-area-inset-top))] md:items-center">
          <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl border border-slate-700 bg-tactical-bg p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-base font-bold text-lime-300">👁️ 瞭望哨視域</h2>
              <button onClick={() => setOpen(false)} className="text-slate-400 active:scale-95">✕</button>
            </div>
            <p className="mb-3 text-[0.625rem] leading-relaxed text-slate-400">
              沿岸/高地觀測點<b>看得到哪片海</b>：目視地平線＋辨識距離取小，再用地形切出
              <b>被岬角/山擋住的死角</b>——研判非法越界小艇可能鑽的縫。資料只存本機。
            </p>

            <div className="flex flex-col gap-2 rounded-lg border border-slate-700 bg-slate-900/40 p-2.5">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="哨名（例：鼻頭角瞭望哨）"
                className="rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-slate-100"
              />

              <div className="grid grid-cols-3 gap-1">
                {([['coord', '手動座標'], ['center', '畫面中心'], ['gps', '我的 GPS']] as const).map(([id, label]) => (
                  <button
                    key={id}
                    onClick={() => setPos(id)}
                    className={`rounded border px-1 py-1 text-[0.625rem] font-semibold active:scale-95 ${
                      pos === id ? 'border-lime-400 bg-lime-400/15 text-lime-300' : 'border-slate-600 text-slate-300'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {pos === 'coord' && (
                <div className="flex flex-col gap-1.5">
                  <CoordField onParsed={(la, ln) => { setLatStr(String(la)); setLngStr(String(ln)) }} />
                  <div className="grid grid-cols-2 gap-1.5">
                    <input value={latStr} onChange={(e) => setLatStr(e.target.value)} inputMode="decimal" placeholder="緯度 例 25.13" className="rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-slate-100" />
                    <input value={lngStr} onChange={(e) => setLngStr(e.target.value)} inputMode="decimal" placeholder="經度 例 121.92" className="rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-slate-100" />
                  </div>
                </div>
              )}
              {pos === 'center' && (
                <span className="text-[0.625rem] text-slate-400">用畫面中心 {mapView.lat.toFixed(4)}, {mapView.lng.toFixed(4)}</span>
              )}

              {/* 眼高（哨台+眼睛） */}
              <label className="text-[0.625rem] text-slate-400">👁️ 觀測眼高 {eyeM}m（<b>離地高</b>＝哨台高＋人眼；地面海拔由地形自動補。高地哨請按下方「計算地形視域」才準）</label>
              <div className="flex flex-wrap gap-1">
                {EYE_PRESETS.map((h) => (
                  <button key={h} onClick={() => setEyeM(h)} className={`rounded border px-2 py-1 text-[0.625rem] active:scale-95 ${eyeM === h ? 'border-lime-400 bg-lime-400/15 text-lime-300' : 'border-slate-600 text-slate-300'}`}>
                    {h}m
                  </button>
                ))}
                <input type="number" value={eyeM} onChange={(e) => setEyeM(Math.max(1, Number(e.target.value) || 1))} className="w-16 rounded border border-slate-600 bg-slate-800 px-1 py-1 text-[0.6875rem] text-slate-100" />
              </div>

              {/* 目標高度 */}
              <label className="text-[0.625rem] text-slate-400">🎯 目標高度 {targetM}m</label>
              <div className="flex flex-wrap gap-1">
                {LOOKOUT_TARGETS.map((t) => (
                  <button key={t.m} onClick={() => setTargetM(t.m)} className={`rounded border px-2 py-1 text-[0.625rem] active:scale-95 ${targetM === t.m ? 'border-lime-400 bg-lime-400/15 text-lime-300' : 'border-slate-600 text-slate-300'}`}>
                    {t.label}
                  </button>
                ))}
              </div>

              {/* 目視辨識上限 */}
              <label className="text-[0.625rem] text-slate-400">🔭 目視辨識上限 {maxKm}km（裝備/天候）</label>
              <div className="flex flex-wrap gap-1">
                {OPTIC_PRESETS.map((o) => (
                  <button key={o.km} onClick={() => setMaxKm(o.km)} className={`rounded border px-2 py-1 text-[0.625rem] active:scale-95 ${maxKm === o.km ? 'border-lime-400 bg-lime-400/15 text-lime-300' : 'border-slate-600 text-slate-300'}`}>
                    {o.label}
                  </button>
                ))}
                <input type="number" value={maxKm} onChange={(e) => setMaxKm(Math.max(1, Number(e.target.value) || 1))} className="w-16 rounded border border-slate-600 bg-slate-800 px-1 py-1 text-[0.6875rem] text-slate-100" />
              </div>

              <div className="rounded bg-slate-800/60 p-1.5 text-[0.6875rem] text-slate-200">
                預估視域 <b className="text-lime-300">{reach.toFixed(1)} km</b>
                <span className="text-slate-500">（地平線 {horiz.toFixed(1)}km／辨識 {maxKm}km 取小）</span>
              </div>

              <button onClick={add} className="rounded-lg border border-lime-400 bg-lime-400/15 py-2 text-sm font-bold text-lime-300 active:scale-95">
                ＋ 新增瞭望哨到地圖
              </button>
            </div>

            {/* 地形視域 */}
            {list.length > 0 && (
              <div className="mt-3 flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5">
                <div className="text-[0.6875rem] font-semibold text-amber-300">🏔️ 地形視域（切出死角）</div>
                <p className="text-[0.625rem] leading-relaxed text-slate-400">
                  用 90m 地形逐方位算視線遮蔽，把視域從「圓圈」切成「被岬角/山擋出的真實形狀」，
                  露出小艇可鑽的死角。需連網、依哨數約數秒。
                </p>
                <div className="flex gap-1.5">
                  <button onClick={computeTerrain} disabled={busy} className="flex-1 rounded-lg border border-amber-500/60 bg-amber-500/15 py-2 text-xs font-bold text-amber-300 active:scale-95 disabled:opacity-50">
                    {busy ? '⏳ 計算中…' : '🏔️ 計算地形視域'}
                  </button>
                  <button onClick={() => setShowTerrain(!showTerrain)} className={`rounded-lg border px-3 py-2 text-xs active:scale-95 ${showTerrain ? 'border-amber-500 bg-amber-500/15 text-amber-300' : 'border-slate-600 text-slate-300'}`}>
                    {showTerrain ? '圓圈' : '地形'}
                  </button>
                </div>
              </div>
            )}

            {/* 備份匯出/匯入（只存本機） */}
            <div className="mt-3 flex items-center gap-1.5">
              <button onClick={exportBackup} disabled={!list.length} className="flex-1 rounded-lg border border-slate-600 py-1.5 text-[0.6875rem] text-slate-300 active:scale-95 disabled:opacity-40">
                ⬇ 匯出備份
              </button>
              <button onClick={() => fileRef.current?.click()} className="flex-1 rounded-lg border border-slate-600 py-1.5 text-[0.6875rem] text-slate-300 active:scale-95">
                ⬆ 匯入備份
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) importBackup(f)
                  e.target.value = ''
                }}
              />
            </div>

            {/* 回收桶：誤刪還原 */}
            {lookoutTrash.length > 0 && (
              <div className="mt-2 flex flex-col gap-1 rounded-lg border border-slate-700 bg-slate-900/40 p-2">
                <div className="flex items-center justify-between">
                  <span className="text-[0.6875rem] font-semibold text-slate-400">🗑 回收桶（{lookoutTrash.length}）· 可還原</span>
                  <button onClick={clearLookoutTrash} className="text-[0.625rem] text-slate-500 active:scale-95">清空</button>
                </div>
                {lookoutTrash.map((l) => (
                  <div key={l.id} className="flex items-center justify-between rounded border border-slate-700/60 bg-slate-800/40 px-2 py-1">
                    <span className="truncate text-[0.625rem] text-slate-300">👁️ {l.name}（眼高{l.eyeM}m）</span>
                    <button onClick={() => restoreLookout(l.id)} className="ml-2 shrink-0 rounded border border-lime-400/60 px-2 py-0.5 text-[0.625rem] text-lime-300 active:scale-95">
                      ↩ 還原
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* 清單 */}
            {list.length > 0 && (
              <div className="mt-3 flex flex-col gap-1.5">
                <div className="text-[0.6875rem] font-semibold text-slate-400">已建瞭望哨（{list.length}）</div>
                {list.map((l) => (
                  <div key={l.id} className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900/50 px-2.5 py-2">
                    <div className="flex flex-col">
                      <span className="text-xs font-semibold text-slate-200">👁️ {l.name}</span>
                      <span className="text-[0.625rem] text-slate-400">眼高{l.eyeM}m／目標{l.targetM}m｜視域 {lookoutReachKm(l).toFixed(1)}km</span>
                    </div>
                    <button onClick={() => removeLookout(l.id)} className="text-rose-400 active:scale-95" aria-label="刪除">🗑</button>
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
