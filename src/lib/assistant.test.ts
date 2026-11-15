import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  askAssistant,
  AssistantError,
  buildSystemPrompt,
  MAX_TOOL_STEPS,
  parseAgentReply,
  runAgent,
  toSpeech,
  type AgentDeps,
  type ChatMessage,
} from './assistant.ts'
import { TOOLS } from './mcpTools.ts'

test('解析 AI 回覆：工具、回答；容忍前後廢話、``` 包裝、<think>；看不懂回 null', () => {
  assert.deepEqual(parseAgentReply('{"tool":"distance_bearing","arguments":{"from":"24,121","to":"25,121"}}'), {
    kind: 'tool',
    name: 'distance_bearing',
    args: { from: '24,121', to: '25,121' },
  })
  assert.deepEqual(parseAgentReply('好的：\n```json\n{"answer":"距離 60 浬。"}\n```'), { kind: 'answer', text: '距離 60 浬。' })
  assert.deepEqual(parseAgentReply('<think>先想想 {不是這個}</think>{"answer":"好"}'), { kind: 'answer', text: '好' })
  assert.equal(parseAgentReply('我覺得大概 60 浬'), null)
  assert.equal(parseAgentReply('{"answer":""}'), null)
  assert.equal(parseAgentReply('{"tool":"x","arguments":[1]}'), null)
  assert.equal(parseAgentReply('{"foo":1}'), null)
})

test('系統提示：有地圖中心就帶（「這附近」聽得懂）；沒有就要 AI 反問位置；列出所有工具', () => {
  const withC = buildSystemPrompt(TOOLS, { center: { lat: 25.1234, lng: 121.7654 }, nowIso: '2026-11-15T10:00:00Z' })
  assert.match(withC, /地圖中心：25\.1234, 121\.7654/)
  assert.match(withC, /2026-11-15T10:00:00Z/)
  for (const t of TOOLS) assert.match(withC, new RegExp(`- ${t.name}：`))
  assert.match(buildSystemPrompt(TOOLS, {}), /請使用者說出位置/)
})

/** 假的 router：每一輪給幾個候選回覆，回第一個通過 validate 的（模擬「不合格就換更強的模型」）。 */
function fakeChat(rounds: string[][]) {
  const seen: ChatMessage[][] = []
  let i = 0
  const chat: AgentDeps['chat'] = async (messages, validate) => {
    seen.push(messages.map((m) => ({ ...m })))
    const cands = rounds[i++] ?? []
    const ok = cands.find((c) => validate(c))
    if (ok === undefined) throw new Error('所有模型都失敗了')
    return ok
  }
  return { chat, seen }
}

test('直接回答：不用工具', async () => {
  const { chat } = fakeChat([['{"answer":"你好，請問要算什麼？"}']])
  const r = await runAgent('你好', {}, { chat, tools: TOOLS, runTool: async () => assert.fail('不該用工具') })
  assert.deepEqual(r, { answer: '你好，請問要算什麼？', steps: [] })
})

test('先用工具再回答：工具結果交回給 AI，步驟有記錄', async () => {
  const { chat, seen } = fakeChat([
    ['{"tool":"distance_bearing","arguments":{"from":"24, 121","to":"25, 121"}}'],
    ['{"answer":"大約 60 浬，方位 000 度。"}'],
  ])
  const calls: unknown[] = []
  const r = await runAgent('24,121 到 25,121 多遠', {}, {
    chat,
    tools: TOOLS,
    runTool: async (name, args) => {
      calls.push([name, args])
      return { text: '距離 60.0 浬（111.2 公里）\n起點往終點的真方位 000°' }
    },
  })
  assert.equal(r.answer, '大約 60 浬，方位 000 度。')
  assert.deepEqual(calls, [['distance_bearing', { from: '24, 121', to: '25, 121' }]])
  assert.deepEqual(r.steps, [{ tool: 'distance_bearing', args: { from: '24, 121', to: '25, 121' }, ok: true, summary: '距離 60.0 浬（111.2 公里）' }])
  assert.match(seen[1][seen[1].length - 1].content, /工具 distance_bearing 的結果：\n距離 60\.0 浬/)
})

