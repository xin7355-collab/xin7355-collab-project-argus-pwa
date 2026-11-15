// ── 語音助理：用說的問，AI 決定要用哪個計算工具，再用口語回答 ─────────────
//
// 計算一律交給 App 自己的工具（src/lib/mcpTools.ts，跟 MCP 連接器同一套），AI 只負責
// 「聽懂要算什麼、填參數、把結果講成一句話」——數字不讓 AI 自己編。
//
// 各家 AI（Groq、Gemini、OpenRouter、Claude）的「工具呼叫」格式都不一樣，所以不用它們的原生功能，
// 改成規定 AI 只回一段 JSON：要嘛 {"tool": 名稱, "arguments": {...}}，要嘛 {"answer": "..."}。
// 格式不對時 skl 的 ai-model-router 會自動換更強的模型重試（validate）。
//
// 這個檔案 App 與 Worker 共用：runAgent 是純函式（chat 與工具由呼叫端注入），可離線測。

import type { ToolDef, ToolResult } from './mcpTools'

export interface AssistantContext {
  /** 使用者同意時才帶：目前地圖中心（讓「這附近」聽得懂）。 */
  center?: { lat: number; lng: number; zoom?: number }
  /** 現在時間（ISO）；由 App 帶，AI 才知道「今晚」是哪天。 */
  nowIso?: string
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type AgentReply = { kind: 'tool'; name: string; args: Record<string, unknown> } | { kind: 'answer'; text: string }

export interface AgentStep {
  tool: string
  args: Record<string, unknown>
  ok: boolean
  /** 給畫面顯示的一行摘要（工具結果的第一行）。 */
  summary: string
}

export interface AgentResult {
  answer: string
  steps: AgentStep[]
}

/** 一次問題最多呼叫幾次工具：夠用（例如先查距離再查攔截），又不會讓 AI 一直繞圈。 */
export const MAX_TOOL_STEPS = 3
/** 問題長度上限（字）：語音輸入不會超過這麼長；太長多半是貼錯東西。 */
export const MAX_QUESTION_CHARS = 500

/** 把工具清單寫成 AI 看得懂的說明（只列名稱、用途、參數），不必塞完整 JSON Schema。 */
export function toolCatalog(tools: Pick<ToolDef, 'name' | 'description' | 'inputSchema'>[]): string {
  return tools
    .map((t) => {
      const props = (t.inputSchema.properties ?? {}) as Record<string, { type?: string; description?: string; enum?: string[] }>
      const req = new Set((t.inputSchema.required as string[] | undefined) ?? [])
      const params = Object.entries(props)
        .map(([k, p]) => `${k}${req.has(k) ? '' : '（可省略）'}: ${p.enum ? p.enum.join('|') : (p.type ?? 'any')}，${(p.description ?? '').split('。')[0]}`)
        .join('；')
      return `- ${t.name}：${t.description.split(' ')[0]}\n  參數：${params || '無'}`
    })
    .join('\n')
}

/** 系統提示：角色、工具、回覆格式、情境（地圖中心、時間）。 */
export function buildSystemPrompt(tools: Pick<ToolDef, 'name' | 'description' | 'inputSchema'>[], ctx: AssistantContext): string {
  const lines = [
    '你是「阿爾戈斯」海域觀測 App 的語音助理，使用者是在海上值勤的台灣人，用繁體中文（台灣用語）回答。',
    '凡是要算數字（距離、方位、位置、時間、日出日落、飛機）一律用下面的工具算，絕對不要自己估算或編數字。',
    '',
    '可用的工具：',
    toolCatalog(tools),
    '',
    '回覆規則：只回一個 JSON 物件，不要有任何其他文字、不要用 ``` 包起來。二選一：',
    '1. 要用工具：{"tool": "工具名稱", "arguments": {參數}}',
    '2. 可以回答了：{"answer": "回答"}',
    '回答要口語、會被念出來：三句以內，數字帶單位（浬、度、節、分鐘），方位講三位數（例如 045 度）。',
    '工具回「看不懂」或缺參數時，改參數再試；問題真的不清楚（例如沒說位置）就用 answer 反問使用者。',
    '位置一律 WGS84，可以寫「25.13, 121.74」或「25°07.8\'N 121°44.5\'E」。',
  ]
  if (ctx.center) {
    lines.push(`使用者目前看的地圖中心：${ctx.center.lat.toFixed(4)}, ${ctx.center.lng.toFixed(4)}（使用者說「這裡」「附近」時用這個位置）。`)
  } else {
    lines.push('使用者沒有提供目前位置；問題需要位置但沒說時，用 answer 請使用者說出位置或座標。')
  }
  if (ctx.nowIso) lines.push(`現在時間：${ctx.nowIso}（台灣是 UTC+8）。`)
  return lines.join('\n')
}

/**
 * 解析 AI 的回覆。容忍常見的走樣：前後多了說明文字、用 ``` 包起來、推理模型的 <think>。
 * 看不懂回 null（validate 會讓 router 換更強的模型重試）。
 */
export function parseAgentReply(text: string): AgentReply | null {
  const s = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let o: unknown
  try {
    o = JSON.parse(s.slice(start, end + 1))
  } catch {
    return null
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null
  const r = o as Record<string, unknown>
  if (typeof r.tool === 'string' && r.tool) {
    const args = r.arguments === undefined ? {} : r.arguments
    if (!args || typeof args !== 'object' || Array.isArray(args)) return null
    return { kind: 'tool', name: r.tool, args: args as Record<string, unknown> }
  }
  if (typeof r.answer === 'string' && r.answer.trim()) return { kind: 'answer', text: r.answer.trim() }
  return null
}

export interface AgentDeps {
  /** 問 AI；validate 回 false 時呼叫端（router）會換更強的模型重試。 */
  chat: (messages: ChatMessage[], validate: (s: string) => boolean) => Promise<string>
  /** 執行工具；輸入錯誤要丟錯（訊息會轉給 AI 讓它改）。 */
  runTool: (name: string, args: Record<string, unknown>) => Promise<ToolResult>
  /** 工具清單（給 AI 看）。 */
  tools: Pick<ToolDef, 'name' | 'description' | 'inputSchema'>[]
}

/**
 * 跑一次問答：AI 選工具 → 執行 → 把結果給 AI → … → 回答。
 * 工具最多用 MAX_TOOL_STEPS 次；用完還沒回答就要求 AI 直接回答（不能再用工具）。
 */
export async function runAgent(question: string, ctx: AssistantContext, deps: AgentDeps): Promise<AgentResult> {
  const q = question.trim().slice(0, MAX_QUESTION_CHARS)
  if (!q) return { answer: '沒有聽到問題，請再說一次。', steps: [] }
  const known = new Set(deps.tools.map((t) => t.name))
  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(deps.tools, ctx) },
    { role: 'user', content: q },
  ]
  const steps: AgentStep[] = []
  const valid = (s: string) => {
    const r = parseAgentReply(s)
    return !!r && (r.kind === 'answer' || known.has(r.name))
  }
  for (let i = 0; i <= MAX_TOOL_STEPS; i++) {
    const last = i === MAX_TOOL_STEPS
    if (last) messages.push({ role: 'user', content: '工具已經用夠了，請直接用 {"answer": "..."} 回答，不要再用工具。' })
    const raw = await deps.chat(messages, last ? (s) => parseAgentReply(s)?.kind === 'answer' : valid)
    const reply = parseAgentReply(raw)
    if (!reply) throw new Error('AI 的回覆格式不對（換了模型也一樣），請換個說法再問一次')
    if (reply.kind === 'answer') return { answer: reply.text, steps }
    if (last) break
    messages.push({ role: 'assistant', content: JSON.stringify({ tool: reply.name, arguments: reply.args }) })
    let resultText: string
    let ok = true
    try {
      const r = await deps.runTool(reply.name, reply.args)
      resultText = r.text
    } catch (e) {
      ok = false
      resultText = `工具出錯：${e instanceof Error ? e.message : '不明原因'}`
    }
    steps.push({ tool: reply.name, args: reply.args, ok, summary: resultText.split('\n')[0].slice(0, 120) })
    messages.push({ role: 'user', content: `工具 ${reply.name} 的結果：\n${resultText}\n\n請繼續（再用工具，或用 {"answer": "..."} 回答）。` })
  }
  throw new Error('AI 一直沒有給出回答，請換個說法再問一次')
}

