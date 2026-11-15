import { useEffect, useRef, useState } from 'react'
import { useTacticalStore } from '../store/tacticalStore'
import { getConfig } from '../lib/config'
import { askAssistant, AssistantError, toSpeech, type AgentStep, type AssistantErrorKind } from '../lib/assistant'
import { errText } from '../lib/feedState'

type Turn = { q: string; a?: string; steps?: AgentStep[]; error?: string; kind?: AssistantErrorKind; pending?: boolean }

/** 每支手機自己的偏好：要不要念出來、要不要附上地圖中心。 */
const SPEAK_KEY = 'argus.assistant.speak'
const SHARE_POS_KEY = 'argus.assistant.sharePos'
function readFlag(k: string, def: boolean): boolean {
  try {
    const v = localStorage.getItem(k)
    return v === null ? def : v === '1'
  } catch {
    return def
  }
}
function writeFlag(k: string, v: boolean) {
  try {
    localStorage.setItem(k, v ? '1' : '0')
  } catch {
    // 無痕模式存不了：這次照用，只是下次不記得
  }
}

/** 瀏覽器的語音辨識（Safari 是 webkit 前綴）。TypeScript 內建型別沒有，只宣告用到的部分。 */
interface Rec {
  lang: string
  interimResults: boolean
  continuous: boolean
  start(): void
  stop(): void
  abort(): void
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
}
const SR: (new () => Rec) | undefined =
  typeof window === 'undefined'
    ? undefined
    : ((window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => Rec }).webkitSpeechRecognition)

function micErrorText(code: string): string {
  if (code === 'not-allowed' || code === 'service-not-allowed') {
    return '麥克風或語音辨識沒有權限：iPhone 設定 → Safari → 麥克風 → 允許（主畫面 App 也是看這裡）。也可以點輸入框，用鍵盤上的麥克風（聽寫）'
  }
  if (code === 'no-speech') return '沒聽到聲音，再按一次麥克風說說看'
  if (code === 'network') return '語音辨識要連網（iPhone 是送到 Apple 辨識），訊號不好時改用打字或鍵盤聽寫'
  if (code === 'audio-capture') return '找不到麥克風'
  if (code === 'aborted') return ''
  return `語音辨識出錯（${code}），改用打字或鍵盤上的麥克風（聽寫）`
}

const EXAMPLES = ['基隆港到彭佳嶼多遠？', '今晚這裡幾點完全天黑？', '附近有沒有發緊急的飛機？', '我 20 節，目標在 25.2, 121.9 往 270 度 10 節，怎麼攔？']

const KIND_CLS: Record<AssistantErrorKind, string> = {
  unconfigured: 'border-slate-600 text-slate-300',
  auth: 'border-rose-500/60 text-rose-200',
  busy: 'border-amber-500/60 text-amber-200',
  network: 'border-amber-500/60 text-amber-200',
  server: 'border-rose-500/60 text-rose-200',
}

/**
 * 🎙️ 語音助理：用說的問距離方位、攔截、天黑時間、附近飛機。
 * 計算由 App 自己的工具做（跟 MCP 連接器同一套），AI 只負責聽懂與講話（見 lib/assistant.ts）。
 * 手機、電腦都能用；瀏覽器不支援語音辨識時，用鍵盤上的麥克風（聽寫）一樣可以。
 */
