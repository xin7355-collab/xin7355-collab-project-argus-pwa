// 第三輪：NLSC 有沒有「只有中文注記、背景透明」的圖層？
// 有的話衛星圖就能疊上中文地名（像 Google 的衛星混合），而不用拿 NLSC 自己的
// 影像——NLSC 影像的海面是一整片假的單色，蓋掉 Esri 真的海面影像（看得到船）。
// 讀 GetCapabilities 列出所有圖層與格式，再實際抓台北一張看是不是透明。

import { PNG } from 'pngjs'

const CAP = 'https://wmts.nlsc.gov.tw/wmts?SERVICE=WMTS&REQUEST=GetCapabilities&VERSION=1.0.0'
const res = await fetch(CAP, { headers: { 'User-Agent': 'ArgusPWA-tile-probe/1.0' } })
const xml = await res.text()
console.log('GetCapabilities', res.status, xml.length, 'bytes')

const layers = []
for (const m of xml.matchAll(/<Layer>([\s\S]*?)<\/Layer>/g)) {
  const body = m[1]
  const id = body.match(/<ows:Identifier>([^<]+)<\/ows:Identifier>/)?.[1]
  const title = body.match(/<ows:Title>([^<]+)<\/ows:Title>/)?.[1]
  const fmts = [...body.matchAll(/<Format>([^<]+)<\/Format>/g)].map((x) => x[1]).join(',')
  const gm = /GoogleMapsCompatible/.test(body)
  if (id) layers.push({ id, title, fmts, gm })
}
console.log(`共 ${layers.length} 個圖層。含「注記／標註／透明／地名」字樣或 png 格式的：`)
for (const l of layers) {
  if (/注記|標註|註記|透明|地名|道路|文字|label/i.test(l.title || '') || /png/.test(l.fmts)) {
    console.log(`  ${l.id.padEnd(16)} ${l.fmts.padEnd(20)} GM=${l.gm ? 'Y' : 'n'}  ${l.title}`)
  }
}
console.log('\n全部圖層 id：', layers.map((l) => l.id).join(' '))

// 台北 101 z16，實際抓幾個候選看透明度
function tileXY(lat, lng, z) {
  const n = 2 ** z
  const x = Math.floor(((lng + 180) / 360) * n)
  const r = (lat * Math.PI) / 180
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)
  return { x, y }
}
const cands = layers.filter((l) => /png/.test(l.fmts) && l.gm).map((l) => l.id).slice(0, 12)
const { x, y } = tileXY(25.034, 121.5645, 16)
console.log('\n實際抓台北101 z16（png 候選）：')
for (const id of cands) {
  const u = `https://wmts.nlsc.gov.tw/wmts/${id}/default/GoogleMapsCompatible/16/${y}/${x}`
  try {
    const r = await fetch(u, { headers: { 'User-Agent': 'ArgusPWA-tile-probe/1.0' } })
    const buf = Buffer.from(await r.arrayBuffer())
    let note = `${r.status} ${r.headers.get('content-type')} ${buf.length}B`
    if (r.ok && (r.headers.get('content-type') || '').includes('png')) {
      const p = PNG.sync.read(buf)
      let transparent = 0
      for (let i = 3; i < p.data.length; i += 4) if (p.data[i] < 10) transparent++
      note += ` 透明比例 ${Math.round((transparent / (p.width * p.height)) * 100)}%`
    }
    console.log(`  ${id.padEnd(16)} ${note}`)
  } catch (e) {
    console.log(`  ${id.padEnd(16)} ERR ${e.message}`)
  }
}
