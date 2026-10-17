// 第四輪：EMAP2／EMAP7／EMAP12 是什麼（標題），透明圖層在海上與高倍率的行為。
import { PNG } from 'pngjs'
const CAP = 'https://wmts.nlsc.gov.tw/wmts?SERVICE=WMTS&REQUEST=GetCapabilities&VERSION=1.0.0'
const xml = await (await fetch(CAP, { headers: { 'User-Agent': 'ArgusPWA-tile-probe/1.0' } })).text()
for (const m of xml.matchAll(/<Layer>([\s\S]*?)<\/Layer>/g)) {
  const id = m[1].match(/<ows:Identifier>([^<]+)<\/ows:Identifier>/)?.[1]
  if (!/^EMAP/.test(id || '') && id !== 'PHOTO2' && id !== 'PHOTO_MIX') continue
  const title = m[1].match(/<ows:Title>([^<]+)<\/ows:Title>/)?.[1]
  const fmt = [...m[1].matchAll(/<Format>([^<]+)<\/Format>/g)].map((x) => x[1]).join(',')
  console.log(`${id.padEnd(16)} ${fmt.padEnd(12)} ${title}`)
}
function tileXY(lat, lng, z) {
  const n = 2 ** z, x = Math.floor(((lng + 180) / 360) * n), r = (lat * Math.PI) / 180
  return { x, y: Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n) }
}
const SPOTS = { '台北101': [25.034, 121.5645], '基隆港': [25.1315, 121.7418], '綠島外海': [22.6, 121.6], '廈門岸邊': [24.45, 118.08] }
console.log('\n透明圖層：透明比例 / 有內容的像素 / 主色')
for (const id of ['EMAP2', 'EMAP7', 'EMAP12']) {
  for (const [spot, [lat, lng]] of Object.entries(SPOTS)) {
    const cells = []
    for (const z of [12, 16, 19]) {
      const { x, y } = tileXY(lat, lng, z)
      const r = await fetch(`https://wmts.nlsc.gov.tw/wmts/${id}/default/GoogleMapsCompatible/${z}/${y}/${x}`, { headers: { 'User-Agent': 'ArgusPWA-tile-probe/1.0' } })
      const buf = Buffer.from(await r.arrayBuffer())
      if (!r.ok || !(r.headers.get('content-type') || '').includes('png')) { cells.push(`z${z}:${r.status}`); continue }
      const p = PNG.sync.read(buf)
      let t = 0, rs = 0, gs = 0, bs = 0, k = 0
      for (let i = 0; i < p.data.length; i += 4) {
        if (p.data[i + 3] < 10) { t++; continue }
        rs += p.data[i]; gs += p.data[i + 1]; bs += p.data[i + 2]; k++
      }
      const hex = k ? '#' + [rs, gs, bs].map((v) => Math.round(v / k).toString(16).padStart(2, '0')).join('') : '-'
      cells.push(`z${z}:${Math.round((t / (p.width * p.height)) * 100)}%透明 ${hex}`)
    }
    console.log(`  ${id.padEnd(7)} ${spot.padEnd(6, '　')} ${cells.join('  ')}`)
  }
}
