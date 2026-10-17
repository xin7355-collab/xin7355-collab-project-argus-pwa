// 暫時性探測：各家底圖在高倍率下「真的有圖」嗎？
//
// 為什麼要實測：使用者說「看不到更精細的地圖，比 Google Map 還弱」。
// 要換預設底圖、調 maxNativeZoom，就得知道每家在 z17/z19 是真圖、
// 404、還是「回 200 但其實是『尚無資料』的佔位圖」（Esri 在偏遠處會這樣）。
// 開發沙箱連不到圖磚主機，所以借 GitHub Actions 打真的伺服器。
//
// 隱私：只用公開地標座標，不讀任何 secret。
// 判斷佔位圖：同一家在不同地點回「一模一樣的位元組」＝佔位圖，所以印雜湊。

import { createHash } from 'node:crypto'

const SPOTS = {
  '台北101': [25.0340, 121.5645],
  '基隆港': [25.1315, 121.7418],
  '高雄港': [22.6148, 120.2810],
  '綠島外海': [22.60, 121.60],
  '台灣東方外海': [23.0, 124.5],
  '新加坡港': [1.2644, 103.8222],
}

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
  'Esri 街道 World_Street_Map': (z, x, y) => `${ESRI}/World_Street_Map/MapServer/tile/${z}/${y}/${x}`,
  'Esri 衛星 World_Imagery': (z, x, y) => `${ESRI}/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
  'Esri 地名標註 Boundaries_and_Places': (z, x, y) => `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/${z}/${y}/${x}`,
  'Esri 道路標註 Transportation': (z, x, y) => `${ESRI}/Reference/World_Transportation/MapServer/tile/${z}/${y}/${x}`,
  'Esri 海洋底圖 Ocean_Base': (z, x, y) => `${ESRI}/Ocean/World_Ocean_Base/MapServer/tile/${z}/${y}/${x}`,
  'Esri 海洋標註 Ocean_Reference': (z, x, y) => `${ESRI}/Ocean/World_Ocean_Reference/MapServer/tile/${z}/${y}/${x}`,
  'Esri 暗灰（現行預設）': (z, x, y) => `${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/${z}/${y}/${x}`,
  'NLSC 通用電子地圖 EMAP': (z, x, y) => `${NLSC}/EMAP/default/GoogleMapsCompatible/${z}/${y}/${x}`,
  'NLSC 透明注記 EMAP5': (z, x, y) => `${NLSC}/EMAP5/default/GoogleMapsCompatible/${z}/${y}/${x}`,
  'NLSC 正射影像 PHOTO2': (z, x, y) => `${NLSC}/PHOTO2/default/GoogleMapsCompatible/${z}/${y}/${x}`,
  'NLSC 影像+注記 PHOTO_MIX': (z, x, y) => `${NLSC}/PHOTO_MIX/default/GoogleMapsCompatible/${z}/${y}/${x}`,
}

const ZOOMS = [14, 17, 19]

async function get(url) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 20000)
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'ArgusPWA-tile-probe/1.0' } })
    const buf = Buffer.from(await res.arrayBuffer())
    return {
      status: res.status,
      ct: (res.headers.get('content-type') || '').split(';')[0],
      cors: res.headers.get('access-control-allow-origin') || '-',
      size: buf.length,
      hash: createHash('sha1').update(buf).digest('hex').slice(0, 8),
    }
  } catch (e) {
    return { status: 0, ct: e.name, cors: '-', size: 0, hash: '-' }
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
      const r = await get(url(z, x, y))
      cells.push(`z${z}:${r.status} ${r.ct.replace('image/', '')} ${r.size}B #${r.hash}`)
      if (z === ZOOMS[0]) cells[0] += ` cors=${r.cors}`
    }
    console.log(`  ${spot.padEnd(8, '　')} ${cells.join(' │ ')}`)
  }
}
