import { useState } from 'react'
import { useTacticalStore } from '../store/tacticalStore'
import { parseCoord, fmtDecimal, fmtDDM, fmtDMS } from '../lib/coordParse'
import { shareReport, buildSitrep } from '../lib/report'
import { openGmaps } from '../lib/geocode'
import type { SavedCoord } from '../lib/savedCoords'

/**
 * 座標管理器：萬用座標輸入（自動判讀多格式）＋ 跳過去 ＋ 釘選/最愛，
 * 以及最愛/已釘選/最近用過三份清單。跨模式持久（localStorage）。
 */
export function CoordManager() {
  const openTool = useTacticalStore((s) => s.openTool)
  const setOpenTool = useTacticalStore((s) => s.setOpenTool)
  const open = openTool === 'coord'
  const setOpen = (v: boolean) => setOpenTool(v ? 'coord' : null)
  const [text, setText] = useState('')
  const saved = useTacticalStore((s) => s.savedCoords)
  const history = useTacticalStore((s) => s.coordHistory)
  const gotoCoord = useTacticalStore((s) => s.gotoCoord)
  const addSavedCoord = useTacticalStore((s) => s.addSavedCoord)
  const updateSavedCoord = useTacticalStore((s) => s.updateSavedCoord)
  const removeSavedCoord = useTacticalStore((s) => s.removeSavedCoord)
  const clearHistory = useTacticalStore((s) => s.clearHistory)
  const setMode = useTacticalStore((s) => s.setMode)
  const setManOverboard = useTacticalStore((s) => s.setManOverboard)
  const setStatus = useTacticalStore((s) => s.setStatus)
  const ownPosition = useTacticalStore((s) => s.ownPosition)

  const parsed = parseCoord(text)

  // 一鍵位置回報：整理成標準通報字串（時間＋度分＋十進位＋我方相對方位），分享/複製給隊友。
  const sitrep = async (lat: number, lng: number) => {
    const how = await shareReport(buildSitrep({ lat, lng, own: ownPosition }))
    setStatus(how === 'shared' ? '位置回報已分享' : how === 'copied' ? '位置回報已複製，可貼給隊友' : '⚠ 分享失敗')
  }

  const go = (lat: number, lng: number) => {
    gotoCoord(lat, lng, 12)
    setStatus(`已跳到 ${lat.toFixed(4)}, ${lng.toFixed(4)}`)
  }
  // 設為搜救落海點：切到搜救模式並標記（setMode 會清空，故其後再標）
  const asRescue = (lat: number, lng: number) => {
    setMode('rescue')
    setManOverboard({ lat, lng })
    gotoCoord(lat, lng, 11)
    setOpen(false)
    setStatus('已設為搜救落海點，開始漂流推演')
  }
  // 匯出/分享已存座標（純文字，可貼進通訊軟體給隊友）
  const exportCoords = async () => {
    if (saved.length === 0) {
      setStatus('尚無已存座標可匯出')
      return
    }
    const lines = ['【阿爾戈斯 座標清單】']
    for (const c of saved) {
      const tags = `${c.pinned ? '📌' : ''}${c.favorite ? '★' : ''}`
      lines.push(`${tags}${c.label}｜${fmtDecimal(c.lat, c.lng)}｜${fmtDDM(c.lat, c.lng)}`)
    }
    const how = await shareReport(lines.join('\n'))
    setStatus(how === 'shared' ? '座標清單已分享' : how === 'copied' ? '座標清單已複製到剪貼簿' : '⚠ 分享失敗')
  }
  const add = (pinned: boolean, favorite: boolean) => {
    if (!parsed) return
    addSavedCoord({ lat: parsed.lat, lng: parsed.lng, pinned, favorite })
    setStatus(pinned ? '已釘選座標（切頁面不會消失）' : '已加入最愛座標')
  }

  const favorites = saved.filter((c) => c.favorite)
  const pinned = saved.filter((c) => c.pinned)

  return (
    <>
      {open && (
        <div className="pointer-events-auto fixed inset-0 z-[2000] flex items-end justify-center bg-black/60 p-3 pt-[calc(0.75rem+env(safe-area-inset-top))] md:items-center">
          <div className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-xl border border-slate-700 bg-tactical-bg p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-bold text-tactical-cyan">📌 座標管理</h2>
              <div className="flex items-center gap-3">
                {saved.length > 0 && (
                  <button onClick={exportCoords} className="text-[0.6875rem] text-tactical-green active:scale-95">
                    📤 匯出/分享
                  </button>
                )}
                <button onClick={() => setOpen(false)} className="text-slate-400 active:scale-95">
                  ✕
                </button>
              </div>
            </div>

            {/* 萬用輸入 */}
            <label className="block text-xs font-semibold text-tactical-green">
              萬用座標（貼任何格式都會自動換算）
            </label>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              autoCapitalize="none"
              placeholder="24.5 122.0 · 24°30.5'N 122°E · 24 30 00N 122 00 00E"
              className="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-2 font-mono text-sm text-slate-200"
            />
            {text && !parsed && (
              <p className="mt-1 text-[0.6875rem] text-tactical-alert">⚠ 無法判讀，換個寫法試試（十進位/度分/度分秒皆可）</p>
            )}
            {parsed && (
              <div className="mt-2 rounded-lg border border-slate-700 bg-slate-900/50 p-2">
                <div className="grid grid-cols-[auto,1fr] gap-x-2 gap-y-0.5 font-mono text-[0.6875rem] text-slate-300">
                  <span className="text-slate-500">十進位</span>
                  <span>{fmtDecimal(parsed.lat, parsed.lng)}</span>
                  <span className="text-slate-500">度分</span>
                  <span>{fmtDDM(parsed.lat, parsed.lng)}</span>
                  <span className="text-slate-500">度分秒</span>
                  <span>{fmtDMS(parsed.lat, parsed.lng)}</span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-1">
                  <button
                    onClick={() => go(parsed.lat, parsed.lng)}
                    className="rounded border border-tactical-cyan bg-tactical-cyan/15 py-1.5 text-xs font-bold text-tactical-cyan active:scale-95"
                  >
                    跳過去
                  </button>
                  <button
                    onClick={() => asRescue(parsed.lat, parsed.lng)}
                    className="rounded border border-tactical-alert/60 bg-tactical-alert/10 py-1.5 text-xs font-bold text-tactical-alert active:scale-95"
                  >
                    🆘 設為搜救點
                  </button>
                  <button
                    onClick={() => add(true, false)}
                    className="rounded border border-pink-500/60 bg-pink-500/10 py-1.5 text-xs font-bold text-pink-300 active:scale-95"
                  >
                    📌 釘選
                  </button>
                  <button
                    onClick={() => add(false, true)}
                    className="rounded border border-amber-500/60 bg-amber-500/10 py-1.5 text-xs font-bold text-amber-300 active:scale-95"
                  >
                    ★ 加最愛
                  </button>
                </div>
                <div className="mt-1 grid grid-cols-2 gap-1">
                  <button
                    onClick={() => openGmaps(parsed.lat, parsed.lng)}
                    className="rounded border border-sky-500/60 bg-sky-500/10 py-1.5 text-xs font-bold text-sky-300 active:scale-95"
                  >
                    🗺️ Google Maps
                  </button>
                  <button
                    onClick={() => openGmaps(parsed.lat, parsed.lng, true)}
                    className="rounded border border-sky-500/60 bg-sky-500/10 py-1.5 text-xs font-bold text-sky-300 active:scale-95"
                  >
                    🧭 導航過去
                  </button>
                </div>
                <button
                  onClick={() => sitrep(parsed.lat, parsed.lng)}
                  className="mt-1 w-full rounded border border-tactical-green/60 bg-tactical-green/10 py-1.5 text-xs font-bold text-tactical-green active:scale-95"
                >
                  📋 位置回報（產生通報字串給隊友）
                </button>
              </div>
            )}

            {/* 已釘選 */}
            <Section title={`📌 已釘選（${pinned.length}）`} empty={pinned.length === 0} emptyText="釘選的點會長駐地圖，切頁面不會消失。">
              {pinned.map((c) => (
                <CoordRow
                  key={c.id}
                  c={c}
                  onGo={() => go(c.lat, c.lng)}
                  onAsRescue={() => asRescue(c.lat, c.lng)}
                  onRename={(label) => updateSavedCoord(c.id, { label })}
                  onTogglePin={() => updateSavedCoord(c.id, { pinned: !c.pinned })}
                  onToggleFav={() => updateSavedCoord(c.id, { favorite: !c.favorite })}
                  onRemove={() => removeSavedCoord(c.id)}
                />
              ))}
            </Section>

            {/* 最愛 */}
            <Section title={`★ 最愛（${favorites.length}）`} empty={favorites.length === 0} emptyText="尚無最愛座標。">
              {favorites.map((c) => (
                <CoordRow
                  key={c.id}
                  c={c}
                  onGo={() => go(c.lat, c.lng)}
                  onAsRescue={() => asRescue(c.lat, c.lng)}
                  onRename={(label) => updateSavedCoord(c.id, { label })}
                  onTogglePin={() => updateSavedCoord(c.id, { pinned: !c.pinned })}
                  onToggleFav={() => updateSavedCoord(c.id, { favorite: !c.favorite })}
                  onRemove={() => removeSavedCoord(c.id)}
                />
              ))}
            </Section>

            {/* 歷史 */}
            <Section
              title={`🕘 最近用過（${history.length}）`}
              empty={history.length === 0}
              emptyText="用過的座標會自動記在這。"
              action={history.length ? { label: '清除', onClick: clearHistory } : undefined}
            >
              {history.map((h, i) => (
                <div key={i} className="flex items-center gap-1 py-0.5">
                  <button
                    onClick={() => go(h.lat, h.lng)}
                    className="flex-1 rounded px-2 py-1 text-left font-mono text-[0.6875rem] text-slate-300 hover:bg-slate-800 active:scale-95"
                  >
                    {h.lat.toFixed(4)}, {h.lng.toFixed(4)}
                  </button>
                  <button
                    onClick={() => addSavedCoord({ lat: h.lat, lng: h.lng, favorite: true })}
                    className="shrink-0 rounded px-1.5 py-1 text-amber-400 active:scale-95"
                    title="加最愛"
                  >
                    ★
                  </button>
                  <button
                    onClick={() => addSavedCoord({ lat: h.lat, lng: h.lng, pinned: true })}
                    className="shrink-0 rounded px-1.5 py-1 text-pink-300 active:scale-95"
                    title="釘選"
                  >
                    📌
                  </button>
                </div>
              ))}
            </Section>
          </div>
        </div>
      )}
    </>
  )
}

