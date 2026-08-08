import { useEffect, useRef, useState } from 'react'
import { useTacticalStore } from '../store/tacticalStore'
import {
  coverage,
  band,
  linkStatus,
  linkColor,
  fmtDist,
  RADIO_DEFAULTS,
  PROP_MODES,
  DEVICE_PRESETS,
  repeaterColor,
  exportRepeatersJson,
  parseRepeatersJson,
  windFarmsOnPath,
  type Repeater,
} from '../lib/radio'
import { terrainCoverage } from '../lib/terrain'
import { elevation } from '../lib/elevation'
import { antennaTopM } from '../lib/radio'
import { WIND_FARMS } from '../lib/maritimeRef'
import { saveOrShareText, saveResultMsg } from '../lib/fileShare'
import { CoordField } from './CoordField'

/** 常見天線高快捷（m）。 */
const ANT_PRESETS = [10, 30, 50, 100, 300]
/** 常見收訊端高快捷。 */
const RX_PRESETS = [
  { m: 1.5, label: '手持 1.5m' },
  { m: 2.5, label: '車機 2.5m' },
  { m: 10, label: '固定台 10m' },
]

/**
 * 數字輸入框：可「完整清空」再輸入（不會硬留一個數字）。
 * 內部用字串草稿：空白/只有負號小數點時暫不套用；可解析成有限數才即時更新預覽；
 * 失焦時才夾到 [min,max]、空白則回退 fallback。外部值改變（套預設/載入編輯）會同步。
 */
