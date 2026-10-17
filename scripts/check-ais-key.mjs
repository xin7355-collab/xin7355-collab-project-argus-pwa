// AIS 金鑰伺服器端檢查（手動觸發）。
//
// 為什麼要有：App 裡 aisstream「一連上就切斷、不給原因」時，從手機分不出是
//   ① 金鑰本身無效／還沒生效  ② aisstream 擋瀏覽器（官方說不支援瀏覽器直連）
//   ③ 自家轉接被擋  ④ 台灣附近沒接收站
// 這裡從 GitHub 的伺服器用同一把金鑰分別測四種情況，一次分出來。
//
// 公開 repo 的 Actions 紀錄是公開的：只印數量、斷線碼、花了多久，
// 不印金鑰（GitHub 也會遮）、不印任何船名或船位。
import WebSocket from 'ws'
import { appendFileSync } from 'node:fs'

const KEY = (process.env.AISSTREAM_KEY || '').replace(/[\s ​-‍⁠﻿]/g, '')
const APP = 'https://argus-app.xin7355.workers.dev'
const LISTEN_MS = 20_000
const QUICK_MS = 5_000
const CHANNEL = [[50.0, -2.0], [51.5, 2.0]] // 英吉利海峽：全球 AIS 最密集
const TAIWAN = [[21.0, 118.0], [26.5, 124.0]] // App 預設的台灣周邊框（程式碼裡本來就公開）

const out = (s) => {
  console.log(s)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, s + '\n')
}
const redact = (s) => (KEY ? String(s).split(KEY).join('***') : String(s))

if (!KEY) {
  // 還沒設定不算壞掉：安靜結束，不亮紅燈
  out('還沒設定 `AISSTREAM_KEY`。到 repo → Settings → Secrets and variables → Actions 新增後，再手動執行一次。')
  process.exit(0)
}
out(`金鑰長度 ${KEY.length}；${/^[A-Za-z0-9_-]+$/.test(KEY) ? '只有英數與連字號' : '⚠ 含有不像金鑰的字元（多半貼錯）'}`)

function trial(name, url, box, origin) {
  return new Promise((resolve) => {
    const t0 = Date.now()
    let openedAt = null
    let msgs = 0
    let error = ''
    let settled = false
    const ws = new WebSocket(url, origin ? { origin } : {})
    const done = (code, why) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { ws.terminate() } catch {}
      resolve({ name, opened: openedAt !== null, aliveMs: openedAt === null ? null : Date.now() - openedAt, msgs, code, why: redact(why), error: redact(error), totalMs: Date.now() - t0 })
    }
    let timer = setTimeout(() => done(0, '握手逾時'), 15_000)
    ws.on('unexpected-response', (_q, res) => done(res.statusCode, `握手被拒 HTTP ${res.statusCode}`))
    ws.on('open', () => {
      openedAt = Date.now()
      clearTimeout(timer)
      timer = setTimeout(() => done(1000, '聽滿 20 秒'), LISTEN_MS)
      ws.send(JSON.stringify({ APIKey: KEY, BoundingBoxes: [box], FilterMessageTypes: ['PositionReport'] }))
    })
    ws.on('message', (d) => {
      try {
        const m = JSON.parse(String(d))
        if (m?.MetaData && m?.MessageType) msgs++
        else if (!error) error = String(m?.error || m?.Error || JSON.stringify(m)).slice(0, 120)
      } catch {
        if (!error) error = String(d).slice(0, 120)
      }
    })
    ws.on('close', (code, reason) => done(code, `對方關閉 ${code} ${String(reason).slice(0, 80)}`))
    ws.on('error', (e) => { if (!error) error = e.message })
  })
}

const AIS = 'wss://stream.aisstream.io/v0/stream'
const RELAY = 'wss://argus-app.xin7355.workers.dev/api/ais'
const plan = [
  ['A 伺服器直連・英吉利海峽', AIS, CHANNEL, null],
  ['B 伺服器直連・台灣周邊', AIS, TAIWAN, null],
  ['C 帶瀏覽器來源直連・英吉利海峽', AIS, CHANNEL, APP],
  ['D 經本站轉接・英吉利海峽', RELAY, CHANNEL, APP],
]
const r = {}
out('\n| 測試 | 連上 | 活多久 | 收到船位 | 怎麼結束 | 伺服器訊息 |\n|---|---|---|---|---|---|')
for (const [name, url, box, origin] of plan) {
  // 一個一個來：免費金鑰同時多條連線可能互相擠掉，測出來會不準
  const t = await trial(name, url, box, origin)
  r[name[0]] = t
  out(`| ${name} | ${t.opened ? '是' : '否'} | ${t.aliveMs === null ? '—' : (t.aliveMs / 1000).toFixed(1) + ' 秒'} | ${t.msgs} | ${t.why} | ${t.error || '—'} |`)
  await new Promise((s) => setTimeout(s, 3000))
}

const quick = (t) => t.opened && t.msgs === 0 && (t.aliveMs ?? 0) < QUICK_MS
out('\n### 結論')
let broken = false
if (!r.A.opened) {
  out('- ❌ 連不上 aisstream（握手就失敗）。多半是對方停機，晚點再跑一次。')
  broken = true
} else if (r.A.msgs === 0) {
  out(quick(r.A)
    ? '- ❌ **金鑰無效**：從伺服器直連、不經過瀏覽器，一樣一連上就被切斷。到 aisstream.io → API Keys 確認金鑰還在、重新複製；剛建立的金鑰可以等幾分鐘再試。'
    : '- ❓ 連得上但英吉利海峽 20 秒都沒有船位，可能是 aisstream 暫時故障，晚點再跑一次。')
  broken = true
} else {
  out(`- ✅ **金鑰有效**（英吉利海峽 20 秒收到 ${r.A.msgs} 筆）。`)
  out(r.B.msgs > 0 ? `- ✅ 台灣周邊也有資料（20 秒 ${r.B.msgs} 筆）。` : '- ⚠ 台灣周邊 20 秒 0 筆：這一帶 aisstream 的接收站很少或沒有，App 看不到船是資料源的限制。')
  if (r.C.msgs === 0) out('- ❌ **aisstream 擋瀏覽器**：同一把金鑰帶瀏覽器來源就被切斷。App 必須走本站轉接。')
  else out('- ✅ 帶瀏覽器來源也收得到。')
  if (r.D.msgs === 0) { out('- ❌ **本站轉接不通**：金鑰沒問題，但經 Cloudflare Worker 轉接收不到。要修轉接。'); broken = true }
  else out('- ✅ 本站轉接收得到。')
}
// 真的壞掉才亮紅燈；金鑰有效時就算台灣沒資料也是綠燈（那是資料源限制，不是壞掉）
process.exit(broken ? 1 : 0)
