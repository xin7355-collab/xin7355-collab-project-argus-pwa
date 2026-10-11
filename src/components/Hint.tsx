import { useState, type ReactNode } from 'react'

// ── 可收合的說明區塊 ──────────────────────────────────────
//
// 專案守則本來就寫「說明收進 <details>」，但全 App 只有兩處照做，
// 結果光學面板的內容高度 1259px、視窗只有 414px——要捲三個螢幕才摸得到控制項。
//
// 這裡的取捨：誠實的警語不能藏起來，但也不該把操作擠到畫面外。
// 做法是「重點一行永遠看得到，細節收一層」：
//   標題本身就帶結論（例如「快照非即時 · 上限10m · 雲會擋」），
//   展開才看完整說明。使用者的展開／收合會記住，下次不用再關一次。

const KEY = 'argus.hint.'

function load(id: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(KEY + id)
    return v === null ? fallback : v === '1'
  } catch {
    return fallback
  }
}

function persist(id: string, open: boolean) {
  try {
    localStorage.setItem(KEY + id, open ? '1' : '0')
  } catch {
    /* 無痕模式或儲存空間滿了：記不住就算了，不影響功能 */
  }
}

export function Hint({
  id,
  title,
  gist,
  tone = 'warn',
  defaultOpen = false,
  children,
}: {
  /** 記住展開狀態用的鍵，每個說明區塊要唯一。 */
  id: string
  title: string
  /** 收起來時仍然看得到的一行結論。誠實警語請放這裡，不要只放在內文。 */
  gist?: string
  /**
   * warn＝琥珀色，用在「必須讓人看到」的誠實警語。
   * plain＝中性色，用在「次要的控制項群組」（例如查舊案、外部連結）——
   * 這些不是警語，不該長得像警告，但同樣不該把主要操作擠到畫面外。
   */
  tone?: 'warn' | 'plain'
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(() => load(id, defaultOpen))
  const toggle = () => {
    const next = !open
    setOpen(next)
    persist(id, next)
  }

  const warn = tone === 'warn'
  const box = warn
    ? 'border-amber-500/40 bg-amber-500/5 text-amber-200/90'
    : 'border-slate-700 bg-slate-900/40 text-slate-400'
  const head = warn ? 'text-amber-300' : 'text-slate-200'
  const sub = warn ? 'text-amber-200/70' : 'text-slate-500'

  return (
    <div className={`rounded-lg border p-2 text-[0.625rem] leading-relaxed ${box}`}>
      <button
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-start gap-1.5 text-left active:scale-[0.99]"
      >
        <span className={`shrink-0 pt-px ${head}`}>{open ? '▾' : '▸'}</span>
        <span className="min-w-0 flex-1">
          <span className={`block font-semibold ${head}`}>{title}</span>
          {gist && !open && <span className={`mt-0.5 block ${sub}`}>{gist}</span>}
        </span>
      </button>
      {open && <div className="mt-1.5 flex flex-col gap-1 pl-4">{children}</div>}
    </div>
  )
}
