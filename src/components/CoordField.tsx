import { useState } from 'react'
import { parseCoord } from '../lib/coordParse'

/**
 * 萬用座標輸入（共用）：一個框吃任何格式（十進位／度分／度分秒／含半球字母），
 * 解析成功即回填十進位到父層的緯/經欄位。放在手動座標兩欄之上，貼上就自動換算。
 */
export function CoordField({ onParsed }: { onParsed: (lat: number, lng: number) => void }) {
  const [t, setT] = useState('')
  const parsed = parseCoord(t)
  return (
    <div className="flex flex-col gap-0.5">
      <input
        value={t}
        onChange={(e) => {
          setT(e.target.value)
          const p = parseCoord(e.target.value)
          if (p) onParsed(p.lat, p.lng)
        }}
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
        placeholder="萬用座標：貼任何格式 24.5 122 · 24°30.5'N 122°E"
        className="rounded border border-tactical-cyan/40 bg-slate-800 px-2 py-1.5 text-sm text-slate-100"
      />
      {t && !parsed && (
        <span className="text-[0.5625rem] text-rose-400">⚠ 無法判讀（試十進位／度分／度分秒）</span>
      )}
      {parsed && (
        <span className="text-[0.5625rem] text-tactical-green">✓ 已換算並填入 {parsed.lat.toFixed(5)}, {parsed.lng.toFixed(5)}</span>
      )}
    </div>
  )
}
