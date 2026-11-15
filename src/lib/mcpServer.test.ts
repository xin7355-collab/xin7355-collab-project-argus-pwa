import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decodeHeaderValue, handleMcpPost, PARSE_ERROR, SUPPORTED_VERSIONS, type McpHttpRequest } from './mcpServer.ts'

const V = '2026-07-28'
const meta = (extra: Record<string, unknown> = {}) => ({
  'io.modelcontextprotocol/protocolVersion': V,
  'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1' },
  'io.modelcontextprotocol/clientCapabilities': {},
  ...extra,
})

/** 組一個請求：headers 用小寫鍵。 */
function req(body: unknown, headers: Record<string, string> = {}): McpHttpRequest {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  return { body, header: (n) => h[n.toLowerCase()] ?? null }
}
/** 新版請求：標頭自動跟內文一致。 */
function modern(method: string, params: Record<string, unknown> = {}, id: string | number = 1, headerOverride: Record<string, string | null> = {}) {
  const headers: Record<string, string> = { 'MCP-Protocol-Version': V, 'Mcp-Method': method }
  if (method === 'tools/call' && typeof params.name === 'string') headers['Mcp-Name'] = params.name
  for (const [k, v] of Object.entries(headerOverride)) {
    if (v === null) delete headers[k]
    else headers[k] = v
  }
  return req({ jsonrpc: '2.0', id, method, params: { ...params, _meta: meta() } }, headers)
}
const body = (r: { body: unknown }) => r.body as Record<string, any>

// ── 新版（2026-07-28）──

test('server/discover：列出兩個世代的版本、只有工具能力、帶伺服器身分與快取提示', async () => {
  const r = await handleMcpPost(modern('server/discover'))
  assert.equal(r.status, 200)
  const res = body(r).result
  assert.equal(res.resultType, 'complete')
  assert.deepEqual(res.supportedVersions, SUPPORTED_VERSIONS)
  assert.deepEqual(res.capabilities, { tools: {} })
  assert.equal(res._meta['io.modelcontextprotocol/serverInfo'].name, 'argus-maritime')
  assert.ok(res.ttlMs >= 0)
  assert.equal(res.cacheScope, 'public')
  assert.match(res.instructions, /WGS84/)
})

test('tools/list：固定順序、每個工具有 inputSchema（object）、清單帶 ttlMs/cacheScope', async () => {
  const r = await handleMcpPost(modern('tools/list'))
  const res = body(r).result
  assert.equal(res.resultType, 'complete')
  const names = res.tools.map((t: { name: string }) => t.name)
  assert.deepEqual(names, ['parse_position', 'distance_bearing', 'dead_reckoning', 'intercept_course', 'horizon_range', 'sun_moon', 'search_pattern', 'nearby_aircraft'])
  for (const t of res.tools) {
    assert.equal(t.inputSchema.type, 'object', t.name)
    assert.match(t.name, /^[A-Za-z0-9_.-]{1,128}$/)
    assert.ok(t.description.length > 10)
  }
  assert.equal(typeof res.ttlMs, 'number')
})

test('tools/call：算得出來，帶 resultType、文字與結構化結果', async () => {
  const r = await handleMcpPost(modern('tools/call', { name: 'distance_bearing', arguments: { from: '24, 121', to: '25, 121' } }))
  assert.equal(r.status, 200)
  const res = body(r).result
  assert.equal(res.resultType, 'complete')
  assert.equal(res.isError, false)
  assert.match(res.content[0].text, /距離 60\.0 浬/)
  assert.ok(Math.abs(res.structuredContent.distanceNm - 60.04) < 0.05)
})

test('tools/call：Mcp-Name 用 Base64 包裝也認得；不一致回 400／-32020', async () => {
  const b64 = `=?base64?${btoa('distance_bearing')}?=`
  const ok = await handleMcpPost(modern('tools/call', { name: 'distance_bearing', arguments: { from: '24, 121', to: '25, 121' } }, 2, { 'Mcp-Name': b64 }))
  assert.equal(ok.status, 200)
  const bad = await handleMcpPost(modern('tools/call', { name: 'distance_bearing', arguments: {} }, 3, { 'Mcp-Name': 'parse_position' }))
  assert.equal(bad.status, 400)
  assert.equal(body(bad).error.code, -32020)
  const missing = await handleMcpPost(modern('tools/call', { name: 'distance_bearing', arguments: {} }, 4, { 'Mcp-Name': null }))
  assert.equal(body(missing).error.code, -32020)
})

test('標頭缺少或跟內文不一致：400／-32020（HeaderMismatch）', async () => {
  const cases: Record<string, string | null>[] = [
    { 'MCP-Protocol-Version': null },
    { 'Mcp-Method': null },
    { 'MCP-Protocol-Version': '2025-11-25' },
    { 'Mcp-Method': 'tools/call' },
  ]
  for (const o of cases) {
    const r = await handleMcpPost(modern('tools/list', {}, 9, o))
    assert.equal(r.status, 400, JSON.stringify(o))
    assert.equal(body(r).error.code, -32020, JSON.stringify(o))
    assert.equal(body(r).id, 9)
  }
})

test('不支援的版本：400／-32022，data 列出支援的版本與要求的版本', async () => {
  const r = await handleMcpPost(
    req(
      { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: meta({ 'io.modelcontextprotocol/protocolVersion': '2099-01-01' }) } },
      { 'MCP-Protocol-Version': '2099-01-01', 'Mcp-Method': 'tools/list' },
    ),
  )
  assert.equal(r.status, 400)
  assert.equal(body(r).error.code, -32022)
  assert.deepEqual(body(r).error.data, { supported: SUPPORTED_VERSIONS, requested: '2099-01-01' })
})