function NumField({
  value,
  onCommit,
  fallback,
  min,
  max,
  step,
  className,
}: {
  value: number
  onCommit: (n: number) => void
  fallback: number
  min?: number
  max?: number
  step?: string
  className?: string
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => {
    // 只在外部值真的變了才覆蓋草稿（值相等代表是自己剛送出的，別打斷輸入/小數點）
    if (Number(draft) !== value) setDraft(String(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft}
      step={step}
      onChange={(e) => {
        const s = e.target.value
        setDraft(s)
        if (s.trim() === '') return // 允許清空，狀態暫不變
        const n = Number(s)
        if (Number.isFinite(n)) onCommit(n) // 即時更新預覽（先不夾 min，輸入才順）
      }}
      onBlur={() => {
        const s = draft.trim()
        let n = s === '' ? NaN : Number(s)
        if (!Number.isFinite(n)) n = fallback
        if (min != null) n = Math.max(min, n)
        if (max != null) n = Math.min(max, n)
        onCommit(n)
        setDraft(String(n))
      }}
      className={className}
    />
  )
}

/**
 * 無線電中繼台覆蓋面板（📻，私密）：輸入座標/天線高/頻率/瓦數，
 * 畫半透明覆蓋圈。位置可手動輸入座標、用畫面中心或 GPS。資料只存本機。
 */
export function RadioPanel() {
  const list = useTacticalStore((s) => s.repeaters)
  const addRepeater = useTacticalStore((s) => s.addRepeater)
  const updateRepeater = useTacticalStore((s) => s.updateRepeater)
  const removeRepeater = useTacticalStore((s) => s.removeRepeater)
  const editingId = useTacticalStore((s) => s.radioEditingId)
  const setEditingId = useTacticalStore((s) => s.setRadioEditingId)
  const radioTrash = useTacticalStore((s) => s.radioTrash)
  const restoreRepeater = useTacticalStore((s) => s.restoreRepeater)
  const clearRadioTrash = useTacticalStore((s) => s.clearRadioTrash)
  const importRepeaters = useTacticalStore((s) => s.importRepeaters)
  const mapView = useTacticalStore((s) => s.mapView)
  const ownPosition = useTacticalStore((s) => s.ownPosition)
  const radioProbe = useTacticalStore((s) => s.radioProbe)
  const setRadioProbe = useTacticalStore((s) => s.setRadioProbe)
  const radioEdit = useTacticalStore((s) => s.radioEdit)
  const setRadioEdit = useTacticalStore((s) => s.setRadioEdit)
  const showGap = useTacticalStore((s) => s.showRadioGap)
  const setShowGap = useTacticalStore((s) => s.setShowRadioGap)
  const showTerrain = useTacticalStore((s) => s.showTerrain)
  const setShowTerrain = useTacticalStore((s) => s.setShowTerrain)
  const terrainRings = useTacticalStore((s) => s.terrainRings)
  const radioGapTerrain = useTacticalStore((s) => s.radioGapTerrain)
  const terrainBusy = useTacticalStore((s) => s.terrainBusy)
  const setTerrainBusy = useTacticalStore((s) => s.setTerrainBusy)
  const setTerrainRing = useTacticalStore((s) => s.setTerrainRing)
  const setStatus = useTacticalStore((s) => s.setStatus)
  const openTool = useTacticalStore((s) => s.openTool)
  const setOpenTool = useTacticalStore((s) => s.setOpenTool)
  const open = openTool === 'radio'
  const setOpen = (v: boolean) => setOpenTool(v ? 'radio' : null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  // 匯出：分享／下載 JSON 備份（不上傳；iOS 用分享表單）
  const exportBackup = async () => {
    if (!list.length) return
    const r = await saveOrShareText(
      `argus-repeaters-${new Date().toISOString().slice(0, 10)}.json`,
      exportRepeatersJson(list),
      'application/json',
    )
    setStatus(saveResultMsg(r, `${list.length} 座中繼台備份`))
  }

  // 匯入：讀本機 JSON 檔，追加到現有清單
  const importBackup = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const parsed = parseRepeatersJson(String(reader.result || ''))
      if (!parsed || !parsed.length) {
        alert('匯入失敗：檔案格式不符或沒有中繼台資料')
        return
      }
      importRepeaters(parsed)
      setStatus(`已匯入 ${parsed.length} 座中繼台`)
    }
    reader.readAsText(file)
  }

  // 現場單位定位輸入
  const [uName, setUName] = useState('')
  const [uPos, setUPos] = useState<'coord' | 'center' | 'gps'>('coord')
  const [uLat, setULat] = useState('')
  const [uLng, setULng] = useState('')

  const [name, setName] = useState('')
  const [pos, setPos] = useState<'coord' | 'center' | 'gps'>('coord')
  const [latStr, setLatStr] = useState('')
  const [lngStr, setLngStr] = useState('')
  const [antennaM, setAntennaM] = useState(50)
  const [freqMHz, setFreqMHz] = useState(145)
  const [powerW, setPowerW] = useState(25)
  const [rxM, setRxM] = useState(RADIO_DEFAULTS.rxM)
  const [kFactor, setKFactor] = useState(RADIO_DEFAULTS.kFactor)
  const [adv, setAdv] = useState(false)
  const [txGainDbi, setTxGainDbi] = useState(RADIO_DEFAULTS.txGainDbi)
  const [rxSensDbm, setRxSensDbm] = useState(RADIO_DEFAULTS.rxSensDbm)
  const [pathExp, setPathExp] = useState(RADIO_DEFAULTS.pathExp)
  const [mobilePowerW, setMobilePowerW] = useState(RADIO_DEFAULTS.mobilePowerW)
  const [mobileGainDbi, setMobileGainDbi] = useState(RADIO_DEFAULTS.mobileGainDbi)
  const [deviceId, setDeviceId] = useState('') // 目前選的裝置預設（highlight 用）
  // 站點地面高程（由座標自動查 DEM）：天線頂＝地面高程＋天線高，山頂站自動大範圍。
  const [siteElev, setSiteElev] = useState<number | null>(null)
  const [siteElevBusy, setSiteElevBusy] = useState(false)

  // 一鍵套用裝置預設：不懂數值的使用者選類型就好
  const applyDevice = (p: (typeof DEVICE_PRESETS)[number]) => {
    setDeviceId(p.id)
    setAntennaM(p.antennaM)
    setPowerW(p.powerW)
    setFreqMHz(p.freqMHz)
    setTxGainDbi(p.txGainDbi)
    setPathExp(p.pathExp)
  }

  // 點地圖記號或清單✏️→帶入該站資料到表單編輯
  useEffect(() => {
    if (!editingId) return
    const r = list.find((x) => x.id === editingId)
    if (!r) return
    setName(r.name)
    setPos('coord')
    setLatStr(String(r.lat))
    setLngStr(String(r.lng))
    setAntennaM(r.antennaM)
    setFreqMHz(r.freqMHz)
    setPowerW(r.powerW)
    setRxM(r.rxM)
    setKFactor(r.kFactor)
    setTxGainDbi(r.txGainDbi)
    setRxSensDbm(r.rxSensDbm)
    setPathExp(r.pathExp)
    setMobilePowerW(r.mobilePowerW ?? RADIO_DEFAULTS.mobilePowerW)
    setMobileGainDbi(r.mobileGainDbi ?? RADIO_DEFAULTS.mobileGainDbi)
    setSiteElev(r.siteElevM ?? null)
    setDeviceId('')
    setOpen(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId])

  const resetForm = () => {
    setName('')
    setLatStr('')
    setLngStr('')
    setDeviceId('')
    setSiteElev(null)
    setEditingId(null)
  }

  const resolvePos = (): { lat: number; lng: number } | null => {
    if (pos === 'gps') return ownPosition ? { lat: ownPosition.lat, lng: ownPosition.lng } : null
    if (pos === 'center') return { lat: mapView.lat, lng: mapView.lng }
    const la = parseFloat(latStr)
    const ln = parseFloat(lngStr)
    if (!Number.isFinite(la) || !Number.isFinite(ln)) return null
    return { lat: la, lng: ln }
  }

  // 座標一旦可解析 → 自動查該點地面高程（DEM），供「天線頂＝地面＋天線高」即時預覽。
  const posLat = pos === 'gps' ? ownPosition?.lat : pos === 'center' ? mapView.lat : parseFloat(latStr)
  const posLng = pos === 'gps' ? ownPosition?.lng : pos === 'center' ? mapView.lng : parseFloat(lngStr)
  useEffect(() => {
    if (!open) return
    const la = Number(posLat)
    const ln = Number(posLng)
    if (!Number.isFinite(la) || !Number.isFinite(ln)) {
      setSiteElev(null)
      return
    }
    let cancelled = false
    setSiteElevBusy(true)
    const t = setTimeout(async () => {
      try {
        const e = await elevation(la, ln)
        if (!cancelled) setSiteElev(Number.isFinite(e as number) ? (e as number) : null)
      } catch {
        if (!cancelled) setSiteElev(null)
      } finally {
        if (!cancelled) setSiteElevBusy(false)
      }
    }, 450)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, posLat, posLng])

  const preview: Repeater = {
    id: '', name, lat: 0, lng: 0, antennaM, freqMHz, powerW, rxM, txGainDbi, rxSensDbm, pathExp, kFactor,
    mobilePowerW, mobileGainDbi, siteElevM: siteElev ?? undefined,
  }
  const cov = coverage(preview)
  const b = band(freqMHz)
  const antTop = antennaTopM(siteElev ?? 0, antennaM)

  const add = async () => {
    const p = resolvePos()
    if (!p) {
      alert(pos === 'gps' ? '尚無 GPS 定位' : '請輸入有效的緯度、經度')
      return
    }
    // 站點地面高程：優先用預覽已查到的；沒有就現查一次（查不到則不帶，退回天線高）。
    let elev = siteElev
    if (elev == null) {
      setStatus('查詢站點地面高程中…')
      try {
        const e = await elevation(p.lat, p.lng)
        elev = Number.isFinite(e as number) ? (e as number) : null
      } catch {
        elev = null
      }
    }
    const data = {
      name: name.trim() || `中繼台 ${list.length + 1}`,
      lat: p.lat,
      lng: p.lng,
      antennaM,
      freqMHz,
      powerW,
      rxM,
      txGainDbi,
      rxSensDbm,
      pathExp,
      kFactor,
      mobilePowerW,
      mobileGainDbi,
      siteElevM: elev ?? undefined,
    }
    if (editingId) {
      updateRepeater(editingId, data) // 編輯：更新既有站台
      setStatus(`已更新「${data.name}」（站點海拔 ${elev != null ? Math.round(elev) + 'm' : '未取得'}）`)
    } else {
      addRepeater(data)
      setStatus(`已新增「${data.name}」（站點海拔 ${elev != null ? Math.round(elev) + 'm' : '未取得'}）`)
    }
    resetForm()
    setOpen(false)
  }

  const setProbe = () => {
    let p: { lat: number; lng: number } | null = null
    if (uPos === 'gps') p = ownPosition ? { lat: ownPosition.lat, lng: ownPosition.lng } : null
    else if (uPos === 'center') p = { lat: mapView.lat, lng: mapView.lng }
    else {
      const la = parseFloat(uLat)
      const ln = parseFloat(uLng)
      if (Number.isFinite(la) && Number.isFinite(ln)) p = { lat: la, lng: ln }
    }
    if (!p) {
      alert(uPos === 'gps' ? '尚無 GPS 定位' : '請輸入有效的緯度、經度')
      return
    }
    setRadioProbe({ lat: p.lat, lng: p.lng, label: uName.trim() || '現場單位' })
  }

  // 算地形：傳 id 只算單站（點站台看它的真實覆蓋），不傳算全部。
  // 逐站各自 try/catch → 部分失敗也保留已成功的（不再一station失敗就全毀）；
  // 站與站之間留 300ms 間隔，降低對免費高程 API 的瞬間請求密度（避免限流失敗）。
  const computeTerrain = async (onlyId?: string) => {
    const targets = onlyId ? list.filter((r) => r.id === onlyId) : list
    if (!targets.length || terrainBusy) return
    setTerrainBusy(true)
    setStatus(onlyId ? '地形遮蔽：查詢此站高程中…' : '地形遮蔽：查詢高程中…（依台數需數秒）')
    let ok = 0
    const failed: string[] = []
    for (let i = 0; i < targets.length; i++) {
      const r = targets[i]
      if (i > 0) await new Promise((res) => setTimeout(res, 300))
      // 每站最多試 2 次（限流多為短暫）
      let done = false
      for (let attempt = 0; attempt < 2 && !done; attempt++) {
        if (attempt > 0) await new Promise((res) => setTimeout(res, 800))
        try {
          const ring = await terrainCoverage({
            lat: r.lat,
            lng: r.lng,
            antennaM: r.antennaM,
            targetM: r.rxM,
            maxKm: coverage(r).km,
            kFactor: r.kFactor,
          })
          if (ring.length >= 3) {
            setTerrainRing(r.id, ring)
            ok++
          }
          done = true
        } catch {
          if (attempt >= 1) failed.push(r.name)
        }
      }
      setStatus(`地形遮蔽：已完成 ${ok}/${targets.length} 站…`)
    }
    setTerrainBusy(false)
    if (ok > 0) {
      setShowTerrain(true)
      setStatus(
        failed.length
          ? `⚠ 地形遮蔽：${ok} 站完成，${failed.length} 站失敗（${failed.join('、')}）；失敗站維持圓圈，可再按一次補算`
          : '地形遮蔽覆蓋：已依 90m 地形切出真實覆蓋形狀（含山後死角）',
      )
    } else {
      setStatus('⚠ 地形高程取得失敗（需連網／稍後再試）；維持圓圈估算')
      alert('地形高程取得失敗，可能是網路或高程服務暫時限流。稍等幾秒再按一次「計算地形遮蔽覆蓋」即可，通常就會成功。')
    }
  }

  return (
    <>
      {open && (
        <div className="pointer-events-auto fixed inset-0 z-[2000] flex items-end justify-center bg-black/60 p-3 pt-[calc(0.75rem+env(safe-area-inset-top))] md:items-center">
          <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl border border-slate-700 bg-tactical-bg p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-base font-bold text-tactical-cyan">📻 無線電中繼台覆蓋</h2>
              <button onClick={() => { setEditingId(null); setOpen(false) }} className="text-slate-400 active:scale-95">✕</button>
            </div>
            <p className="mb-3 text-[0.625rem] leading-relaxed text-slate-400">
              輸入中繼台資料，畫出<b>半透明覆蓋圈</b>（視距＋功率取小）。資料只存你手機、不上傳。
            </p>

            {editingId && (
              <div className="mb-2 flex items-center justify-between rounded-lg border border-amber-400/50 bg-amber-400/10 px-2.5 py-1.5">
                <span className="text-xs font-semibold text-amber-300">✏️ 編輯中：{name || '此中繼台'}</span>
                <button
                  onClick={() => computeTerrain(editingId)}
                  disabled={terrainBusy}
                  className="rounded border border-amber-500/60 bg-amber-500/15 px-2 py-1 text-[0.625rem] font-bold text-amber-300 active:scale-95 disabled:opacity-50"
                >
                  {terrainBusy ? '⏳' : '🏔️ 算此站地形'}
                </button>
              </div>
            )}

            <div className="flex flex-col gap-2 rounded-lg border border-slate-700 bg-slate-900/40 p-2.5">
              {/* 裝置類型快速預設（不確定就選這個，數值自動填好） */}
              <div className="rounded-lg border border-tactical-cyan/40 bg-tactical-cyan/5 p-2">
                <div className="mb-1.5 text-[0.6875rem] font-semibold text-tactical-cyan">🎚️ 快速預設（不確定就選這個）</div>
                <div className="grid grid-cols-4 gap-1.5">
                  {DEVICE_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => applyDevice(p)}
                      className={`flex flex-col items-center gap-0.5 rounded-lg border px-1 py-2 active:scale-95 ${
                        deviceId === p.id
                          ? 'border-tactical-cyan bg-tactical-cyan/15 text-tactical-cyan'
                          : 'border-slate-600 bg-slate-900/50 text-slate-300'
                      }`}
                    >
                      <span className="text-lg leading-none">{p.icon}</span>
                      <span className="text-[0.625rem] font-semibold">{p.label}</span>
                      <span className="text-[0.5625rem] leading-tight text-slate-400">{p.desc}</span>
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[0.5625rem] leading-tight text-slate-500">
                  選完只要填台名＋位置就能新增；下面數值可再手動微調。專業使用者可略過、直接填。
                </p>
              </div>

              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="台名（例：大武山中繼台）"
                className="rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-slate-100"
              />

              {/* 位置來源 */}
              <div className="grid grid-cols-3 gap-1">
                {([['coord', '手動座標'], ['center', '畫面中心'], ['gps', '我的 GPS']] as const).map(([id, label]) => (
                  <button
                    key={id}
                    onClick={() => setPos(id)}
                    className={`rounded border px-1 py-1 text-[0.625rem] font-semibold active:scale-95 ${
                      pos === id ? 'border-tactical-cyan bg-tactical-cyan/15 text-tactical-cyan' : 'border-slate-600 text-slate-300'
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
                    <input
                      value={latStr}
                      onChange={(e) => setLatStr(e.target.value)}
                      inputMode="decimal"
                      placeholder="緯度 例 22.63"
                      className="rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-slate-100"
                    />
                    <input
                      value={lngStr}
                      onChange={(e) => setLngStr(e.target.value)}
                      inputMode="decimal"
                      placeholder="經度 例 120.65"
                      className="rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-slate-100"
                    />
                  </div>
                </div>
              )}
              {pos === 'center' && (
                <span className="text-[0.625rem] text-slate-400">用畫面中心 {mapView.lat.toFixed(4)}, {mapView.lng.toFixed(4)}</span>
              )}

              {/* 天線高（＝鐵塔/天線離地高，不必填海拔；站點海拔會自動加） */}
              <label className="text-[0.625rem] text-slate-400">📡 發射天線高（鐵塔離地高）{antennaM}m</label>
              <div className="flex flex-wrap gap-1">
                {ANT_PRESETS.map((h) => (
                  <button
                    key={h}
                    onClick={() => setAntennaM(h)}
                    className={`rounded border px-2 py-1 text-[0.625rem] active:scale-95 ${antennaM === h ? 'border-tactical-cyan bg-tactical-cyan/15 text-tactical-cyan' : 'border-slate-600 text-slate-300'}`}
                  >
                    {h}m
                  </button>
                ))}
                <NumField
                  value={antennaM}
                  onCommit={setAntennaM}
                  fallback={30}
                  min={1}
                  className="w-16 rounded border border-slate-600 bg-slate-800 px-1 py-1 text-[0.6875rem] text-slate-100"
                />
              </div>
              {/* 站點地面高程（自動查）→ 天線頂海拔＝地面＋天線高。使用者不必手填海拔。 */}
              <div className="rounded border border-tactical-cyan/30 bg-tactical-cyan/5 px-2 py-1 text-[0.5625rem] leading-relaxed text-slate-300">
                {siteElevBusy ? (
                  <span className="text-slate-400">⛰️ 查詢站點地面高程中…</span>
                ) : siteElev != null ? (
                  <span>
                    ⛰️ 站點地面海拔 <b className="text-tactical-cyan">{Math.round(siteElev)}m</b>（座標自動查）＋ 天線 {antennaM}m ＝ 天線頂 <b className="text-tactical-green">{Math.round(antTop)}m</b>。山頂站自動有大範圍，你只要填鐵塔高。
                  </span>
                ) : (
                  <span className="text-slate-400">⛰️ 填座標後自動查站點海拔並加進天線頂高（查不到則只用天線高）。</span>
                )}
              </div>

              {/* 頻率 + 功率 */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[0.625rem] text-slate-400">📶 頻率 (MHz)</label>
                  <NumField
                    value={freqMHz}
                    onCommit={setFreqMHz}
                    fallback={145}
                    min={1}
                    className="w-full rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-slate-100"
                  />
                  <span className="text-[0.5625rem] text-slate-500">{b.name}</span>
                </div>
                <div>
                  <label className="text-[0.625rem] text-slate-400">⚡ 功率 (W)</label>
                  <NumField
                    value={powerW}
                    onCommit={setPowerW}
                    fallback={25}
                    min={0.1}
                    className="w-full rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-slate-100"
                  />
                </div>
              </div>

              {/* 收訊端高 */}
              <label className="text-[0.625rem] text-slate-400">📱 收訊端天線高 {rxM}m</label>
              <div className="flex flex-wrap gap-1">
                {RX_PRESETS.map((t) => (
                  <button
                    key={t.m}
                    onClick={() => setRxM(t.m)}
                    className={`rounded border px-2 py-1 text-[0.625rem] active:scale-95 ${rxM === t.m ? 'border-tactical-cyan bg-tactical-cyan/15 text-tactical-cyan' : 'border-slate-600 text-slate-300'}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {/* 傳播條件（日夜/波導 → 地球曲度 k）*/}
              <label className="text-[0.625rem] text-slate-400">🌐 傳播條件（日夜/大氣折射）</label>
              <div className="grid grid-cols-3 gap-1">
                {PROP_MODES.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setKFactor(m.k)}
                    className={`rounded border px-1 py-1 text-[0.625rem] font-semibold active:scale-95 ${
                      Math.abs(kFactor - m.k) < 0.01 ? 'border-tactical-cyan bg-tactical-cyan/15 text-tactical-cyan' : 'border-slate-600 text-slate-300'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <span className="text-[0.5625rem] text-slate-500">夜間海面逆溫→超折射→發話距離較遠(k={kFactor.toFixed(2)})</span>

              {/* 進階 */}
              <button onClick={() => setAdv(!adv)} className="text-left text-[0.625rem] text-tactical-cyan">
                {adv ? '▾' : '▸'} 進階（站台增益/靈敏度/地形 · 手持上行功率）
              </button>
              {adv && (
                <div className="flex flex-col gap-1.5 rounded bg-slate-800/40 p-1.5">
                  <div className="grid grid-cols-3 gap-1.5">
                    <label className="text-[0.5625rem] text-slate-400">站台增益 dBi
                      <NumField value={txGainDbi} onCommit={setTxGainDbi} fallback={0} className="w-full rounded border border-slate-600 bg-slate-800 px-1 py-1 text-[0.6875rem] text-slate-100" />
                    </label>
                    <label className="text-[0.5625rem] text-slate-400">手持靈敏度 dBm
                      <NumField value={rxSensDbm} onCommit={setRxSensDbm} fallback={-112} max={0} className="w-full rounded border border-slate-600 bg-slate-800 px-1 py-1 text-[0.6875rem] text-slate-100" />
                    </label>
                    <label className="text-[0.5625rem] text-slate-400">地形 n
                      <NumField value={pathExp} onCommit={setPathExp} fallback={3} min={2} step="0.1" className="w-full rounded border border-slate-600 bg-slate-800 px-1 py-1 text-[0.6875rem] text-slate-100" />
                    </label>
                  </div>
                  {/* 上行（手持→站台）：解「打不回」的關鍵參數 */}
                  <div className="text-[0.5625rem] font-semibold text-amber-300/80">📱 沿岸手持上行（打回站台）</div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <label className="text-[0.5625rem] text-slate-400">手持功率 W（手持5/車機25）
                      <NumField value={mobilePowerW} onCommit={setMobilePowerW} fallback={5} min={0.1} className="w-full rounded border border-slate-600 bg-slate-800 px-1 py-1 text-[0.6875rem] text-slate-100" />
                    </label>
                    <label className="text-[0.5625rem] text-slate-400">手持增益 dBi（橡皮天線~0）
                      <NumField value={mobileGainDbi} onCommit={setMobileGainDbi} fallback={0} className="w-full rounded border border-slate-600 bg-slate-800 px-1 py-1 text-[0.6875rem] text-slate-100" />
                    </label>
                  </div>
                </div>
              )}

              {/* 即時預估 */}
              <div className="rounded bg-slate-800/60 p-1.5 text-[0.6875rem] text-slate-200">
                預估覆蓋 <b style={{ color: b.color }}>{cov.km.toFixed(1)} km</b>
                <span className="text-slate-500">（{cov.limit === 'los' ? '視距限制' : '功率限制'}：視距 {cov.losKm.toFixed(1)}km / 功率 {cov.powerKm.toFixed(0)}km）</span>
              </div>

              <div className="flex gap-1.5">
                <button onClick={add} className="flex-1 rounded-lg border border-tactical-cyan bg-tactical-cyan/15 py-2 text-sm font-bold text-tactical-cyan active:scale-95">
                  {editingId ? '💾 儲存修改' : '＋ 新增覆蓋圈到地圖'}
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

            {/* 地形遮蔽覆蓋 */}
            {list.length > 0 && (
              <div className="mt-3 flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5">
                <div className="text-[0.6875rem] font-semibold text-amber-300">🏔️ 地形遮蔽覆蓋（真實形狀）</div>
                <p className="text-[0.625rem] leading-relaxed text-slate-400">
                  用 90m 地形高程逐方位算視線遮蔽，把覆蓋從「圓圈」切成「被山擋出的真實形狀」。
                  數位電台在山後＝直接斷訊，此形狀更準。需連網、依台數約數秒。
                </p>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => computeTerrain()}
                    disabled={terrainBusy}
                    className="flex-1 rounded-lg border border-amber-500/60 bg-amber-500/15 py-2 text-xs font-bold text-amber-300 active:scale-95 disabled:opacity-50"
                  >
                    {terrainBusy ? '⏳ 計算中…' : '🏔️ 計算地形遮蔽覆蓋'}
                  </button>
                  <button
                    onClick={() => setShowTerrain(!showTerrain)}
                    className={`rounded-lg border px-3 py-2 text-xs active:scale-95 ${showTerrain ? 'border-amber-500 bg-amber-500/15 text-amber-300' : 'border-slate-600 text-slate-300'}`}
                  >
                    {showTerrain ? '圓圈' : '地形'}
                  </button>
                </div>
              </div>
            )}

            {/* 現場單位定位 / 測距 / 數位鏈路研判 */}
            {list.length > 0 && (
              <div className="mt-3 flex flex-col gap-2 rounded-lg border border-tactical-green/40 bg-tactical-green/5 p-2.5">
                <div className="text-[0.6875rem] font-semibold text-tactical-green">📍 現場單位定位（測距＋數位鏈路研判）</div>
                <p className="text-[0.625rem] leading-relaxed text-slate-400">
                  輸入數位電台回傳的座標 → 畫各站台到它的連線＋距離（浬/km/m），並研判能否穩定回傳。
                </p>
                <input
                  value={uName}
                  onChange={(e) => setUName(e.target.value)}
                  placeholder="單位名（例：巡邏艇3號）"
                  className="rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-slate-100"
                />
                <div className="grid grid-cols-3 gap-1">
                  {([['coord', '座標'], ['center', '畫面中心'], ['gps', '我的 GPS']] as const).map(([id, label]) => (
                    <button
                      key={id}
                      onClick={() => setUPos(id)}
                      className={`rounded border px-1 py-1 text-[0.625rem] font-semibold active:scale-95 ${
                        uPos === id ? 'border-tactical-green bg-tactical-green/15 text-tactical-green' : 'border-slate-600 text-slate-300'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {uPos === 'coord' && (
                  <div className="flex flex-col gap-1.5">
                    <CoordField onParsed={(la, ln) => { setULat(String(la)); setULng(String(ln)) }} />
                    <div className="grid grid-cols-2 gap-1.5">
                      <input value={uLat} onChange={(e) => setULat(e.target.value)} inputMode="decimal" placeholder="緯度" className="rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-slate-100" />
                      <input value={uLng} onChange={(e) => setULng(e.target.value)} inputMode="decimal" placeholder="經度" className="rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-slate-100" />
                    </div>
                  </div>
                )}
                <div className="flex gap-1.5">
                  <button onClick={setProbe} className="flex-1 rounded-lg border border-tactical-green bg-tactical-green/15 py-2 text-xs font-bold text-tactical-green active:scale-95">
                    📍 定位並測距
                  </button>
                  {radioProbe && (
                    <button onClick={() => setRadioProbe(null)} className="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-300 active:scale-95">
                      清除
                    </button>
                  )}
                </div>

                {/* 各站台鏈路研判（依餘裕排序） */}
                {radioProbe && (
                  <div className="flex flex-col gap-1">
                    <div className="text-[0.625rem] font-semibold text-slate-400">{radioProbe.label}：各台鏈路（強→弱）</div>
                    {list
                      .map((r) => ({
                        r,
                        ls: linkStatus(r, radioProbe.lat, radioProbe.lng),
                        wf: windFarmsOnPath(r.lat, r.lng, radioProbe.lat, radioProbe.lng, WIND_FARMS),
                      }))
                      .sort((a, b) => b.ls.marginDb - a.ls.marginDb)
                      .map(({ r, ls, wf }) => (
                        <div key={r.id} className="rounded border border-slate-700 bg-slate-900/50 px-2 py-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[0.6875rem] font-semibold text-slate-200">📻 {r.name}</span>
                            <span className="text-[0.625rem]" style={{ color: linkColor(ls.level) }}>{ls.text}</span>
                          </div>
                          <div className="text-[0.5625rem] text-slate-400">
                            距 {fmtDist(ls.distM)}｜方位 {ls.bearing.toFixed(0)}°
                          </div>
                          <div className="text-[0.5625rem]">
                            <span className={ls.downMarginDb > 0 ? 'text-tactical-green' : 'text-rose-400'}>下行 {ls.downMarginDb.toFixed(0)}dB</span>
                            <span className="text-slate-600"> ／ </span>
                            <span className={ls.upMarginDb > 0 ? 'text-tactical-green' : 'text-rose-400'}>上行 {ls.upMarginDb.toFixed(0)}dB</span>
                            {ls.limiting === 'up' && <span className="text-amber-400"> · 卡在上行</span>}
                          </div>
                          {wf.length > 0 && (
                            <div className="mt-0.5 text-[0.5625rem] text-amber-400">🌀 路徑穿越離岸風電場：{wf.join('、')}（多重路徑衰落/遮蔽，訊號可能忽強忽弱）</div>
                          )}
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}

            {/* 備份匯出/匯入（只存本機） */}
            <div className="mt-3 flex items-center gap-1.5">
              <button
                onClick={exportBackup}
                disabled={!list.length}
                className="flex-1 rounded-lg border border-slate-600 py-1.5 text-[0.6875rem] text-slate-300 active:scale-95 disabled:opacity-40"
              >
                ⬇ 匯出備份
              </button>
              <button
                onClick={() => fileRef.current?.click()}
                className="flex-1 rounded-lg border border-slate-600 py-1.5 text-[0.6875rem] text-slate-300 active:scale-95"
              >
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
            {radioTrash.length > 0 && (
              <div className="mt-2 flex flex-col gap-1 rounded-lg border border-slate-700 bg-slate-900/40 p-2">
                <div className="flex items-center justify-between">
                  <span className="text-[0.6875rem] font-semibold text-slate-400">🗑 回收桶（{radioTrash.length}）· 可還原</span>
                  <button onClick={clearRadioTrash} className="text-[0.625rem] text-slate-500 active:scale-95">清空</button>
                </div>
                {radioTrash.map((r) => (
                  <div key={r.id} className="flex items-center justify-between rounded border border-slate-700/60 bg-slate-800/40 px-2 py-1">
                    <span className="truncate text-[0.625rem] text-slate-300">📻 {r.name}（{r.freqMHz}MHz/{r.powerW}W）</span>
                    <button
                      onClick={() => restoreRepeater(r.id)}
                      className="ml-2 shrink-0 rounded border border-tactical-green/60 px-2 py-0.5 text-[0.625rem] text-tactical-green active:scale-95"
                    >
                      ↩ 還原
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* 清單 */}
            {list.length > 0 && (
              <div className="mt-3 flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-1.5">
                  <div className="text-[0.6875rem] font-semibold text-slate-400">已建中繼台（{list.length}）</div>
                  <div className="flex items-center gap-1.5">
                    {list.length > 1 && (
                      <button
                        onClick={() => setShowGap(!showGap)}
                        className={`rounded border px-2 py-1 text-[0.625rem] active:scale-95 ${
                          showGap ? 'border-rose-400 bg-rose-400/15 text-rose-300' : 'border-slate-600 text-slate-300'
                        }`}
                        title="多台覆蓋聯集後仍收不到的海域反白"
                      >
                        📡 死角
                      </button>
                    )}
                    <button
                      onClick={() => setRadioEdit(!radioEdit)}
                      className={`rounded border px-2 py-1 text-[0.625rem] active:scale-95 ${
                        radioEdit ? 'border-amber-400 bg-amber-400/15 text-amber-300' : 'border-slate-600 text-slate-300'
                      }`}
                      title="開啟後可在地圖上拖曳中繼台記號微調位置"
                    >
                      {radioEdit ? '✋ 拖曳中·完成' : '✋ 拖曳微調'}
                    </button>
                  </div>
                </div>
                {showGap && (
                  <div className="flex flex-col gap-1 rounded border border-rose-400/40 bg-rose-400/5 px-2 py-1.5 text-[0.5625rem] text-rose-200">
                    <span>🔴 紅色網格＝所有中繼台<b>聯集後仍收不到</b>的死角，站與站之間的縫一目了然。</span>
                    {radioGapTerrain ? (
                      <span className="text-emerald-300">
                        ✅ <b>已含地形遮蔽</b>：連「涵蓋圈半徑內、但被山擋住」的山後死角也一起標出來了（90m 地形視線）。
                      </span>
                    ) : (
                      <>
                        <span className="text-amber-300">
                          ⚠ 目前<b>只用視距圓估算</b>，山後的死角<b>沒算進來</b>（所以你只看到最外圍那圈）。實地會有的山後盲區要先算地形：
                        </span>
                        <button
                          onClick={async () => {
                            setShowTerrain(true)
                            await computeTerrain()
                          }}
                          disabled={terrainBusy}
                          className="mt-0.5 rounded border border-amber-500/60 bg-amber-500/15 py-1.5 text-[0.625rem] font-bold text-amber-200 active:scale-95 disabled:opacity-50"
                        >
                          {terrainBusy ? '⏳ 計算地形中…' : '🏔️ 一鍵：算地形＋標出山後死角'}
                        </button>
                        {Object.keys(terrainRings).length > 0 && !showTerrain && (
                          <span>（已算過地形，按上方切到「地形」即可套用）</span>
                        )}
                      </>
                    )}
                  </div>
                )}
                {radioEdit && (
                  <p className="rounded border border-amber-400/40 bg-amber-400/5 px-2 py-1 text-[0.5625rem] text-amber-200">
                    地圖上的 📻 記號現在可<b>拖曳微調位置</b>，放開即存檔。微調完請按「完成」關閉，避免誤觸移位。
                  </p>
                )}
                {list.map((r) => {
                  const c = coverage(r)
                  return (
                    <div
                      key={r.id}
                      className={`flex items-center justify-between rounded-lg border px-2.5 py-2 ${
                        r.off ? 'border-slate-700/60 bg-slate-900/30 opacity-60' : 'border-slate-700 bg-slate-900/50'
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        {/* 顏色圓點：對應地圖上該站的覆蓋圈顏色（關閉時轉灰） */}
                        <span
                          className="h-3 w-3 shrink-0 rounded-full"
                          style={{ backgroundColor: r.off ? '#64748b' : repeaterColor(r.id) }}
                        />
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate text-xs font-semibold text-slate-200">
                            📻 {r.name}{r.off && <span className="ml-1 text-[0.5625rem] text-slate-500">（已關閉）</span>}
                          </span>
                          <span className="text-[0.625rem] text-slate-400">{r.freqMHz}MHz/{r.powerW}W/天線{r.antennaM}m｜覆蓋 {c.km.toFixed(1)}km</span>
                        </div>
                      </div>
                      <div className="ml-2 flex shrink-0 items-center gap-2">
                        {/* 個別開關：關閉＝地圖不畫此站涵蓋、不納入死角，但保留設定 */}
                        <button
                          onClick={() => updateRepeater(r.id, { off: !r.off })}
                          className={`rounded border px-1.5 py-0.5 text-[0.5625rem] font-bold active:scale-95 ${
                            r.off
                              ? 'border-slate-600 bg-slate-800 text-slate-400'
                              : 'border-tactical-green/60 bg-tactical-green/10 text-tactical-green'
                          }`}
                          aria-label={r.off ? '開啟' : '關閉'}
                        >
                          {r.off ? '關' : '開'}
                        </button>
                        <button onClick={() => setEditingId(r.id)} className="text-tactical-cyan active:scale-95" aria-label="編輯">✏️</button>
                        <button onClick={() => removeRepeater(r.id)} className="text-rose-400 active:scale-95" aria-label="刪除">🗑</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
