import { useState } from 'react'
import { useTacticalStore } from '../store/tacticalStore'
import { verifySecurePin } from '../lib/secure'

/**
 * 機敏功能解鎖視窗：由不明顯手勢（狀態列版本號連點 5 下）觸發。
 * 輸入正確 PIN → 本階段解鎖機敏功能（雷達等）；重開自動鎖回。
 */
export function SecureUnlock() {
  const open = useTacticalStore((s) => s.securePromptOpen)
  const setOpen = useTacticalStore((s) => s.setSecurePromptOpen)
  const setUnlocked = useTacticalStore((s) => s.setSecureUnlocked)
  const [pin, setPin] = useState('')
  const [err, setErr] = useState(false)

  if (!open) return null

  const submit = async () => {
    if (await verifySecurePin(pin)) {
      setUnlocked(true)
      setOpen(false)
      setPin('')
      setErr(false)
    } else {
      setErr(true)
      setPin('')
    }
  }

  return (
    <div className="pointer-events-auto fixed inset-0 z-[3000] flex items-center justify-center bg-black/80 p-6">
      <div className="w-full max-w-xs rounded-xl border border-slate-700 bg-tactical-bg p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-bold text-tactical-cyan">🔒 機敏功能</h2>
          <button
            onClick={() => {
              setOpen(false)
              setPin('')
              setErr(false)
            }}
            className="text-slate-400 active:scale-95"
          >
            ✕
          </button>
        </div>
        <input
          type="password"
          inputMode="numeric"
          autoFocus
          value={pin}
          onChange={(e) => {
            setPin(e.target.value)
            setErr(false)
          }}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="輸入 PIN"
          className={`w-full rounded border bg-slate-800 px-3 py-2 text-center text-lg tracking-widest text-slate-100 ${
            err ? 'border-rose-500' : 'border-slate-600'
          }`}
        />
        {err && <p className="mt-1 text-center text-[0.6875rem] text-rose-400">PIN 錯誤</p>}
        <button
          onClick={submit}
          className="mt-3 w-full rounded-lg border border-tactical-cyan bg-tactical-cyan/15 py-2 text-sm font-bold text-tactical-cyan active:scale-95"
        >
          解鎖
        </button>
        <p className="mt-2 text-center text-[0.5625rem] text-slate-500">重開 App 會自動鎖回</p>
      </div>
    </div>
  )
}
