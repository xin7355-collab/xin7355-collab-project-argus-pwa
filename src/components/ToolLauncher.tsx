import { useState } from 'react'
import { useTacticalStore } from '../store/tacticalStore'

/** 工具總表項目。 */
interface Tool {
  id: string
  icon: string
  label: string
  sub: string
}

const TOOLS: Tool[] = [
  { id: 'layers', icon: '🗂️', label: '圖層', sub: '底圖 / 界線 / 風場' },
  { id: 'coord', icon: '📌', label: '座標', sub: '輸入 / 最愛 / 釘選' },
  { id: 'measure', icon: '📐', label: '量測距離', sub: '點地圖量距離/方位' },
  { id: 'rings', icon: '◎', label: '距離圈', sub: '1/3/5/12/24 浬同心圓' },
  { id: 'intercept', icon: '🎯', label: '攔截計算', sub: '該操航向 / 攔截時間' },
  { id: 'dr', icon: '🧭', label: '推算船位', sub: '未來 / 回推船位' },
  { id: 'fieldops', icon: '🔎', label: '搜尋 / 現場點位', sub: '地址·地名·電線桿定位 / 自訂據點' },
  { id: 'nightops', icon: '🌙', label: '夜勤光照', sub: '月相 / 日出沒' },
  { id: 'radio', icon: '📻', label: '無線電覆蓋', sub: '中繼台 / 死角 / 測距' },
  { id: 'lookout', icon: '👁️', label: '瞭望哨視域', sub: '目視範圍 / 死角' },
  { id: 'radar', icon: '📡', label: '雷達涵蓋', sub: '沿岸 / 離岸風電雷達' },
  { id: 'offline', icon: '⬇', label: '離線地圖', sub: '下載此區圖磚' },
]

/**
 * 工具總表（🧰）：把原本散落在畫面右緣的十多顆浮動鈕，收成一個乾淨的
 * 分頁式面板。點格子即開對應工具。簡單、專業、手機不塞爆。
 */
export function ToolLauncher() {
  const setOpenTool = useTacticalStore((s) => s.setOpenTool)
  const toggleMeasure = useTacticalStore((s) => s.toggleMeasure)
  const measuring = useTacticalStore((s) => s.measuring)
  const rangeCenter = useTacticalStore((s) => s.rangeCenter)
  const setRangeCenter = useTacticalStore((s) => s.setRangeCenter)
  const ownPosition = useTacticalStore((s) => s.ownPosition)
  const mapView = useTacticalStore((s) => s.mapView)
  const radarLocked = useTacticalStore((s) => s.secureHasLock && !s.secureUnlocked)
  const repeaters = useTacticalStore((s) => s.repeaters)
  const lookouts = useTacticalStore((s) => s.lookouts)
  const radarSites = useTacticalStore((s) => s.radarSites)
  const poiPoints = useTacticalStore((s) => s.poiPoints)
  const [open, setOpen] = useState(false)

  // 各工具的資料筆數徽章（一眼看出哪些已在用）
  const badge: Record<string, number> = {
    radio: repeaters.length,
    lookout: lookouts.length,
    radar: radarLocked ? 0 : radarSites.length,
    fieldops: poiPoints.length,
  }

  // 機敏鎖住時，雷達整格不出現（縱深防禦：外人看不到有此功能）
  const tools = TOOLS.filter((t) => !(t.id === 'radar' && radarLocked))

  const pick = (id: string) => {
    setOpen(false)
    // 量測是「開關」不是面板：直接切換點圖量測模式
    if (id === 'measure') {
      if (!measuring) toggleMeasure()
      return
    }
    // 距離圈：以我的 GPS（否則畫面中心）為圓心；已開啟則關閉
    if (id === 'rings') {
      setRangeCenter(rangeCenter ? null : (ownPosition ?? { lat: mapView.lat, lng: mapView.lng }))
      return
    }
    setOpenTool(id)
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="safe-float-top2 pointer-events-auto absolute z-[1100] flex h-11 w-11 items-center justify-center rounded-full border border-slate-600 bg-tactical-panel/90 text-lg active:scale-95"
        aria-label="工具總表"
        title="工具總表"
      >
        🧰
      </button>

      {open && (
        <div
          className="pointer-events-auto fixed inset-0 z-[2000] flex items-end justify-center bg-black/60 p-3 pt-[calc(0.75rem+env(safe-area-inset-top))] md:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-slate-700 bg-tactical-bg p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-bold text-tactical-cyan">🧰 工具</h2>
              <button onClick={() => setOpen(false)} className="text-slate-400 active:scale-95">✕</button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {tools.map((t) => (
                <button
                  key={t.id}
                  onClick={() => pick(t.id)}
                  className="relative flex flex-col items-center gap-1 rounded-lg border border-slate-700 bg-slate-900/50 px-1.5 py-3 text-center active:scale-95 active:border-tactical-cyan"
                >
                  {badge[t.id] > 0 && (
                    <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-tactical-cyan px-1 text-[0.5625rem] font-bold text-slate-900">
                      {badge[t.id]}
                    </span>
                  )}
                  <span className="text-2xl leading-none">{t.icon}</span>
                  <span className="text-[0.6875rem] font-semibold text-slate-100">{t.label}</span>
                  <span className="text-[0.5625rem] leading-tight text-slate-400">{t.sub}</span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-[0.625rem] leading-relaxed text-slate-500">
              ⚙️ 設定與 📍 我的位置 在畫面右上角常駐。機敏功能（雷達）上鎖時不會出現在此。
            </p>
          </div>
        </div>
      )}
    </>
  )
}