function Section({
  title,
  empty,
  emptyText,
  action,
  children,
}: {
  title: string
  empty: boolean
  emptyText: string
  action?: { label: string; onClick: () => void }
  children?: React.ReactNode
}) {
  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-300">{title}</span>
        {action && (
          <button onClick={action.onClick} className="text-[0.625rem] text-slate-500 underline active:scale-95">
            {action.label}
          </button>
        )}
      </div>
      {empty ? <p className="text-[0.625rem] text-slate-500">{emptyText}</p> : <div>{children}</div>}
    </div>
  )
}

function CoordRow({
  c,
  onGo,
  onAsRescue,
  onRename,
  onTogglePin,
  onToggleFav,
  onRemove,
}: {
  c: SavedCoord
  onGo: () => void
  onAsRescue: () => void
  onRename: (label: string) => void
  onTogglePin: () => void
  onToggleFav: () => void
  onRemove: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(c.label)
  return (
    <div className="mb-1 rounded-lg border border-slate-700 bg-slate-900/50 p-1.5">
      <div className="flex items-center gap-1">
        {editing ? (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              onRename(name)
              setEditing(false)
            }}
            autoFocus
            className="w-0 flex-1 rounded border border-slate-600 bg-slate-900 px-1.5 py-1 text-xs text-slate-200"
          />
        ) : (
          <button onClick={onGo} className="flex w-0 flex-1 flex-col text-left active:scale-95">
            <span className="truncate text-xs font-semibold text-slate-200">{c.label}</span>
            <span className="font-mono text-[0.625rem] text-slate-500">
              {c.lat.toFixed(4)}, {c.lng.toFixed(4)}
            </span>
          </button>
        )}
        <button onClick={() => openGmaps(c.lat, c.lng)} className="shrink-0 px-1 py-1 text-sky-300 active:scale-95" title="用 Google Maps 開啟">
          🗺️
        </button>
        <button onClick={onAsRescue} className="shrink-0 px-1 py-1 text-tactical-alert active:scale-95" title="設為搜救點">
          🆘
        </button>
        <button onClick={() => setEditing(!editing)} className="shrink-0 px-1 py-1 text-slate-400 active:scale-95" title="改名">
          ✎
        </button>
        <button onClick={onToggleFav} className={`shrink-0 px-1 py-1 active:scale-95 ${c.favorite ? 'text-amber-400' : 'text-slate-600'}`} title="最愛">
          ★
        </button>
        <button onClick={onTogglePin} className={`shrink-0 px-1 py-1 active:scale-95 ${c.pinned ? 'text-pink-400' : 'text-slate-600'}`} title="釘選">
          📌
        </button>
        <button onClick={onRemove} className="shrink-0 px-1 py-1 text-slate-500 active:scale-95" title="刪除">
          🗑
        </button>
      </div>
    </div>
  )
}