export function AssistantPanel() {
  const open = useTacticalStore((s) => s.openTool === 'assistant')
  const setOpenTool = useTacticalStore((s) => s.setOpenTool)
  const setSettingsOpen = useTacticalStore((s) => s.setSettingsOpen)
  const mapView = useTacticalStore((s) => s.mapView)
  // 設定改過（通行碼存了）要重新讀
  useTacticalStore((s) => s.configRev)
  const configured = Boolean(getConfig().aiToken)
  const [q, setQ] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [listening, setListening] = useState(false)
  const [micError, setMicError] = useState('')
  const [speak, setSpeak] = useState(() => readFlag(SPEAK_KEY, true))
  const [sharePos, setSharePos] = useState(() => readFlag(SHARE_POS_KEY, false))
  const recRef = useRef<Rec | null>(null)
  const ctrlRef = useRef<AbortController | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // 關掉面板：停止聽、停止念、取消還在等的問題
  useEffect(() => {
    if (open) return
    recRef.current?.abort()
    ctrlRef.current?.abort()
    window.speechSynthesis?.cancel()
  }, [open])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [turns])

  const say = (text: string) => {
    if (!speak || !window.speechSynthesis) return
    const u = new SpeechSynthesisUtterance(toSpeech(text))
    u.lang = 'zh-TW'
    const v = window.speechSynthesis.getVoices().find((x) => /zh[-_]TW/i.test(x.lang))
    if (v) u.voice = v
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(u)
  }
  // iOS 只准「使用者按下的當下」開始發聲；回答是等一下才回來的，所以按送出時先念一個無聲的，之後才念得出來
  const unlockSpeech = () => {
    if (!speak || !window.speechSynthesis) return
    const u = new SpeechSynthesisUtterance(' ')
    u.volume = 0
    window.speechSynthesis.speak(u)
  }

  const send = async (text: string) => {
    const question = text.trim()
    if (!question) return
    unlockSpeech()
    ctrlRef.current?.abort()
    const ctrl = new AbortController()
    ctrlRef.current = ctrl
    setQ('')
    setTurns((t) => [...t, { q: question, pending: true }])
    const ctx = {
      nowIso: new Date().toISOString(),
      ...(sharePos ? { center: { lat: mapView.lat, lng: mapView.lng, zoom: mapView.zoom } } : {}),
    }
    const finish = (patch: Partial<Turn>) =>
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, ...patch, pending: false } : x)))
    try {
      const r = await askAssistant(question, ctx, getConfig().aiToken, { signal: ctrl.signal })
      finish({ a: r.answer, steps: r.steps })
      say(r.answer)
    } catch (e) {
      if (ctrl.signal.aborted) return
      finish({ error: errText(e, '語音助理出錯，稍後再試'), kind: e instanceof AssistantError ? e.kind : 'server' })
    }
  }

  const toggleMic = () => {
    if (!SR) return
    if (listening) {
      recRef.current?.stop()
      return
    }
    setMicError('')
    let finalText = ''
    let rec: Rec
    try {
      rec = new SR()
    } catch {
      setMicError('這個瀏覽器的語音辨識開不起來，改用鍵盤上的麥克風（聽寫）')
      return
    }
    rec.lang = 'zh-TW'
    rec.interimResults = true
    rec.continuous = false
    rec.onresult = (e) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) finalText += r[0].transcript
        else interim += r[0].transcript
      }
      setQ(finalText + interim)
    }
    rec.onerror = (e) => setMicError(micErrorText(e.error))
    rec.onend = () => {
      setListening(false)
      recRef.current = null
      // 講完自動送出，不用再按一次
      if (finalText.trim()) void send(finalText)
    }
    recRef.current = rec
    try {
      rec.start()
      setListening(true)
    } catch {
      setMicError('麥克風開不起來，改用鍵盤上的麥克風（聽寫）')
    }
  }

  if (!open) return null

  return (
    <div className="pointer-events-auto fixed inset-0 z-[2000] flex items-end justify-center bg-black/60 p-3 pt-[calc(0.75rem+env(safe-area-inset-top))] md:items-center">
      <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-xl border border-slate-700 bg-tactical-bg p-4">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="flex-1 text-base font-bold text-tactical-cyan">🎙️ 語音助理</h2>
          <button
            onClick={() => {
              const v = !speak
              setSpeak(v)
              writeFlag(SPEAK_KEY, v)
              if (!v) window.speechSynthesis?.cancel()
            }}
            aria-pressed={speak}
            aria-label={speak ? '回答會念出來（按一下改成不念）' : '回答不念出來（按一下改成念）'}
            className="min-h-[36px] rounded-full border border-slate-600 px-3 text-sm"
          >
            {speak ? '🔊' : '🔇'}
          </button>
          <button onClick={() => setOpenTool(null)} className="min-h-[36px] px-2 text-slate-400 active:scale-95" aria-label="關閉">
            ✕
          </button>
        </div>

        {!configured ? (
          <div className="rounded-lg border border-slate-600 bg-slate-900/60 p-3 text-xs leading-relaxed text-slate-300">
            <p className="font-semibold text-slate-200">⚪ 還沒設定</p>
            <p className="mt-1">
              語音助理要用 AI 服務（免費的 Groq 就可以）。照 ⚙️ 設定 →「🎙️ 語音助理」的步驟做一次（約 10 分鐘）：
              拿免費金鑰、放到 GitHub Secrets、重新部署、把通行碼存進這支手機。
            </p>
            <button
              onClick={() => {
                setOpenTool(null)
                setSettingsOpen(true)
              }}
              className="mt-2 min-h-[40px] w-full rounded-lg border border-tactical-cyan/60 text-sm font-semibold text-tactical-cyan"
            >
              去設定
            </button>
          </div>
        ) : (
          <>
            <div ref={listRef} className="min-h-[6rem] flex-1 space-y-2 overflow-y-auto pb-2">
              {turns.length === 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs text-slate-400">按麥克風用說的，或打字。可以這樣問：</p>
                  {EXAMPLES.map((ex) => (
                    <button
                      key={ex}
                      onClick={() => setQ(ex)}
                      className="block w-full rounded-lg border border-slate-700 bg-slate-900/50 px-2.5 py-2 text-left text-xs text-slate-200"
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              )}
              {turns.map((t, i) => (
                <div key={i} className="space-y-1">
                  <div className="ml-8 rounded-lg bg-tactical-cyan/15 px-2.5 py-1.5 text-sm text-slate-100">{t.q}</div>
                  {t.pending && <div className="mr-8 px-2.5 py-1.5 text-xs text-slate-400">⏳ 想一下…</div>}
                  {t.a && (
                    <div className="mr-8 rounded-lg border border-slate-700 bg-slate-900/70 px-2.5 py-1.5 text-sm text-slate-100">
                      {t.a}
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {t.steps?.map((s, j) => (
                          <span key={j} className={`rounded px-1 text-[0.625rem] ${s.ok ? 'bg-slate-800 text-slate-400' : 'bg-rose-900/40 text-rose-300'}`}>
                            🧮 {s.summary}
                          </span>
                        ))}
                        <button onClick={() => say(t.a!)} className="ml-auto text-xs text-slate-400" aria-label="再念一次">
                          🔊
                        </button>
                      </div>
                    </div>
                  )}
                  {t.error && t.kind && (
                    <div className={`mr-8 rounded-lg border px-2.5 py-1.5 text-xs leading-relaxed ${KIND_CLS[t.kind]}`}>
                      {t.kind === 'unconfigured' ? '⚪ 還沒設定：' : t.kind === 'busy' || t.kind === 'network' ? '🟡 ' : '🔴 '}
                      {t.error}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {micError && <p className="mb-1 text-[0.6875rem] leading-relaxed text-amber-300">{micError}</p>}
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void send(q)
              }}
              className="flex items-center gap-1.5"
            >
              {SR && (
                <button
                  type="button"
                  onClick={toggleMic}
                  aria-pressed={listening}
                  aria-label={listening ? '停止聽' : '按了開始說話'}
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg ${listening ? 'animate-pulse bg-rose-500 text-white' : 'border border-tactical-cyan/60 text-tactical-cyan'}`}
                >
                  🎙️
                </button>
              )}
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={listening ? '在聽…' : '打字，或用鍵盤上的麥克風'}
                enterKeyHint="send"
                aria-label="要問的問題"
                className="min-w-0 flex-1 rounded-full border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100"
              />
              <button type="submit" disabled={!q.trim()} className="h-11 shrink-0 rounded-full bg-tactical-cyan px-3 text-sm font-bold text-slate-900 disabled:opacity-40">
                送出
              </button>
            </form>
            <label className="mt-2 flex items-start gap-1.5 text-[0.6875rem] leading-relaxed text-slate-400">
              <input
                type="checkbox"
                checked={sharePos}
                onChange={(e) => {
                  setSharePos(e.target.checked)
                  writeFlag(SHARE_POS_KEY, e.target.checked)
                }}
                className="mt-0.5"
              />
              <span>附上目前地圖中心（說「這附近」「這裡」才聽得懂）</span>
            </label>
            <p className="mt-1 text-[0.625rem] leading-relaxed text-slate-500">
              問題（與勾選時的地圖中心）會送到 AI 供應商處理。免費方案可能被拿去改進服務（Google Gemini 免費層明講會，也可能有人工審閱），
              機敏的位置、船名不要說。數字一律由 App 的公式算，不是 AI 猜的。
            </p>
          </>
        )}
      </div>
    </div>
  )
}
