// 第二輪：解碼圖磚、取顏色，分辨「真圖／單色海面／單色空白／Esri 佔位圖」。
//
// 第一輪發現：NLSC 在涵蓋範圍外回 200 + 單色圖（不是 404），會把底下的地圖整片蓋掉；
// Esri 在外海高倍率回 200 +「Map data not yet available」佔位圖。
// 要決定怎麼疊、要藏哪些圖磚，就得知道這些單色圖是什麼顏色、從第幾層開始。
// 只用公開地標座標，不讀任何 secret。

import { createHash } from 'node:crypto'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'

const SPOTS = {
  '台北101': [25.0340, 121.5645],
  '基隆外海1浬': [25.17, 121.76],
  '綠島外海': [22.60, 121.60],
  '台灣東方外海': [23.0, 124.5],
  '金門': [24.43, 118.32],
  '廈門岸邊': [24.45, 118.08],
}
const ZOOMS = [10, 12, 13, 14, 15, 16, 17, 18, 19]

function tileXY(lat, lng, z) {
  const n = 2 ** z
  const x = Math.floor(((lng + 180) / 360) * n)
  const r = (lat * Math.PI) / 180
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)
  return { x, y }
}

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services'
const NLSC = 'https://wmts.nlsc.gov.tw/wmts'
const PROVIDERS = {
  'Esri街道': (z, x, y) => `${ESRI}/World_Street_Map/MapServer/tile/${z}/${y}/${x}`,
  'Esri衛星': (z, x, y) => `${ESRI}/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
  'Esri海洋': (z, x, y) => `${ESRI}/Ocean/World_Ocean_Base/MapServer/tile/${z}/${y}/${x}`,
  'NLSC地圖': (z, x, y) => `${NLSC}/EMAP/default/GoogleMapsCompatible/${z}/${y}/${x}`,
  'NLSC影像': (z, x, y) => `${NLSC}/PHOTO_MIX/default/GoogleMapsCompatible/${z}/${y}/${x}`,
  'EOX無雲': (z, x, y) =>
    `https://tiles.maps.eox.at/wmts?layer=s2cloudless-2023_3857&style=default&tilematrixset=GoogleMapsCompatible&Service=WMTS&Request=GetTile&Version=1.0.0&Format=image%2Fjpeg&TileMatrix=${z}&TileCol=${x}&TileRow=${y}`,
}

function decode(buf, ct) {
  try {
    if (ct.includes('png')) {
      const p = PNG.sync.read(buf)
      return { w: p.width, h: p.height, d: p.data }
    }
    const j = jpeg.decode(buf, { useTArray: true })
    return { w: j.width, h: j.height, d: j.data }
  } catch {
    return null
  }
}

/** 8×8 格取樣：平均色、最大偏差、alpha。 */
function stats(img) {
  const px = []
  for (let gy = 0; gy < 8; gy++) {
    for (let gx = 0; gx < 8; gx++) {
      const x = Math.floor(((gx + 0.5) / 8) * img.w)
      const y = Math.floor(((gy + 0.5) / 8) * img.h)
      const i = (y * img.w + x) * 4
      px.push([img.d[i], img.d[i + 1], img.d[i + 2], img.d[i + 3]])
    }
  }
  const mean = [0, 1, 2, 3].map((c) => px.reduce((s, p) => s + p[c], 0) / px.length)
  let dev = 0
  for (const p of px) for (let c = 0; c < 3; c++) dev = Math.max(dev, Math.abs(p[c] - mean[c]))
  const corner = px[0]
  return { mean: mean.map(Math.round), dev: Math.round(dev), corner }
}

async function probe(url) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 20000)
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'ArgusPWA-tile-probe/1.0' } })
    const buf = Buffer.from(await res.arrayBuffer())
    const ct = res.headers.get('content-type') || ''
    if (res.status !== 200) return `${res.status}`
    const img = decode(buf, ct)
    if (!img) return `?${buf.length}B`
    const s = stats(img)
    const hex = '#' + s.mean.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('')
    const h = createHash('sha1').update(buf).digest('hex').slice(0, 4)
    // F=單色（無資訊）  R=真圖  ；alpha<250 代表有透明
    const kind = s.dev <= 3 ? 'F' : 'R'
    const a = s.mean[3] < 250 ? `α${s.mean[3]}` : ''
    return `${kind}${hex}${a}·d${s.dev}·${h}`
  } catch (e) {
    return `ERR`
  } finally {
    clearTimeout(t)
  }
}

for (const [name, url] of Object.entries(PROVIDERS)) {
  console.log(`\n████ ${name}`)
  for (const [spot, [lat, lng]] of Object.entries(SPOTS)) {
    const cells = []
    for (const z of ZOOMS) {
      const { x, y } = tileXY(lat, lng, z)
      cells.push(`z${z}:${await probe(url(z, x, y))}`)
    }
    console.log(`  ${spot}\n     ${cells.join('  ')}`)
  }
}