test('少了必填的 clientCapabilities：400／-32602；新版沒有 ping：404／-32601', async () => {
  const noCaps = req(
    { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': V } } },
    { 'MCP-Protocol-Version': V, 'Mcp-Method': 'tools/list' },
  )
  const r1 = await handleMcpPost(noCaps)
  assert.equal(r1.status, 400)
  assert.equal(body(r1).error.code, -32602)
  const r2 = await handleMcpPost(modern('ping'))
  assert.equal(r2.status, 404)
  assert.equal(body(r2).error.code, -32601)
})

test('標頭說新版、內文卻沒帶版本：格式不對（400／-32602），不會被當成舊版', async () => {
  const r = await handleMcpPost(req({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { 'MCP-Protocol-Version': V, 'Mcp-Method': 'tools/list' }))
  assert.equal(r.status, 400)
  assert.equal(body(r).error.code, -32602)
})

test('不認得的工具：協定錯誤 -32602；輸入看不懂：isError 結果並說明怎麼寫', async () => {
  const r1 = await handleMcpPost(modern('tools/call', { name: 'rm_rf', arguments: {} }))
  assert.equal(body(r1).error.code, -32602)
  assert.match(body(r1).error.message, /Unknown tool: rm_rf/)
  const r2 = await handleMcpPost(modern('tools/call', { name: 'parse_position', arguments: { text: '基隆港旁邊' } }))
  assert.equal(body(r2).result.isError, true)
  assert.match(body(r2).result.content[0].text, /看不懂.*25\.13, 121\.74/)
  const r3 = await handleMcpPost(modern('tools/call', { name: 'dead_reckoning', arguments: { start: '24, 121', course_deg: 400, speed_kn: 10, minutes: 60 } }))
  assert.equal(body(r3).result.isError, true)
  assert.match(body(r3).result.content[0].text, /0～360/)
})

// ── 舊版（initialize 世代）──

test('舊版 initialize：照用戶端要的版本；不認得的版本回我們最新的舊版', async () => {
  const r1 = await handleMcpPost(req({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c', version: '1' } } }))
  assert.equal(r1.status, 200)
  assert.equal(body(r1).result.protocolVersion, '2025-06-18')
  assert.deepEqual(body(r1).result.capabilities, { tools: { listChanged: false } })
  assert.equal(body(r1).result.serverInfo.name, 'argus-maritime')
  const r2 = await handleMcpPost(req({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2024-01-01' } }))
  assert.equal(body(r2).result.protocolVersion, '2025-11-25')
})

test('舊版：initialized 通知回 202 沒內文；ping、tools/list、tools/call 照舊', async () => {
  const n = await handleMcpPost(req({ jsonrpc: '2.0', method: 'notifications/initialized' }, { 'MCP-Protocol-Version': '2025-06-18' }))
  assert.deepEqual(n, { status: 202, body: null })
  const p = await handleMcpPost(req({ jsonrpc: '2.0', id: 'p', method: 'ping' }, { 'MCP-Protocol-Version': '2025-06-18' }))
  assert.deepEqual(body(p).result, {})
  const l = await handleMcpPost(req({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, { 'MCP-Protocol-Version': '2025-11-25' }))
  assert.equal(body(l).result.tools.length, 8)
  assert.equal(body(l).result.resultType, undefined, '舊版結果不加新版欄位')
  const c = await handleMcpPost(req({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'horizon_range', arguments: { antenna_height_m: 10 } } }))
  assert.match(body(c).result.content[0].text, /雷達地平線約 7\.0\d 浬/)
})

test('舊版：標頭帶不支援的版本 → 400', async () => {
  const r = await handleMcpPost(req({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, { 'MCP-Protocol-Version': '2099-01-01' }))
  assert.equal(r.status, 400)
})

test('2025-03-26 的一批：照順序回、通知不回；全是通知就 202', async () => {
  const r = await handleMcpPost(
    req([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ]),
  )
  assert.equal(r.status, 200)
  assert.deepEqual((r.body as { id: number }[]).map((x) => x.id), [1, 2])
  const n = await handleMcpPost(req([{ jsonrpc: '2.0', method: 'notifications/initialized' }]))
  assert.equal(n.status, 202)
})

test('壞掉的內文：解析錯誤 -32700；不是 JSON-RPC -32600；id 不能是 null', async () => {
  assert.equal(body(await handleMcpPost(req(PARSE_ERROR))).error.code, -32700)
  assert.equal(body(await handleMcpPost(req({ hello: 1 }))).error.code, -32600)
  assert.equal(body(await handleMcpPost(req({ jsonrpc: '2.0', id: null, method: 'ping' }))).error.code, -32600)
  assert.equal(body(await handleMcpPost(req([]))).error.code, -32600)
})

test('標頭的 Base64 包裝（UTF-8）', () => {
  assert.equal(decodeHeaderValue('us-west1'), 'us-west1')
  assert.equal(decodeHeaderValue('=?base64?SGVsbG8sIOS4lueVjA==?='), 'Hello, 世界')
  assert.equal(decodeHeaderValue('=?base64?PT9iYXNlNjQ/bGl0ZXJhbD89?='), '=?base64?literal?=')
  assert.equal(decodeHeaderValue('=?base64?!!!?='), null)
})
