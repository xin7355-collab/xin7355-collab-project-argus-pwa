import { useRef } from 'react'
import { useTacticalStore } from '../store/tacticalStore'

const MODE_LABEL: Record<string, string> = {
  basic: 'MAP',
  orbit: 'PASS',
  sar: 'SAR',
  optical: 'OPTICAL',
  ais: 'AIS',
  rescue: 'RESCUE',
  seastate: 'SEA',
  envanim: 'ANIM',
  typhoon: 'TYPHOON',
}

/** 頂部狀態列：模式指示 + 即時訊息（給海上人員的單行回饋）。 */
export function StatusBar() {
  const mode = useTacticalStore((s) => s.mode)
  const statusMessage = useTacticalStore((s) => s.statusMessage)
  const secureHasLock = useTacticalStore((s) => s.secureHasLock)
  const secureUnlocked = useTacticalStore((s) => s.secureUnlocked)
  const setSecureUnlocked = useTacticalStore((s) => s.setSecureUnlocked)
  const setSecurePromptOpen = useTacticalStore((s) => s.setSecurePromptOpen)
  const taps = useRef<{ n: number; t: number }>({ n: 0, t: 0 })

  // 不明顯手勢：版本號連點 5 下（2 秒內）→ 已鎖：叫出解鎖視窗；已解鎖：立即鎖回。
  const onVersionTap = () => {
    if (!secureHasLock) return
    const now = Date.now()
    taps.current = now - taps.current.t < 2000 ? { n: taps.current.n + 1, t: now } : { n: 1, t: now }
    if (taps.current.n >= 5) {
      taps.current = { n: 0, t: 0 }
      if (secureUnlocked) setSecureUnlocked(false)
      else setSecurePromptOpen(true)
    }
  }

  return (
    // 右側留空避開浮動按鈕；兩行結構讓長訊息換到第二行不會被擠出畫面。
    <div className="safe-top pointer-events-none absolute inset-x-0 top-0 z-[1000] flex flex-col gap-0.5 bg-gradient-to-b from-slate-900/95 to-transparent px-4 py-2 pr-16">
      <div className="flex min-w-0 items-center gap-2">
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-tactical-green opacity-60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-tactical-green" />
        </span>
        <span className="shrink-0 font-mono text-xs font-bold tracking-widest text-tactical-green">
          阿爾戈斯 · {MODE_LABEL[mode]}
        </span>
        <span
          onClick={onVersionTap}
          className={`pointer-events-auto shrink-0 cursor-default select-none font-mono text-[0.5625rem] ${
            secureUnlocked ? 'text-tactical-cyan' : 'text-slate-500'
          }`}
        >
          v2.36{secureUnlocked ? ' 🔓' : ''}
        </span>
      </div>
      <span className="min-w-0 truncate font-mono text-[0.6875rem] text-slate-300">{statusMessage}</span>
    </div>
  )
}
