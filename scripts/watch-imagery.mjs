// 排程盯梢：你關注的海域一有新衛星影像就推播。
//
// 跑法（GitHub Actions 會這樣叫）：
//   node --experimental-strip-types scripts/watch-imagery.mjs
//   node --experimental-strip-types scripts/watch-imagery.mjs --self-test
//
// 需要的環境變數：
//   WATCH_BBOX   "west,south,east,north"（放 secret，不要 commit——本 repo 是公開的）
//   NTFY_TOPIC   ntfy.sh 的主題名（放 secret；等同通行證，取長一點）
//   WATCH_HOURS  往回看幾小時（可選，預設 7；排程每 6 小時跑，多 1 小時當重疊緩衝）
//   NTFY_BASE    可選，預設 https://ntfy.sh（自架 ntfy 時改這裡）
//   CATALOG_BASE 可選，預設 Copernicus 公開目錄（走代理時改這裡）
//
// 設計上「完全不存狀態」：每次只看最近一個時間窗，有就通知、沒有就閉嘴。
// 不把 last-seen 寫回 repo，因為那會洩漏你在盯哪片海。

import {
  buildCatalogUrl,
  decideNotify,
  parseBbox,
  parseScenes,
} from '../src/lib/imageryWatch.ts'

const selfTest = process.argv.includes('--self-test')

function need(name) {
  const v = (process.env[name] || '').trim()
  if (!v) {
    console.error(`::error::缺少 ${name}。到 Settings → Secrets and variables → Actions 新增。`)
    process.exit(1)
  }
  return v
}

async function getJson(url, timeoutMs = 20000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`目錄服務回應 ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

const NTFY_BASE = (process.env.NTFY_BASE || 'https://ntfy.sh').replace(/\/+$/, '')
const CATALOG = (process.env.CATALOG_BASE || '').replace(/\/+$/, '') || undefined

async function notify(topic, title, body) {
  const res = await fetch(`${NTFY_BASE}/${encodeURIComponent(topic)}`, {
    method: 'POST',
    headers: {
      // 標題與標籤要用 RFC 2047 之外的安全寫法：ntfy 的 header 只吃 ASCII，
      // 中文標題改放在內文第一行，header 用英數字，才不會整則被丟掉。
      Title: 'Argus: new satellite imagery',
      Tags: 'satellite',
      Priority: 'default',
    },
    body: `${title}\n${body}`,
  })
  if (!res.ok) throw new Error(`ntfy 回應 ${res.status}`)
}

async function main() {
  const topic = need('NTFY_TOPIC')

  if (selfTest) {
    // 在真的排程之前，先確認整條推播管線通不通——
    // 不查目錄、不碰範圍，純粹驗「訊息送不送得到你手機」。
    await notify(topic, '阿爾戈斯：通知管線測試', '收到這則就表示排程盯梢設定成功了。')
    console.log('已送出測試推播。手機沒收到就是 ntfy 主題名對不上。')
    return
  }

  const box = parseBbox(need('WATCH_BBOX'))
  const hours = Number(process.env.WATCH_HOURS || 7)
  const now = Date.now()
  const from = now - (Number.isFinite(hours) && hours > 0 ? hours : 7) * 3600_000

  const all = []
  const failed = []
  for (const [coll, label] of [
    ['Sentinel2', 'Sentinel-2'],
    ['Sentinel1', 'Sentinel-1'],
  ]) {
    try {
      const j = await getJson(buildCatalogUrl(coll, box, from, now, 50, CATALOG))
      all.push(...parseScenes(j, label))
    } catch (e) {
      // 一個來源掛掉不該讓另一個也不跑
      failed.push(`${label}：${e.message}`)
    }
  }

  if (failed.length === 2) {
    console.error(`::error::兩個目錄來源都查不到 — ${failed.join('；')}`)
    process.exit(1)
  }
  if (failed.length) console.log(`::warning::部分來源查詢失敗 — ${failed.join('；')}`)

  const v = decideNotify(all, now)
  if (!v.notify) {
    console.log(`最近 ${hours} 小時沒有新影像，不通知。`)
    return
  }
  await notify(topic, v.title, v.body)
  // 刻意只印數量，不印座標或場景編號——Actions log 在公開 repo 是公開的
  console.log(`已通知：${v.count} 筆新影像。`)
}

main().catch((e) => {
  console.error(`::error::盯梢失敗：${e.message}`)
  process.exit(1)
})
