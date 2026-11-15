// ── MCP 伺服器（Streamable HTTP，無狀態、只有工具）─────────────────
//
// 支援兩個世代的用戶端（規格 basic/versioning「Dual-era」）：
//   - 新版 2026-07-28：沒有 initialize；每個請求在 params._meta 帶
//     io.modelcontextprotocol/protocolVersion 與 clientCapabilities，HTTP 標頭帶
//     MCP-Protocol-Version、Mcp-Method、Mcp-Name，要跟內文一致；必須實作 server/discover；
//     結果要有 resultType，清單要有 ttlMs／cacheScope。
//   - 舊版 2025-11-25／2025-06-18／2025-03-26：先 initialize，再 tools/list、tools/call、ping。
//     我們不發 Mcp-Session-Id（規格允許無狀態），所以兩個世代都是一個請求算一個請求。
// Claude 的自訂連接器是從 Anthropic 的伺服器連過來的，用哪一版由它決定，所以兩種都要接。
//
// 這裡只處理「一個 HTTP 請求進來 → 回什麼」，不碰 Request/Response 物件，可離線測；
// worker/mcp.js 負責接上 Cloudflare 的 HTTP。

import { TOOLS, TOOL_BY_NAME, ToolInputError, type ToolDeps } from './mcpTools.ts'

export const MODERN_VERSIONS = ['2026-07-28'] as const
export const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'] as const
export const SUPPORTED_VERSIONS: string[] = [...MODERN_VERSIONS, ...LEGACY_VERSIONS]

export const SERVER_INFO = { name: 'argus-maritime', title: '阿爾戈斯 海域計算', version: '1.0.0' }

export const INSTRUCTIONS =
  '阿爾戈斯（Argus）海域計算工具。位置一律 WGS84，可寫十進位（25.13, 121.74）或度分（25°07.8\'N 121°44.5\'E）；' +
  '距離以浬為主、附公里。距離方位、推算船位、攔截、視距、日月、搜索航線都是純計算，不連網；' +
  'nearby_aircraft 會查 adsb.lol 的公開 ADS-B 資料（ODbL，引用時請註明出處）。' +
  '結果僅供參考，實際航行與勤務以官方海圖、儀器與指揮為準。'

/** 清單類結果可以快取多久：工具清單只有部署時才會變。 */
const LIST_TTL_MS = 3_600_000

const META_VERSION = 'io.modelcontextprotocol/protocolVersion'
const META_CAPS = 'io.modelcontextprotocol/clientCapabilities'
const META_SERVER = 'io.modelcontextprotocol/serverInfo'

export interface McpHttpRequest {
  /** 已解析的 JSON；解析失敗傳 PARSE_ERROR。 */
  body: unknown
  /** 讀標頭（不分大小寫）。 */
  header: (name: string) => string | null
}

export interface McpHttpResponse {
  status: number
  /** null＝沒有內文（202）。 */
  body: unknown | null
}

export const PARSE_ERROR = Symbol('parse-error')

type Id = string | number
type Json = Record<string, unknown>

const rpcError = (id: Id | null, code: number, message: string, data?: unknown) => ({
  jsonrpc: '2.0',
  id,
  error: data === undefined ? { code, message } : { code, message, data },
})
const rpcResult = (id: Id, result: Json) => ({ jsonrpc: '2.0', id, result })

const isObj = (x: unknown): x is Json => !!x && typeof x === 'object' && !Array.isArray(x)
const validId = (x: unknown): x is Id => typeof x === 'string' || (typeof x === 'number' && Number.isFinite(x))

/** Mcp-Name 等標頭的 Base64 包裝：=?base64?...?=（UTF-8）。不是包裝就原樣回傳；壞掉回 null。 */
export function decodeHeaderValue(v: string): string | null {
  const m = /^=\?base64\?(.*)\?=$/.exec(v)
  if (!m) return v
  try {
    const bin = atob(m[1])
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
  } catch {
    return null
  }
}

function toolList() {
  return TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations }))
}