/** 念出來之前整理：拿掉表情符號、markdown 記號，°改成「度」。 */
export function toSpeech(text: string): string {
  return text
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
    .replace(/[*_`#>]/g, '')
    .replace(/(\d)\s*°/g, '$1 度')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── App 端：問 Worker ─────────────────────────────────────

export type AssistantErrorKind = 'unconfigured' | 'auth' | 'busy' | 'network' | 'server'

export class AssistantError extends Error {
  readonly kind: AssistantErrorKind
  constructor(message: string, kind: AssistantErrorKind) {
    super(message)
    this.name = 'AssistantError'
    this.kind = kind
  }
}

/** 問語音助理。通行碼放標頭（x-argus-ai-token），不放網址。錯誤分成「還沒設定」和「真的壞掉」。 */
export async function askAssistant(
  question: string,
  ctx: AssistantContext,
  token: string,
  opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<AgentResult> {
  if (!token) throw new AssistantError('還沒設定語音助理的通行碼（⚙️ 設定 → 🎙️ 語音助理）', 'unconfigured')
  const doFetch = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
  let res: Response
  try {
    res = await doFetch('/api/ai', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-argus-ai-token': token },
      body: JSON.stringify({ question, context: ctx }),
      signal: opts.signal,
    })
  } catch (e) {
    if (opts.signal?.aborted) throw e
    throw new AssistantError('連不上語音助理（海上訊號不穩時常見），稍後再試', 'network')
  }
  let body: { answer?: unknown; steps?: unknown; error?: unknown; code?: unknown } | null = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  if (res.ok && body && typeof body.answer === 'string') {
    return { answer: body.answer, steps: Array.isArray(body.steps) ? (body.steps as AgentStep[]) : [] }
  }
  const msg = typeof body?.error === 'string' && body.error ? body.error : `語音助理回應 ${res.status}，稍後再試`
  if (body?.code === 'unconfigured') throw new AssistantError(msg, 'unconfigured')
  if (res.status === 401 || res.status === 403) throw new AssistantError(msg, 'auth')
  if (res.status === 429) throw new AssistantError(msg, 'busy')
  throw new AssistantError(msg, 'server')
}
