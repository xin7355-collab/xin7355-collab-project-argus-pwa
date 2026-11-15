// 檢查部署後的 MCP 連接器與語音助理端點（手動觸發，見 .github/workflows/mcp-probe.yml）。
// 從 GitHub 伺服器用兩種世代的用戶端各走一遍：舊版 initialize 握手、新版 2026-07-28（server/discover）；
// 再確認 /api/ai 有回應（不帶通行碼，不會用到任何 AI 額度）。
// 只用公開地標（基隆港、彭佳嶼）；不讀任何 Secret；紀錄只印結果摘要。
const URL_ = process.env.MCP_URL || 'https://argus-app.xin7355.workers.dev/mcp'
let failed = false
const ok = (name, pass, detail = '') => {
  if (!pass) failed = true
  console.log(`${pass ? '✅' : '❌'} ${name}${detail ? '：' + detail : ''}`)
}
async function post(body, headers = {}) {
  const r = await fetch(URL_, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  })
  const t = await r.text()
  let j = null
  try {
    j = t ? JSON.parse(t) : null
  } catch {
    j = { raw: t.slice(0, 200) }
  }
  return { status: r.status, j }
}

console.log(`== ${URL_} ==`)
// 舊版
let r = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'probe', version: '1' } } })
ok('舊版 initialize', r.status === 200 && r.j?.result?.protocolVersion === '2025-06-18', JSON.stringify(r.j?.result?.serverInfo))
r = await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, { 'MCP-Protocol-Version': '2025-06-18' })
ok('舊版 initialized 通知 → 202', r.status === 202)
r = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, { 'MCP-Protocol-Version': '2025-06-18' })
ok('舊版 tools/list', r.status === 200 && r.j?.result?.tools?.length === 8, r.j?.result?.tools?.map((t) => t.name).join(', '))
r = await post(
  { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'distance_bearing', arguments: { from: "25°09'N 121°45'E", to: "25°38'N 122°04'E" } } },
  { 'MCP-Protocol-Version': '2025-06-18' },
)
ok('舊版 tools/call（基隆港→彭佳嶼）', r.status === 200 && !r.j?.result?.isError, r.j?.result?.content?.[0]?.text?.split('\n')[0])

// 新版
const V = '2026-07-28'
const meta = { 'io.modelcontextprotocol/protocolVersion': V, 'io.modelcontextprotocol/clientInfo': { name: 'probe', version: '1' }, 'io.modelcontextprotocol/clientCapabilities': {} }
r = await post({ jsonrpc: '2.0', id: 4, method: 'server/discover', params: { _meta: meta } }, { 'MCP-Protocol-Version': V, 'Mcp-Method': 'server/discover' })
ok('新版 server/discover', r.status === 200 && r.j?.result?.resultType === 'complete', JSON.stringify(r.j?.result?.supportedVersions))
r = await post(
  { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nearby_aircraft', arguments: { position: '25.08, 121.23', radius_nm: 30 }, _meta: meta } },
  { 'MCP-Protocol-Version': V, 'Mcp-Method': 'tools/call', 'Mcp-Name': 'nearby_aircraft' },
)
const first = r.j?.result?.content?.[0]?.text?.split('\n')[0]
ok('新版 tools/call（桃園機場附近飛機，只印第一行摘要）', r.status === 200 && r.j?.result?.resultType === 'complete', first)

// HTTP 層
const g = await fetch(URL_, { method: 'GET', signal: AbortSignal.timeout(20000) })
ok('GET → 405', g.status === 405)
r = await post({ jsonrpc: '2.0', id: 6, method: 'tools/list' }, { origin: 'https://evil.example' })
ok('別的網站 Origin → 403', r.status === 403)
// 語音助理端點：不帶通行碼。還沒設定金鑰時應回 503＋code unconfigured，設好了應回 401（通行碼不對）。
// 兩種都代表 /api/ai 在正式環境載得起來（AI 路由模組有打包成功）；其他狀態才是壞掉。
const aiUrl = new URL('/api/ai', URL_).toString()
const ai = await fetch(aiUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'ping' }), signal: AbortSignal.timeout(20000) })
const aj = await ai.json().catch(() => null)
ok('語音助理端點有回應（還沒設定 503／設好了 401）', (ai.status === 503 && aj?.code === 'unconfigured') || ai.status === 401, `HTTP ${ai.status}${aj?.code ? ' ' + aj.code : ''}`)
process.exit(failed ? 1 : 0)
