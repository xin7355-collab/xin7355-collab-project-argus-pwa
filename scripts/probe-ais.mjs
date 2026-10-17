// 暫時性探測：aisstream 是不是擋瀏覽器？
// 用假金鑰比較「帶瀏覽器 Origin」與「不帶 Origin（像伺服器）」的反應。
// 不需要真金鑰——只看伺服器怎麼回。不讀任何 secret。
import WebSocket from 'ws'

const TARGETS = (process.env.TARGETS || 'wss://stream.aisstream.io/v0/stream').split(',')
const ORIGIN = 'https://argus-app.xin7355.workers.dev'

function trial(url, origin) {
  return new Promise((resolve) => {
    const t0 = Date.now()
    const log = []
    const ws = new WebSocket(url, origin ? { origin } : {})
    const done = (why) => { try { ws.terminate() } catch {}; resolve(`${why}｜${log.join('｜')}｜${Date.now() - t0}ms`) }
    const timer = setTimeout(() => done('15 秒無回應'), 15000)
    ws.on('unexpected-response', (_q, res) => { clearTimeout(timer); done(`握手被拒 HTTP ${res.statusCode}`) })
    ws.on('open', () => {
      log.push('已連上')
      ws.send(JSON.stringify({ APIKey: 'probe-not-a-real-key', BoundingBoxes: [[[21, 118], [26, 124]]] }))
    })
    ws.on('message', (d) => { log.push(`收到「${String(d).slice(0, 80)}」`) })
    ws.on('close', (code, reason) => { clearTimeout(timer); done(`關閉 ${code} ${String(reason).slice(0, 60)}`) })
    ws.on('error', (e) => log.push(`錯誤 ${e.message}`))
  })
}

for (const url of TARGETS) {
  console.log(`\n${url}`)
  console.log('  帶瀏覽器 Origin：', await trial(url, ORIGIN))
  console.log('  不帶 Origin    ：', await trial(url, null))
}
