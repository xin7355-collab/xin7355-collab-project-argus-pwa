// ── MCP 伺服器的 HTTP 入口（/mcp）────────────────────────────
//
// 讓 Claude（網頁、iPhone App）把這個 App 當成「自訂連接器」：在對話裡直接用海域計算工具。
// 協定與工具都在 src/lib/mcpServer.ts、mcpTools.ts（可離線測），這裡只接 HTTP。
//
// 為什麼預設不用登入：工具只做純計算，加上查 adsb.lol 的公開飛機資料，
// 不讀任何金鑰、不碰使用者手機裡的點位，被別人用也洩漏不了東西。
// 擋濫用：只收 POST、限制內文大小、每個 IP 每分鐘有上限（同一台 Worker 內的盡力而為）。
// 想鎖起來的話設 Worker secret MCP_TOKEN：之後要帶 Authorization: Bearer <token>
// （claude.ai 的自訂連接器只支援免登入或 OAuth，設了 token 就只剩能自訂標頭的用戶端能用）。

import { handleMcpPost, PARSE_ERROR } from '../src/lib/mcpServer.ts'
import { adsbSnapshot, snapshotAgeSec } from './adsb.js'
import { json, originAllowed } from './http.js'

const MAX_BODY_BYTES = 64 * 1024
const RATE_WINDOW_MS = 60_000
const RATE_MAX = 120
/** 每個 IP 的請求次數（這台 Worker 實例內；Cloudflare 會開很多實例，所以是盡力而為）。 */
const hits = new Map()

function rateOk(ip, now = Date.now()) {
  const h = hits.get(ip)
  if (!h || now - h.start > RATE_WINDOW_MS) {
    hits.set(ip, { start: now, n: 1 })
    // 順手清掉舊的，Map 不會一直長大
    if (hits.size > 5000) for (const [k, v] of hits) if (now - v.start > RATE_WINDOW_MS) hits.delete(k)
    return true
  }
  h.n++
  return h.n <= RATE_MAX
}

/** 比對 token 不提早結束（避免用回應時間猜 token）。 */
function tokenOk(header, token) {
  const got = (header || '').replace(/^Bearer\s+/i, '')
  let diff = got.length ^ token.length
  for (let i = 0; i < token.length; i++) diff |= (got.charCodeAt(i) || 0) ^ token.charCodeAt(i)
  return diff === 0
}

const rpcErr = (code, message) => ({ jsonrpc: '2.0', error: { code, message } })

export async function handleMcp(request, url, env, ctx) {
  // 規格要求驗 Origin（防 DNS rebinding）。Claude 的連接器從伺服器連過來，不帶 Origin
  if (!originAllowed(request.headers.get('origin'), url)) return json(rpcErr(-32600, 'Forbidden: origin not allowed'), 403)
  if (request.method !== 'POST') {
    // 2026-07-28 拿掉了 GET 串流與 session（DELETE）；舊版用戶端來問就回 405
    return json(rpcErr(-32600, 'Method not allowed: this MCP endpoint only accepts POST (Streamable HTTP)'), 405, { allow: 'POST' })
  }
  if (env.MCP_TOKEN && !tokenOk(request.headers.get('authorization'), env.MCP_TOKEN)) {
    return json(rpcErr(-32600, 'Unauthorized'), 401, { 'www-authenticate': 'Bearer realm="argus-mcp"' })
  }
  if (!rateOk(request.headers.get('cf-connecting-ip') || 'unknown')) {
    return json(rpcErr(-32000, '請求太頻繁，請 1 分鐘後再試'), 429, { 'retry-after': '60' })
  }
  const text = await request.text()
  if (text.length > MAX_BODY_BYTES) return json(rpcErr(-32600, 'Request too large'), 413)
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = PARSE_ERROR
  }
  const deps = {
    fetchAdsb: async (anchor) => {
      const s = await adsbSnapshot(anchor, env, ctx)
      const j = JSON.parse(s.text)
      return { ac: Array.isArray(j.ac) ? j.ac : [], ageSec: snapshotAgeSec(s.sourceMs), stale: s.stale }
    },
  }
  const r = await handleMcpPost({ body, header: (n) => request.headers.get(n) }, deps)
  if (r.body === null) return new Response(null, { status: 202 })
  return json(r.body, r.status)
}
