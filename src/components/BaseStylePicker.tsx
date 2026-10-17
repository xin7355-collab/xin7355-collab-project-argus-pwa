import { useTacticalStore } from '../store/tacticalStore'
import { BASE_STYLES, MAIN_STYLES, MORE_STYLES, type BaseLayerId } from '../lib/basemaps'
import { isSentinelConfigured } from '../lib/config'

/**
 * 底圖樣式選擇（地圖上的切換鈕與 🗂️ 圖層面板共用同一份）。
 *
 * 常用四種做成大卡片，像 Google Maps 的「地圖類型」；少用的影像收在下面一排。
 * 每張卡都寫「影像時效」——海上最怕把鑲嵌圖當成今天的照片。
 */
export function BaseStylePicker({ onPicked }: { onPicked?: () => void }) {
  const baseLayer = useTacticalStore((s) => s.baseLayer)
  const setBaseLayer = useTacticalStore((s) => s.setBaseLayer)
  const keyed = isSentinelConfigured()

  const pick = (id: BaseLayerId) => {
    setBaseLayer(id)
    onPicked?.()
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-4 gap-1.5">
        {MAIN_STYLES.map((id) => {
          const s = BASE_STYLES[id]
          const on = baseLayer === id
          return (
            <button
              key={id}
              onClick={() => pick(id)}
              aria-pressed={on}
              className={`flex flex-col items-center gap-1 rounded-xl border px-1 py-2.5 active:scale-95 ${
                on ? 'border-tactical-cyan bg-tactical-cyan/15' : 'border-slate-700 bg-slate-900/60'
              }`}
            >
              <span className="text-2xl leading-none">{s.icon}</span>
              <span className={`text-xs font-bold ${on ? 'text-tactical-cyan' : 'text-slate-100'}`}>{s.label}</span>
            </button>
          )
        })}
      </div>

      {/* 目前這張是什麼、多新——一律顯示，不收起來 */}
      <p className="rounded-lg bg-slate-800/60 px-2.5 py-1.5 text-[0.6875rem] leading-relaxed text-slate-300">
        <b className="text-slate-100">{BASE_STYLES[baseLayer].label}</b>：{BASE_STYLES[baseLayer].sub}
        <span className="block text-[0.625rem] text-amber-300/90">⏱ {BASE_STYLES[baseLayer].vintage}</span>
      </p>

      <div className="text-[0.625rem] font-semibold text-slate-400">更多影像</div>
      <div className="grid grid-cols-3 gap-1.5">
        {MORE_STYLES.map((id) => {
          const s = BASE_STYLES[id]
          const on = baseLayer === id
          const locked = s.needsKey && !keyed
          return (
            <button
              key={id}
              onClick={() => pick(id)}
              aria-pressed={on}
              className={`flex flex-col items-start gap-0.5 rounded-lg border px-2 py-1.5 text-left active:scale-95 ${
                on ? 'border-tactical-cyan bg-tactical-cyan/15' : 'border-slate-700 bg-slate-900/60'
              } ${locked ? 'opacity-60' : ''}`}
            >
              <span className={`text-[0.6875rem] font-bold ${on ? 'text-tactical-cyan' : 'text-slate-100'}`}>
                {s.icon} {s.label}
              </span>
              <span className="text-[0.5625rem] leading-tight text-slate-400">{locked ? '🔒 需 Sentinel 金鑰' : s.sub}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