/** 執行工具。輸入錯誤回 isError（讓模型改了再試）；不認得的工具是協定錯誤（-32602）。 */
async function callTool(params: Json, deps: ToolDeps): Promise<{ result: Json } | { error: { code: number; message: string } }> {
  const name = params.name
  if (typeof name !== 'string') return { error: { code: -32602, message: 'tools/call 缺少 name' } }
  const tool = TOOL_BY_NAME.get(name)
  if (!tool) return { error: { code: -32602, message: `Unknown tool: ${name}` } }
  const args = params.arguments === undefined ? {} : params.arguments
  if (!isObj(args)) return { error: { code: -32602, message: 'arguments 要是物件' } }
  try {
    const r = await tool.run(args, deps)
    const result: Json = { content: [{ type: 'text', text: r.text }], isError: false }
    if (r.structured !== undefined) result.structuredContent = r.structured
    return { result }
  } catch (e) {
    // 輸入錯誤把原因講清楚；其他錯誤不外洩內部訊息
    const text = e instanceof ToolInputError ? e.message : `${tool.title}暫時算不出來（${e instanceof Error && e.message.length < 120 ? e.message : '內部錯誤'}），稍後再試`
    return { result: { content: [{ type: 'text', text }], isError: true } }
  }
}

/** 新版（2026-07-28）請求：驗證標頭與 _meta，再分派。 */
async function handleModern(msg: Json, id: Id, params: Json, version: string, req: McpHttpRequest, deps: ToolDeps): Promise<McpHttpResponse> {
  const method = msg.method as string
  if (!(MODERN_VERSIONS as readonly string[]).includes(version)) {
    return { status: 400, body: rpcError(id, -32022, 'Unsupported protocol version', { supported: SUPPORTED_VERSIONS, requested: version }) }
  }
  // 標頭要有、而且要跟內文一致（不然前面的代理照標頭分流、我們照內文執行，會被鑽漏洞）
  const hv = req.header('mcp-protocol-version')
  const hm = req.header('mcp-method')
  if (hv === null || hm === null) return { status: 400, body: rpcError(id, -32020, 'Header mismatch: MCP-Protocol-Version and Mcp-Method headers are required') }
  if (hv !== version) return { status: 400, body: rpcError(id, -32020, `Header mismatch: MCP-Protocol-Version header value '${hv}' does not match body value '${version}'`) }
  if (hm !== method) return { status: 400, body: rpcError(id, -32020, `Header mismatch: Mcp-Method header value '${hm}' does not match body value '${method}'`) }
  if (method === 'tools/call') {
    const raw = req.header('mcp-name')
    const hn = raw === null ? null : decodeHeaderValue(raw)
    if (hn === null) return { status: 400, body: rpcError(id, -32020, 'Header mismatch: Mcp-Name header is required for tools/call') }
    if (hn !== params.name) return { status: 400, body: rpcError(id, -32020, `Header mismatch: Mcp-Name header value '${hn}' does not match body value '${String(params.name)}'`) }
  }
  const meta = params._meta as Json
  if (!isObj(meta[META_CAPS])) return { status: 400, body: rpcError(id, -32602, `Invalid params: _meta.${META_CAPS} is required`) }

  const serverMeta = { [META_SERVER]: { name: SERVER_INFO.name, version: SERVER_INFO.version } }
  switch (method) {
    case 'server/discover':
      return {
        status: 200,
        body: rpcResult(id, {
          resultType: 'complete',
          supportedVersions: SUPPORTED_VERSIONS,
          capabilities: { tools: {} },
          instructions: INSTRUCTIONS,
          ttlMs: LIST_TTL_MS,
          cacheScope: 'public',
          _meta: serverMeta,
        }),
      }
    case 'tools/list':
      return { status: 200, body: rpcResult(id, { resultType: 'complete', tools: toolList(), ttlMs: LIST_TTL_MS, cacheScope: 'public', _meta: serverMeta }) }
    case 'tools/call': {
      const r = await callTool(params, deps)
      if ('error' in r) return { status: 200, body: rpcError(id, r.error.code, r.error.message) }
      return { status: 200, body: rpcResult(id, { resultType: 'complete', ...r.result, _meta: serverMeta }) }
    }
    default:
      // 新版規格：不認得的方法回 404＋-32601，用戶端才分得出「新版伺服器但沒有這功能」
      return { status: 404, body: rpcError(id, -32601, `Method not found: ${method}`) }
  }
}

