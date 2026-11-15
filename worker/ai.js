// ── 語音助理（/api/ai）───────────────────────────────────────
//
// App 把使用者說的話（與使用者同意時的地圖中心）送來，這裡讓 AI 決定要用哪個計算工具、
// 用 App 自己的工具算（src/lib/mcpTools.ts），再把結果講成一句話（src/lib/assistant.ts 的 runAgent）。
//
// AI 呼叫一律走 skl 的 ai-model-router（worker/vendor/model_router.cjs，原樣複製）：只寫等級、
// 不寫死模型名稱，模型下架自動換、不合格自動升級、付費的逾時不重送、一次最多送幾次有上限。
// 供應商照順序試：免費的 Groq、Gemini 先，再 OpenRouter 的免費模型，最後才是付費的 Claude。
//
// 金鑰都是 Worker secret（GitHub Secrets 經 deploy.yml 同步過來），瀏覽器拿不到；
// App 要帶 x-argus-ai-token（使用者在 ⚙️ 設定填的通行碼）才給用，不然任何人都能用掉你的額度。
// 「還沒設定」（沒有通行碼或沒有任何金鑰）回 503＋code: unconfigured，App 會安靜地顯示灰燈，不當成故障。
//
// 更新路由模組：從 skl 的 xin-toolkit/skills/ai-model-router/assets/ 複製 model_router.js（改名 .cjs）
// 與 router_cases.json 蓋掉 worker/vendor/ 裡的，跑 npm test（含它的自我測試）。

import routerPkg from './vendor/model_router.cjs'
import { runAgent, MAX_QUESTION_CHARS } from '../src/lib/assistant.ts'
import { TOOLS, TOOL_BY_NAME } from '../src/lib/mcpTools.ts'
import { adsbSnapshot, snapshotAgeSec } from './adsb.js'
import { json, originAllowed } from './http.js'

const { ModelRouter } = routerPkg

/** 免費的先試；Claude 收費，排最後（只有設了它的金鑰才會用到）。 */
const PROVIDERS = [
  { id: 'groq', env: 'GROQ_API_KEY' },
  { id: 'gemini', env: 'GEMINI_API_KEY' },
  { id: 'openrouter', env: 'OPENROUTER_API_KEY' },
  { id: 'anthropic', env: 'ANTHROPIC_API_KEY' },
]
const MAX_BODY_BYTES = 8 * 1024
/** 每個 IP 每分鐘最多問幾次：正常講話用不到，擋的是程式狂打把額度用光。 */
const RATE_MAX = 20
const RATE_WINDOW_MS = 60_000
/** 每一家一次 chat() 最多送幾次請求（router 預設 12；語音問答要快，失敗就換下一家）。 */
const MAX_CALLS_PER_PROVIDER = 6

const hits = new Map()
function rateOk(ip, now = Date.now()) {
  const h = hits.get(ip)
  if (!h || now - h.start > RATE_WINDOW_MS) {
    hits.set(ip, { start: now, n: 1 })
    if (hits.size > 2000) for (const [k, v] of hits) if (now - v.start > RATE_WINDOW_MS) hits.delete(k)
    return true
  }
  h.n++
  return h.n <= RATE_MAX
}

/** 比對通行碼不提早結束（避免用回應時間猜）。 */
function tokenOk(got, want) {
  const g = got || ''
  let diff = g.length ^ want.length
  for (let i = 0; i < want.length; i++) diff |= (g.charCodeAt(i) || 0) ^ want.charCodeAt(i)
  return diff === 0
}

/** 只收合理的情境欄位，其他丟掉。 */
function cleanContext(c) {
  const out = {}
  if (c && typeof c === 'object') {
    const ce = c.center
    if (ce && Number.isFinite(ce.lat) && Number.isFinite(ce.lng) && Math.abs(ce.lat) <= 90 && Math.abs(ce.lng) <= 180) {
      out.center = { lat: ce.lat, lng: ce.lng }
    }
    if (typeof c.nowIso === 'string' && c.nowIso.length <= 40 && Number.isFinite(Date.parse(c.nowIso))) out.nowIso = c.nowIso
  }
  return out
}