test('AI 編了不存在的工具：不合格，換更強的模型（下一個候選）', async () => {
  const { chat } = fakeChat([['{"tool":"guess_distance","arguments":{}}', '{"answer":"請告訴我起點和終點。"}']])
  const r = await runAgent('多遠', {}, { chat, tools: TOOLS, runTool: async () => assert.fail('不該執行') })
  assert.equal(r.answer, '請告訴我起點和終點。')
})

test('工具出錯：錯誤訊息交給 AI 讓它改參數，步驟標 ok=false', async () => {
  const { chat, seen } = fakeChat([
    ['{"tool":"parse_position","arguments":{"text":"台北101"}}'],
    ['{"tool":"parse_position","arguments":{"text":"25.0340, 121.5645"}}'],
    ['{"answer":"台北 101 在北緯 25 度 2 分。"}'],
  ])
  let n = 0
  const r = await runAgent('台北101 座標', {}, {
    chat,
    tools: TOOLS,
    runTool: async () => {
      if (n++ === 0) throw new Error('text「台北101」看不懂')
      return { text: '十進位：25.034000, 121.564500' }
    },
  })
  assert.equal(r.steps.length, 2)
  assert.equal(r.steps[0].ok, false)
  assert.equal(r.steps[1].ok, true)
  assert.match(seen[1][seen[1].length - 1].content, /工具出錯：text「台北101」看不懂/)
})

test(`工具最多用 ${MAX_TOOL_STEPS} 次，之後要求直接回答`, async () => {
  const toolCall = '{"tool":"horizon_range","arguments":{"antenna_height_m":10}}'
  const { chat, seen } = fakeChat([[toolCall], [toolCall], [toolCall], [toolCall, '{"answer":"雷達大約 7 浬。"}']])
  const r = await runAgent('雷達看多遠', {}, { chat, tools: TOOLS, runTool: async () => ({ text: '雷達地平線約 7.04 浬' }) })
  assert.equal(r.steps.length, MAX_TOOL_STEPS)
  assert.equal(r.answer, '雷達大約 7 浬。')
  assert.match(seen[MAX_TOOL_STEPS][seen[MAX_TOOL_STEPS].length - 1].content, /工具已經用夠了/)
})

test('沒聽到問題：直接說，不打 AI', async () => {
  const r = await runAgent('   ', {}, { chat: async () => assert.fail('不該打 AI'), tools: TOOLS, runTool: async () => ({ text: '' }) })
  assert.match(r.answer, /沒有聽到問題/)
})

test('念出來之前：拿掉表情與 markdown，° 念成「度」', () => {
  assert.equal(toSpeech('🛰️ **方位 045°**，距離 12 浬 🚢'), '方位 045 度，距離 12 浬')
})

const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

test('問 Worker：沒有通行碼不連網、直接說「還沒設定」；各種錯誤分清楚', async () => {
  await assert.rejects(askAssistant('q', {}, '', { fetchImpl: async () => assert.fail('不該連網') }), (e: unknown) => e instanceof AssistantError && e.kind === 'unconfigured')
  const ok = await askAssistant('q', {}, 't', { fetchImpl: reply(200, { answer: '好', steps: [] }) })
  assert.equal(ok.answer, '好')
  const kind = async (status: number, body: unknown) => {
    try {
      await askAssistant('q', {}, 't', { fetchImpl: reply(status, body) })
      return 'none'
    } catch (e) {
      return e instanceof AssistantError ? `${e.kind}:${e.message}` : 'other'
    }
  }
  assert.equal(await kind(503, { error: '伺服器還沒設定 AI 金鑰', code: 'unconfigured' }), 'unconfigured:伺服器還沒設定 AI 金鑰')
  assert.match(await kind(401, { error: '通行碼不對' }), /^auth:通行碼不對/)
  assert.match(await kind(429, { error: '太頻繁' }), /^busy:/)
  assert.match(await kind(502, { error: 'AI 暫時用不了' }), /^server:AI 暫時用不了/)
  assert.match(await kind(500, 'oops'), /^server:語音助理回應 500/)
  const down = (async () => {
    throw new TypeError('Failed to fetch')
  }) as unknown as typeof fetch
  await assert.rejects(askAssistant('q', {}, 't', { fetchImpl: down }), (e: unknown) => e instanceof AssistantError && e.kind === 'network')
})
