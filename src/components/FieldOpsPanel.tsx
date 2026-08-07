import { useRef, useState } from 'react'
import { useTacticalStore } from '../store/tacticalStore'
import { POI_ICONS, POI_COLORS } from '../lib/poi'
import { poiToCsv, csvToPoi } from '../lib/poiCsv'
import { geocode, type GeoResult } from '../lib/geocode'
import { elevation } from '../lib/elevation'
import { parseCoord, fmtDDM } from '../lib/coordParse'
import { saveOrShareText, saveResultMsg } from '../lib/fileShare'
import { CoordField } from './CoordField'

/**
 * 現場點位面板（🚩）：把「搜尋地址/景點 → 存成自訂點位 → 群組開關 → 海拔」
 * 合成一個面板。全部只存本機、可一鍵全部隱藏（旁邊有人時保護隱私）。
 */
export function FieldOpsPanel() {
  const groups = useTacticalStore((s) => s.poiGroups)
  const points = useTacticalStore((s) => s.poiPoints)
  const hidden = useTacticalStore((s) => s.poiHidden)
  const setPoiHidden = useTacticalStore((s) => s.setPoiHidden)
  const addPoiGroup = useTacticalStore((s) => s.addPoiGroup)
  const updatePoiGroup = useTacticalStore((s) => s.updatePoiGroup)
  const removePoiGroup = useTacticalStore((s) => s.removePoiGroup)
  const addPoiPoint = useTacticalStore((s) => s.addPoiPoint)
  const removePoiPoint = useTacticalStore((s) => s.removePoiPoint)
  const mapView = useTacticalStore((s) => s.mapView)
  const gotoCoord = useTacticalStore((s) => s.gotoCoord)
  const setStatus = useTacticalStore((s) => s.setStatus)

  const openTool = useTacticalStore((s) => s.openTool)
  const setOpenTool = useTacticalStore((s) => s.setOpenTool)
  const open = openTool === 'fieldops'
  const setOpen = (v: boolean) => setOpenTool(v ? 'fieldops' : null)

  // 搜尋
  const [q, setQ] = useState('')
  const [results, setResults] = useState<GeoResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searchErr, setSearchErr] = useState('')
  const doSearch = async () => {
    if (!q.trim()) return
    setSearching(true)
    setSearchErr('')
    try {
      const r = await geocode(q)
      setResults(r)
      if (r.length === 0) setSearchErr('找不到，換個關鍵字試試')
    } catch {
      setSearchErr('搜尋失敗（可能網路或服務忙碌，稍後再試）')
    } finally {
      setSearching(false)
    }
  }

  // 新增點位表單
  const [pGroup, setPGroup] = useState('')
  const [pLabel, setPLabel] = useState('')
  const [pLat, setPLat] = useState('')
  const [pLng, setPLng] = useState('')
  const [pElev, setPElev] = useState<number | null | undefined>(undefined)
  const [elevBusy, setElevBusy] = useState(false)
  const targetGroup = pGroup || groups[0]?.id || ''
  const useCenter = () => {
    setPLat(mapView.lat.toFixed(5))
    setPLng(mapView.lng.toFixed(5))
    setPElev(undefined)
  }
  const fillFromResult = (r: GeoResult) => {
    setPLabel(r.label.slice(0, 40))
    setPLat(r.lat.toFixed(5))
    setPLng(r.lng.toFixed(5))
    setPElev(undefined)
  }
  const parsedPt = parseCoord(`${pLat} ${pLng}`) ?? coord2(pLat, pLng)
  const checkElev = async () => {
    if (!parsedPt) return
    setElevBusy(true)
    try {
      const e = await elevation(parsedPt.lat, parsedPt.lng)
      setPElev(e)
      setStatus(e != null ? `⛰️ 海拔約 ${Math.round(e)} m` : '海拔：查無資料（多為外海）')
    } catch {
      setStatus('⚠ 海拔查詢失敗')
    } finally {
      setElevBusy(false)
    }
  }
  const savePoint = async () => {
    if (!parsedPt || !targetGroup) return
    // 未查過海拔就順手補一筆（自動附上）
    let elevM = pElev
    if (elevM === undefined) {
      try {
        elevM = await elevation(parsedPt.lat, parsedPt.lng)
      } catch {
        elevM = null
      }
    }
    addPoiPoint({ groupId: targetGroup, label: pLabel, lat: parsedPt.lat, lng: parsedPt.lng, elevM })
    setStatus(`✅ 已新增點位「${pLabel || '未命名點位'}」`)
    setPLabel('')
    setPLat('')
    setPLng('')
    setPElev(undefined)
  }

  // 新增群組表單
  const [showAddGroup, setShowAddGroup] = useState(false)
  const [gName, setGName] = useState('')
  const [gIcon, setGIcon] = useState(POI_ICONS[0])
  const [gColor, setGColor] = useState(POI_COLORS[2])
  const createGroup = () => {
    const id = addPoiGroup({ name: gName, icon: gIcon, color: gColor })
    setPGroup(id)
    setGName('')
    setShowAddGroup(false)
  }

  // 編輯群組（改名/換圖示/換色）
  const [editId, setEditId] = useState<string | null>(null)
  const [eName, setEName] = useState('')
  const [eIcon, setEIcon] = useState(POI_ICONS[0])
  const [eColor, setEColor] = useState(POI_COLORS[0])
  const startEdit = (id: string, name: string, icon: string, color: string) => {
    setEditId(id)
    setEName(name)
    setEIcon(icon)
    setEColor(color)
  }
  const saveEdit = () => {
    if (editId) updatePoiGroup(editId, { name: eName.trim() || '群組', icon: eIcon, color: eColor })
    setEditId(null)
  }

  const [expand, setExpand] = useState<string | null>(null)

  // CSV 匯入/匯出（Excel）
  const fileRef = useRef<HTMLInputElement>(null)
  const exportCsv = async () => {
    if (points.length === 0) {
      setStatus('目前沒有點位可匯出（先在下方「新增點位」存幾個點）')
      return
    }
    // iOS 不支援 <a download>，改用分享表單／退回下載／退回剪貼簿。
    const r = await saveOrShareText('阿爾戈斯-點位.csv', poiToCsv(groups, points), 'text/csv;charset=utf-8')
    setStatus(saveResultMsg(r, `${points.length} 個點位 CSV`))
  }
  const importCsv = async (file: File) => {
    try {
      const rows = csvToPoi(await file.text())
      if (!rows.length) {
        setStatus('CSV 沒有可匯入的點位（需含 緯度/經度 欄）')
        return
      }
      const nameToId = new Map(groups.map((g) => [g.name, g.id]))
      let added = 0
      for (const r of rows) {
        let gid = nameToId.get(r.group)
        if (!gid) {
          gid = addPoiGroup({
            name: r.group,
            icon: POI_ICONS[0],
            color: POI_COLORS[nameToId.size % POI_COLORS.length],
          })
          nameToId.set(r.group, gid)
        }
        addPoiPoint({ groupId: gid, label: r.label, lat: r.lat, lng: r.lng, note: r.note, elevM: r.elevM })
        added++
      }
      setStatus(`✅ 已從 CSV 匯入 ${added} 個點位`)
    } catch {
      setStatus('⚠ CSV 讀取失敗，請確認檔案格式')
    }
  }

  return (
    <>
      {open && (
        <div className="pointer-events-auto fixed inset-0 z-[2000] flex items-end justify-center bg-black/60 p-3 pt-[calc(0.75rem+env(safe-area-inset-top))] md:items-center">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-slate-700 bg-tactical-bg p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-base font-bold text-tactical-cyan">🚩 現場點位</h2>
              <button onClick={() => setOpen(false)} className="text-slate-400 active:scale-95">✕</button>
            </div>

            {/* 隱私總開關 */}
            <button
              onClick={() => setPoiHidden(!hidden)}
              className={`mb-3 flex w-full items-center justify-between rounded-lg border px-3 py-2 text-xs font-bold active:scale-95 ${
                hidden ? 'border-amber-500 bg-amber-500/15 text-amber-300' : 'border-slate-600 bg-slate-900/60 text-slate-300'
              }`}
            >
              <span>{hidden ? '🙈 目前全部隱藏中（旁人看不到）' : '👁 目前顯示中'}</span>
              <span>{hidden ? '點此顯示' : '點此一鍵隱藏'}</span>
            </button>

            {/* CSV（Excel）匯入/匯出 */}
            <div className="mb-3 flex items-center gap-2">
              <button
                onClick={exportCsv}
                className="flex-1 rounded-lg border border-tactical-green/50 bg-tactical-green/10 py-1.5 text-[0.6875rem] font-bold text-tactical-green active:scale-95"
              >
                ⬇ 匯出 CSV（Excel）
              </button>
              <button
                onClick={() => fileRef.current?.click()}
                className="flex-1 rounded-lg border border-tactical-cyan/50 bg-tactical-cyan/10 py-1.5 text-[0.6875rem] font-bold text-tactical-cyan active:scale-95"
              >
                ⬆ 匯入 CSV
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) importCsv(f)
                  e.target.value = ''
                }}
              />
            </div>

            {/* 搜尋地址/景點 */}
            <div className="mb-3 rounded-lg border border-tactical-cyan/30 bg-tactical-cyan/5 p-2">
              <div className="mb-1 text-[0.6875rem] font-semibold text-tactical-cyan">🔎 搜尋地址 / 景點 / 港口</div>
              <div className="flex items-center gap-1">
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && doSearch()}
                  spellCheck={false}
                  placeholder="例：基隆 和平島、宜蘭 烏石港"
                  className="w-0 flex-1 rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-xs text-slate-200"
                />
                <button onClick={doSearch} disabled={searching} className="shrink-0 rounded border border-tactical-cyan bg-tactical-cyan/10 px-3 py-1.5 text-xs font-bold text-tactical-cyan active:scale-95">
                  {searching ? '…' : '搜尋'}
                </button>
              </div>
              {searchErr && <p className="mt-1 text-[0.625rem] text-amber-400">{searchErr}</p>}
              {results.length > 0 && (
                <div className="mt-1 flex max-h-40 flex-col gap-0.5 overflow-y-auto">
                  {results.map((r, i) => (
                    <div key={i} className="flex items-center gap-1 rounded border border-slate-700 bg-slate-900/40 px-2 py-1">
                      <span className="flex-1 truncate text-[0.6875rem] text-slate-200" title={r.label}>{r.label}</span>
                      <button onClick={() => gotoCoord(r.lat, r.lng, 14)} className="shrink-0 rounded border border-slate-600 px-1.5 py-0.5 text-[0.625rem] text-tactical-cyan active:scale-95">跳過去</button>
                      <button onClick={() => fillFromResult(r)} className="shrink-0 rounded border border-slate-600 px-1.5 py-0.5 text-[0.625rem] text-tactical-green active:scale-95">填入↓</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 新增點位 */}
            <div className="mb-3 rounded-lg border border-tactical-green/30 bg-tactical-green/5 p-2">
              <div className="mb-1 text-[0.6875rem] font-semibold text-tactical-green">➕ 新增點位</div>
              {groups.length === 0 ? (
                <p className="text-[0.625rem] text-amber-400">請先在下方建立一個群組。</p>
              ) : (
                <>
                  <div className="flex items-center gap-1">
                    <select
                      value={targetGroup}
                      onChange={(e) => setPGroup(e.target.value)}
                      className="w-0 flex-1 rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-xs text-slate-200"
                    >
                      {groups.map((g) => (
                        <option key={g.id} value={g.id}>{g.icon} {g.name}</option>
                      ))}
                    </select>
                    <input
                      value={pLabel}
                      onChange={(e) => setPLabel(e.target.value)}
                      placeholder="名稱（例：和平島檢查據點）"
                      className="w-0 flex-[1.4] rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-xs text-slate-200"
                    />
                  </div>
                  <div className="mt-1">
                    <CoordField onParsed={(la, ln) => { setPLat(String(la)); setPLng(String(ln)) }} />
                  </div>
                  <div className="mt-1 flex items-center gap-1">
                    <input value={pLat} onChange={(e) => setPLat(e.target.value)} spellCheck={false} placeholder="緯度（可貼整串萬用座標）" className="w-0 flex-1 rounded border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-200" />
                    <input value={pLng} onChange={(e) => setPLng(e.target.value)} inputMode="decimal" placeholder="經度" className="w-0 flex-1 rounded border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-200" />
                    <button onClick={useCenter} title="用畫面中心座標" className="shrink-0 rounded border border-slate-600 px-2 py-1.5 text-[0.625rem] text-slate-300 active:scale-95">📍中心</button>
                  </div>
                  <p className="mt-0.5 text-[0.5625rem] text-slate-500">座標為<b className="text-slate-400">萬用格式</b>：十進位 24.5 122.0、度分 24°30'N 122°E、度分秒皆可（可整串貼在「緯度」欄）。</p>
                  <div className="mt-1 flex items-center gap-2">
                    <button onClick={checkElev} disabled={!parsedPt || elevBusy} className="rounded border border-slate-600 px-2 py-1 text-[0.625rem] text-slate-300 active:scale-95 disabled:opacity-40">
                      ⛰️ {elevBusy ? '查詢中…' : '查海拔'}
                    </button>
                    {pElev !== undefined && (
                      <span className="font-mono text-[0.625rem] text-amber-300">{pElev != null ? `海拔 ${Math.round(pElev)} m` : '海拔：無資料'}</span>
                    )}
                    <button onClick={savePoint} disabled={!parsedPt} className="ml-auto rounded border border-tactical-green bg-tactical-green/15 px-3 py-1 text-xs font-bold text-tactical-green active:scale-95 disabled:opacity-40">
                      儲存點位
                    </button>
                  </div>
                  {pLat && !parsedPt && <p className="mt-1 text-[0.625rem] text-tactical-alert">⚠ 座標格式錯誤</p>}
                </>
              )}
            </div>

            {/* 群組清單 */}
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[0.6875rem] font-semibold text-slate-400">📂 群組（可各別開關顯示）</span>
              <button onClick={() => setShowAddGroup(!showAddGroup)} className="text-[0.6875rem] text-tactical-cyan active:scale-95">
                {showAddGroup ? '取消' : '＋ 新增群組'}
              </button>
            </div>

            {showAddGroup && (
              <div className="mb-2 rounded-lg border border-slate-700 bg-slate-900/50 p-2">
                <input value={gName} onChange={(e) => setGName(e.target.value)} placeholder="群組名稱（例：北部分署）" className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-xs text-slate-200" />
                <div className="mt-2 text-[0.625rem] text-slate-500">圖示</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {POI_ICONS.map((ic) => (
                    <button key={ic} onClick={() => setGIcon(ic)} className={`h-7 w-7 rounded border text-base active:scale-95 ${gIcon === ic ? 'border-tactical-cyan bg-tactical-cyan/20' : 'border-slate-700'}`}>{ic}</button>
                  ))}
                </div>
                <div className="mt-2 text-[0.625rem] text-slate-500">顏色</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {POI_COLORS.map((c) => (
                    <button key={c} onClick={() => setGColor(c)} className={`h-7 w-7 rounded-full border-2 active:scale-95 ${gColor === c ? 'border-white' : 'border-slate-700'}`} style={{ background: c }} />
                  ))}
                </div>
                <button onClick={createGroup} className="mt-2 w-full rounded border border-tactical-cyan bg-tactical-cyan/15 py-1.5 text-xs font-bold text-tactical-cyan active:scale-95">
                  建立群組
                </button>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              {groups.map((g) => {
                const gp = points.filter((p) => p.groupId === g.id)
                return (
                  <div key={g.id} className="rounded-lg border border-slate-700 bg-slate-900/40 p-2">
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => updatePoiGroup(g.id, { visible: !g.visible })} title="顯示/隱藏此群組" className="text-base active:scale-95">
                        {g.visible ? '👁' : '🚫'}
                      </button>
                      <span className="text-base" style={{ filter: `drop-shadow(0 0 3px ${g.color})` }}>{g.icon}</span>
                      <span className="flex-1 truncate text-sm font-semibold text-slate-200">{g.name}</span>
                      <span className="font-mono text-[0.625rem] text-slate-500">{gp.length}</span>
                      <button onClick={() => startEdit(g.id, g.name, g.icon, g.color)} title="編輯群組" className="rounded border border-slate-600 px-1.5 py-0.5 text-[0.625rem] text-tactical-cyan active:scale-95">✏️</button>
                      <button onClick={() => setExpand(expand === g.id ? null : g.id)} className="rounded border border-slate-600 px-1.5 py-0.5 text-[0.625rem] text-slate-300 active:scale-95">
                        {expand === g.id ? '收合' : '展開'}
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`刪除群組「${g.name}」及其 ${gp.length} 個點位？`)) {
                            removePoiGroup(g.id)
                            if (pGroup === g.id) setPGroup('') // 避免新點位落到已刪群組而消失
                          }
                        }}
                        className="rounded border border-slate-700 px-1.5 py-0.5 text-[0.625rem] text-tactical-alert active:scale-95"
                      >🗑</button>
                    </div>

                    {editId === g.id && (
                      <div className="mt-2 rounded-lg border border-tactical-cyan/40 bg-slate-900/60 p-2">
                        <input value={eName} onChange={(e) => setEName(e.target.value)} placeholder="群組名稱" className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-xs text-slate-200" />
                        <div className="mt-2 text-[0.625rem] text-slate-500">圖示</div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {POI_ICONS.map((ic) => (
                            <button key={ic} onClick={() => setEIcon(ic)} className={`h-7 w-7 rounded border text-base active:scale-95 ${eIcon === ic ? 'border-tactical-cyan bg-tactical-cyan/20' : 'border-slate-700'}`}>{ic}</button>
                          ))}
                        </div>
                        <div className="mt-2 text-[0.625rem] text-slate-500">顏色</div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {POI_COLORS.map((c) => (
                            <button key={c} onClick={() => setEColor(c)} className={`h-7 w-7 rounded-full border-2 active:scale-95 ${eColor === c ? 'border-white' : 'border-slate-700'}`} style={{ background: c }} />
                          ))}
                        </div>
                        <div className="mt-2 flex gap-1">
                          <button onClick={saveEdit} className="flex-1 rounded border border-tactical-green bg-tactical-green/15 py-1.5 text-xs font-bold text-tactical-green active:scale-95">儲存變更</button>
                          <button onClick={() => setEditId(null)} className="rounded border border-slate-600 px-3 py-1.5 text-xs text-slate-300 active:scale-95">取消</button>
                        </div>
                      </div>
                    )}

                    {expand === g.id && (
                      <div className="mt-1.5 flex flex-col gap-0.5">
                        {gp.length === 0 && <p className="text-[0.625rem] text-slate-500">尚無點位。用上方「➕ 新增點位」選這個群組來加。</p>}
                        {gp.map((p) => (
                          <div key={p.id} className="flex items-center gap-1 rounded border border-slate-700 bg-slate-800/50 px-2 py-1">
                            <button onClick={() => { gotoCoord(p.lat, p.lng, 14); setOpen(false) }} className="flex-1 truncate text-left text-[0.6875rem] text-slate-200">
                              {p.label}
                              <span className="ml-1 font-mono text-[0.5625rem] text-slate-500">{fmtDDM(p.lat, p.lng)}{p.elevM != null ? ` · ⛰️${Math.round(p.elevM)}m` : ''}</span>
                            </button>
                            <button onClick={() => removePoiPoint(p.id)} className="shrink-0 text-[0.6875rem] text-tactical-alert active:scale-95">🗑</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            <p className="mt-3 text-[0.625rem] leading-relaxed text-slate-500">
              🔒 所有點位只存在這支手機，不會上傳、別人看不到；會一起含進「⚙️ 設定 → 匯出備份」。
              旁邊有人時用上方「一鍵隱藏」。
            </p>
          </div>
        </div>
      )}
    </>
  )
}

/** 兩欄十進位退回解析（parseCoord 失敗時）。 */
function coord2(latStr: string, lngStr: string): { lat: number; lng: number } | null {
  const lat = parseFloat(latStr)
  const lng = parseFloat(lngStr)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return { lat, lng }
}
