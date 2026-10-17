import { useRef } from 'react'
import { useTacticalStore } from '../store/tacticalStore'

/**
 * 建置時間縮寫成 MMDD-HHmm（本機時區）。
 * 版本號本身改版才會動，但每次部署這一段都會變——使用者要確認
 * 「手機上到底有沒有拿到新版」，看這個最快。
 */
const buildStamp = (() => {
  const d = new Date(__BUILD_TIME__)
  if (Number.isNaN(d.valueOf())) return '?'
  const p2 = (n: number) => String(n).padStart(2, '0')
  return `${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`
})()

/**
 * 版本號。同時是機敏鎖的隱藏解鎖手勢：2 秒內連點 5 下。
 *
 * 改版前它在頂端狀態列；狀態列換成搜尋列之後搬到功能清單最下面。
 * 手勢本身沒變，只是位置變了——設定頁的說明文字一併改了。
 */
export function VersionTag() {
  const secureHasLock = useTacticalStore((s) => s.secureHasLock)
  const secureUnlocked = useTacticalStore((s) => s.secureUnlocked)
  const setSecureUnlocked = useTacticalStore((s) => s.setSecureUnlocked)
  const setSecurePromptOpen = useTacticalStore((s) => s.setSecurePromptOpen)
  const taps = useRef<{ n: number; t: number }>({ n: 0, t: 0 })

  const onTap = () => {
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
    <span
      onClick={onTap}
      className={`cursor-default select-none font-mono text-[0.625rem] ${secureUnlocked ? 'text-tactical-cyan' : 'text-slate-500'}`}
    >
      阿爾戈斯 v{__APP_VERSION__}·{buildStamp}
      {secureUnlocked ? ' 🔓' : ''}
    </span>
  )
}
