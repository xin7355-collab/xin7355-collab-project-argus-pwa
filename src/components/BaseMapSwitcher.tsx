import { useState } from 'react'
import { useTacticalStore } from '../store/tacticalStore'
import { BASE_STYLES } from '../lib/basemaps'
import { BaseStylePicker } from './BaseStylePicker'

/**
 * 地圖右下角的底圖切換鈕（像 Google Maps 的「圖層」鈕）。
 *
 * 舊版要 🧰 → 圖層 → 往下找底圖，三層才換得到，所以大部分人一直停在
 * 預設那張「放大就空」的暗色圖，覺得地圖很弱。現在一按就出四張大卡。
 */
export function BaseMapSwitcher() {
  const baseLayer = useTacticalStore((s) => s.baseLayer)
  const setOpenTool = useTacticalStore((s) => s.setOpenTool)
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="follow-sheet hide-when-sheet-tall pointer-events-auto absolute z-[1100] flex h-12 w-12 flex-col items-center justify-center rounded-2xl border border-slate-600/80 bg-tactical-bg/95 shadow-lg active:scale-95"
        style={{ right: 'calc(0.75rem + env(safe-area-inset-right))', bottom: 'calc(var(--sheet-h) + 5.25rem)' }}
        aria-label={`切換底圖（目前：${BASE_STYLES[baseLayer].label}）`}
      >
        <span className="text-lg leading-none">{BASE_STYLES[baseLayer].icon}</span>
        <span className="mt-0.5 text-[0.5625rem] font-bold text-slate-300">{BASE_STYLES[baseLayer].label}</span>
      </button>

      {open && (
        <div
          className="pointer-events-auto fixed inset-0 z-[2000] flex items-end justify-center bg-black/50 p-3 md:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-700 bg-tactical-bg p-4 pad-safe-bottom"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-100">地圖類型</h2>
              <button onClick={() => setOpen(false)} className="px-1 text-slate-400 active:scale-95" aria-label="關閉">
                ✕
              </button>
            </div>
            <BaseStylePicker onPicked={() => setOpen(false)} />
            <button
              onClick={() => {
                setOpen(false)
                setOpenTool('layers')
              }}
              className="mt-3 w-full rounded-xl border border-slate-600 py-2.5 text-sm text-slate-200 active:scale-95"
            >
              🗂️ 疊加圖層（界線、航道、風場、自訂點位…）
            </button>
          </div>
        </div>
      )}
    </>
  )
}
