// ── 無人機禁限航區資料（/drone/…，靜態檔）────────────────────────────
//
// 資料是部署時從 Release「drone-zones」解開放進 dist/drone/ 的靜態檔（見 deploy.yml）。
// 檔案存在時，Cloudflare 的靜態資源層直接回應，根本不會跑到這裡（實測：回應標頭是靜態資源的預設值）；
// 會跑到這裡的只有「檔案不存在」與非 GET 的請求。
//
// 為什麼要管檔案不存在：靜態資源開了 SPA 模式，找不到的路徑會回 index.html（200），
// App 會把一頁 HTML 當成 JSON 去解析，分不出「還沒準備好」和「壞掉」。這裡改回 404＋code: not_ready。

import { json } from './http.js'

export async function serveDrone(request, env) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: '只接受 GET' }, 405, { allow: 'GET, HEAD' })
  const res = await env.ASSETS.fetch(request)
  const type = res.headers.get('content-type') || ''
  // 保險：哪天改成 Worker 先跑（run_worker_first），存在的檔案照樣回
  if (res.status === 304 || (res.status === 200 && type.includes('json'))) return res
  return json(
    {
      error: '無人機禁限航區資料還沒準備好：每日同步跑過一次、重新部署後就有（GitHub → Actions →「無人機禁限航區資料」→ Run workflow）',
      code: 'not_ready',
    },
    404,
    { 'cache-control': 'no-store' },
  )
}