export async function handleAi(request, url, env, ctx) {
  if (request.method !== 'POST') return json({ error: '只接受 POST' }, 405, { allow: 'POST' })
  if (!originAllowed(request.headers.get('origin'), url)) return json({ error: '不接受其他網站的請求' }, 403)

  const configured = PROVIDERS.filter((p) => typeof env[p.env] === 'string' && env[p.env].trim())
  if (!env.AI_ACCESS_TOKEN || configured.length === 0) {
    const missing = [!env.AI_ACCESS_TOKEN && 'AI_ACCESS_TOKEN（通行碼）', configured.length === 0 && '至少一把 AI 金鑰（例如免費的 GROQ_API_KEY）']
      .filter(Boolean)
      .join('、')
    return json(
      { error: `伺服器還沒設定好：GitHub → Settings → Secrets → Actions 加上 ${missing}，再到 Actions 重跑一次部署`, code: 'unconfigured' },
      503,
    )
  }
  if (!tokenOk(request.headers.get('x-argus-ai-token'), env.AI_ACCESS_TOKEN)) {
    return json({ error: '通行碼不對：⚙️ 設定裡的語音助理通行碼要跟 GitHub Secrets 的 AI_ACCESS_TOKEN 一模一樣（改過 Secret 要重新部署）' }, 401)
  }
  if (!rateOk(request.headers.get('cf-connecting-ip') || 'unknown')) {
    return json({ error: '問得太快了，請 1 分鐘後再試' }, 429, { 'retry-after': '60' })
  }

  const text = await request.text()
  if (text.length > MAX_BODY_BYTES) return json({ error: '問題太長' }, 413)
  let body
  try {
    body = JSON.parse(text)
  } catch {
    return json({ error: '請求格式不對' }, 400)
  }
  const question = typeof body?.question === 'string' ? body.question.slice(0, MAX_QUESTION_CHARS) : ''
  const context = cleanContext(body?.context)

  // 只在本機驗證時用：把各家 AI 的網址換成本機假伺服器（跟 ADSB_BASE、CELESTRAK_BASE 一樣的做法）。
  // 正式環境不要設；設了金鑰會送到那個網址去。
  const testFetch = env.AI_TEST_BASE
    ? (input, init) => fetch(String(input).replace(/^https:\/\/([^/]+)/, `${env.AI_TEST_BASE}/$1`), init)
    : undefined

  const deps = {
    tools: TOOLS,
    runTool: async (name, args) => {
      const t = TOOL_BY_NAME.get(name)
      if (!t) throw new Error(`沒有 ${name} 這個工具`)
      return t.run(args, {
        now: () => new Date(),
        fetchAdsb: async (anchor) => {
          const s = await adsbSnapshot(anchor, env, ctx)
          const j = JSON.parse(s.text)
          return { ac: Array.isArray(j.ac) ? j.ac : [], ageSec: snapshotAgeSec(s.sourceMs), stale: s.stale }
        },
      })
    },
    chat: async (messages, validate) => {
      const errors = []
      for (const p of configured) {
        const keys = env[p.env].split(',').map((k) => k.trim()).filter(Boolean)
        try {
          // log 關掉：router 的訊息不含金鑰，但 Worker 的紀錄別人看不到也用不到，省得雜
          const r = new ModelRouter(p.id, { keys, log: () => {}, maxCalls: MAX_CALLS_PER_PROVIDER, ...(testFetch ? { fetch: testFetch } : {}) })
          return await r.chat('fast', messages, { validate, maxTokens: 500 })
        } catch (e) {
          errors.push(`${p.id}：${e instanceof Error ? e.message.slice(0, 160) : '失敗'}`)
        }
      }
      throw new Error(`AI 暫時用不了（${errors.join('；')}）。多半是額度用完或供應商忙，稍後再試`)
    },
  }

  try {
    const r = await runAgent(question, context, deps)
    return json(r, 200)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message.slice(0, 600) : '語音助理出錯，稍後再試' }, 502)
  }
}