/** 舊版（initialize 握手的世代）請求。 */
async function handleLegacy(msg: Json, id: Id, params: Json, req: McpHttpRequest, deps: ToolDeps): Promise<McpHttpResponse> {
  const method = msg.method as string
  // 2025-06-18 起舊版用戶端在 initialize 之後也會帶 MCP-Protocol-Version；不支援的版本回 400
  const hv = req.header('mcp-protocol-version')
  if (method !== 'initialize' && hv !== null && !SUPPORTED_VERSIONS.includes(hv)) {
    return { status: 400, body: rpcError(id, -32600, `Unsupported MCP-Protocol-Version: ${hv}（支援：${SUPPORTED_VERSIONS.join(', ')}）`) }
  }
  switch (method) {
    case 'initialize': {
      const want = typeof params.protocolVersion === 'string' ? params.protocolVersion : ''
      // 用戶端要的舊版我們有就照它；沒有就回我們最新的舊版，由用戶端決定要不要繼續
      const version = (LEGACY_VERSIONS as readonly string[]).includes(want) ? want : LEGACY_VERSIONS[0]
      return {
        status: 200,
        body: rpcResult(id, {
          protocolVersion: version,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        }),
      }
    }
    case 'ping':
      return { status: 200, body: rpcResult(id, {}) }
    case 'tools/list':
      return { status: 200, body: rpcResult(id, { tools: toolList() }) }
    case 'tools/call': {
      const r = await callTool(params, deps)
      return { status: 200, body: 'error' in r ? rpcError(id, r.error.code, r.error.message) : rpcResult(id, r.result) }
    }
    default:
      return { status: 200, body: rpcError(id, -32601, `Method not found: ${method}`) }
  }
}

/** 處理一則 JSON-RPC 訊息。通知（沒有 id）回 202、沒有內文。 */
async function handleOne(msg: unknown, req: McpHttpRequest, deps: ToolDeps): Promise<McpHttpResponse> {
  if (!isObj(msg) || msg.jsonrpc !== '2.0') return { status: 400, body: rpcError(null, -32600, 'Invalid Request') }
  // 用戶端回給我們的 response（舊版才可能有；我們從不發請求）：收下不處理
  if (msg.method === undefined && ('result' in msg || 'error' in msg)) return { status: 202, body: null }
  if (typeof msg.method !== 'string') return { status: 400, body: rpcError(validId(msg.id) ? msg.id : null, -32600, 'Invalid Request') }
  if (!('id' in msg)) return { status: 202, body: null } // 通知：notifications/initialized、cancelled…
  if (!validId(msg.id)) return { status: 400, body: rpcError(null, -32600, 'Invalid Request: id must be a string or number') }
  const id = msg.id
  const params = msg.params === undefined ? {} : msg.params
  if (!isObj(params)) return { status: 400, body: rpcError(id, -32602, 'Invalid params') }
  const meta = params._meta
  const version = isObj(meta) ? meta[META_VERSION] : undefined
  if (typeof version === 'string') return handleModern(msg, id, params, version, req, deps)
  // 沒帶 _meta 版本：舊版用戶端。但若標頭宣稱新版，就是格式不對的新版請求
  const hv = req.header('mcp-protocol-version')
  if (hv !== null && (MODERN_VERSIONS as readonly string[]).includes(hv)) {
    return { status: 400, body: rpcError(id, -32602, `Invalid params: _meta.${META_VERSION} is required`) }
  }
  return handleLegacy(msg, id, params, req, deps)
}

/** 一個 HTTP POST 進來 → 回什麼。 */
export async function handleMcpPost(req: McpHttpRequest, deps: ToolDeps = {}): Promise<McpHttpResponse> {
  if (req.body === PARSE_ERROR) return { status: 400, body: rpcError(null, -32700, 'Parse error') }
  // 2025-03-26 允許一次送一批；之後的版本不允許，但收到也照順序處理（不影響新版用戶端）
  if (Array.isArray(req.body)) {
    if (req.body.length === 0) return { status: 400, body: rpcError(null, -32600, 'Invalid Request: empty batch') }
    const out: unknown[] = []
    for (const m of req.body) {
      const r = await handleOne(m, req, deps)
      if (r.body !== null) out.push(r.body)
    }
    return out.length ? { status: 200, body: out } : { status: 202, body: null }
  }
  return handleOne(req.body, req, deps)
}
