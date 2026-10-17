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
  MAX_RETRIES,
  buildCatalogUrl,
  decideNotify,
  parseScenes,
  planUnconfiguredExit,
  readWatchConfig,
  retryDelayMs,
  shouldRetry,
} from '../src/lib/imageryWatch.ts'

const selfTest = process.argv.includes('--self-test')
// 手動觸發時使用者「正在設定、想知道結果」，缺東西要紅燈；
// 排程遇到沒設定要安靜跳過，不然每 6 小時亮一次紅燈吵人。
const requireConfig = process.argv.includes('--require-config')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 帶退避重試的請求。
 *
 * 為什麼值得重試：這支腳本每 6 小時才跑一次。上游一次暫時性的 503，
 * 代價不是「晚一點拿到」，而是「這一輪完全沒通知」——真的有新影像也不會知道。
 * 重試政策（哪些狀態碼、等多久、怎麼讀 Retry-After）在 imageryWatch.ts，有單元測試。
 *
 * 連線層的失敗（DNS、逾時、連線被重置）同樣重試：海上網路本來就會斷斷續續。
 */
async function fetchRetry(url, init = {}, timeoutMs = 20000, label = '上游') {
  let lastErr
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal })
      if (res.ok) return res
      if (!shouldRetry(res.status) || attempt === MAX_RETRIES) {
        throw new Error(`${label}回應 ${res.status}`)
      }
      const wait = retryDelayMs(attempt + 1, res.headers.get('retry-after'))
      console.log(`::notice::${label} ${res.status}，${Math.round(wait / 1000)} 秒後重試（第 ${attempt + 1}/${MAX_RETRIES} 次）`)
      await sleep(wait)
    } catch (e) {
      // 非 HTTP 的失敗（逾時、連線被重置）也重試，但自己丟的錯誤不要再吞一次
      if (e instanceof Error && e.message.startsWith(label)) throw e
      lastErr = e
      if (attempt === MAX_RETRIES) break
      const wait = retryDelayMs(attempt + 1)
      console.log(`::notice::${label}連線失敗，${Math.round(wait / 1000)} 秒後重試（第 ${attempt + 1}/${MAX_RETRIES} 次）`)
      await sleep(wait)
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error(`${label}連線失敗：${lastErr instanceof Error ? lastErr.message : lastErr}`)
}

async function getJson(url, timeoutMs = 20000) {
  const res = await fetchRetry(url, {}, timeoutMs, '目錄服務')
  return await res.json()
}

const NTFY_BASE = (process.env.NTFY_BASE || 'https://ntfy.sh').replace(/\/+$/, '')
const CATALOG = (process.env.CATALOG_BASE || '').replace(/\/+$/, '') || undefined

async function notify(topic, title, body) {
  // 推播比查目錄更不能漏：查目錄失敗頂多這輪沒看，推播失敗是「有新影像卻沒告訴你」。
  await fetchRetry(
    `${NTFY_BASE}/${encodeURIComponent(topic)}`,
    {
      method: 'POST',
      headers: {
        // 標題與標籤要用 RFC 2047 之外的安全寫法：ntfy 的 header 只吃 ASCII，
        // 中文標題改放在內文第一行，header 用英數字，才不會整則被丟掉。
        Title: 'Argus: new satellite imagery',
        Tags: 'satellite',
        Priority: 'default',
      },
      body: `${title}\n${body}`,
    },
    20000,
    'ntfy',
  )
}

async function main() {
  const cfg = readWatchConfig(process.env)

  if (!cfg.ok) {
    if (cfg.error) {
      // 填了但填錯 ≠ 還沒設定，這是真的壞掉
      console.error(`::error::WATCH_BBOX 設定有誤：${cfg.error}`)
      process.exit(1)
    }
    const plan = planUnconfiguredExit(cfg.missing, requireConfig)
    console.log(`::${plan.level}::${plan.message}`)
    process.exit(plan.code)
  }

  const { topic, bbox: box, hours } = cfg.config

  if (selfTest) {
    // 在真的排程之前，先確認整條推播管線通不通——
    // 不查目錄、不碰範圍，純粹驗「訊息送不送得到你手機」。
    await notify(topic, '阿爾戈斯：通知管線測試', '收到這則就表示排程盯梢設定成功了。')
    console.log('已送出測試推播。手機沒收到就是 ntfy 主題名對不上。')
    return
  }

  const now = Date.now()
  const from = now - hours * 3600_000

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

  // 只印數量，不印座標也不印場景編號——公開 repo 的 Actions log 是公開的。
  // 但數量一定要印：沒有它就分不出「查詢成功、真的沒有新影像」和
  // 「查詢其實壞了、只是沒報錯」，而這兩件事的處置完全不同。
  console.log(`目錄查詢成功，時間窗內共 ${all.length} 筆。`)

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
