import { useEffect, useState } from 'react'
import { useTacticalStore } from '../store/tacticalStore'

/**
 * 狀態訊息提示。
 *
 * 舊版是頂端一條常駐的狀態列：訊息一長就被截成「…」，而且永遠佔著位置。
 * 改成在抽屜上方浮出、幾秒後自己收起；點一下立刻收起。
 * 重要且要一直看到的狀態（例如「AIS 船位已過期」）不走這裡，由 MapInfoBar 常駐顯示。
 */
export function Toast() {
  const msg = useTacticalStore((s) => s.statusMessage)
  const [shown, setShown] = useState('')

  useEffect(() => {
    if (!msg) return
    setShown(msg)
    // 字越多停越久：大約每秒讀 15 個字，最少 3.5 秒、最多 9 秒
    const ms = Math.max(3500, Math.min(9000, 1500 + msg.length * 65))
    const t = setTimeout(() => setShown(''), ms)
    return () => clearTimeout(t)
  }, [msg])

  if (!shown) return null
  const warn = /^⚠|失敗|錯誤|連不上/.test(shown)

  return (
    <button
      onClick={() => setShown('')}
      className={`pointer-events-auto max-w-full rounded-xl border px-3 py-2 text-left text-xs leading-relaxed shadow-lg backdrop-blur ${
        warn ? 'border-amber-500/60 bg-slate-900/95 text-amber-200' : 'border-slate-600 bg-slate-900/95 text-slate-200'
      }`}
      aria-live="polite"
    >
      {shown}
    </button>
  )
}
