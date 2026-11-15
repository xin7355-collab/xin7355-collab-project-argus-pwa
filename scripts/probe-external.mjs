// 暫時性探測（量完就刪）：比較 GIBS 各 VIIRS 夜間圖層哪個看得到漁船燈火。
// 只抓兩塊固定的公開圖磚（東海、台灣海峽，第 6 層），不讀任何 secret。
import { inflateSync } from 'node:zlib'

const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best'
const DATE = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
const TILES = [
  ['東海', 6, 26, 54],
  ['台灣海峽', 6, 27, 53],
]
const CANDIDATES = [
  'VIIRS_NOAA20_DayNightBand_At_Sensor_Radiance',
  'VIIRS_NOAA21_DayNightBand_At_Sensor_Radiance',
  'VIIRS_NOAA20_DayNightBand',
  'VIIRS_NOAA21_DayNightBand',
  'VIIRS_NOAA20_DayNightBand_AtSensor_M15',
]

// 讀 capabilities 拿每個圖層的格式與網址樣板
const caps = await (await fetch(`${GIBS}/1.0.0/WMTSCapabilities.xml`)).text()
const info = {}
for (const chunk of caps.split('<Layer>').slice(1)) {
  const id = chunk.match(/<ows:Identifier>([^<]+)<\/ows:Identifier>/)?.[1]
  if (!CANDIDATES.includes(id)) continue
  info[id] = {
    title: chunk.match(/<ows:Title[^>]*>([^<]+)<\/ows:Title>/)?.[1],
    format: chunk.match(/<Format>([^<]+)<\/Format>/)?.[1],
    matrix: chunk.match(/<TileMatrixSet>([^<]+)<\/TileMatrixSet>/)?.[1],
    template: chunk.match(/template="([^"]+)"/)?.[1],
  }
}

// 最小 PNG 解碼（8-bit 灰階／RGB／RGBA／調色盤），只為了算亮度
function decodePng(buf) {
  let pos = 8
  let w, h, depth, ctype
  const idat = []
  let palette = null
  let trns = null
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0)
      h = data.readUInt32BE(4)
      depth = data[8]
      ctype = data[9]
    } else if (type === 'PLTE') palette = data
    else if (type === 'tRNS') trns = data
    else if (type === 'IDAT') idat.push(data)
    pos += 12 + len
  }
  if (depth !== 8) return { w, h, depth, ctype, lum: null }
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype]
  const raw = inflateSync(Buffer.concat(idat))
  const stride = w * ch
  const out = Buffer.alloc(h * stride)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? out[y * stride + x - ch] : 0
      const b = y > 0 ? out[(y - 1) * stride + x] : 0
      const c = x >= ch && y > 0 ? out[(y - 1) * stride + x - ch] : 0
      let v = raw[y * (stride + 1) + 1 + x]
      if (f === 1) v += a
      else if (f === 2) v += b
      else if (f === 3) v += (a + b) >> 1
      else if (f === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      out[y * stride + x] = v & 255
    }
  }
  const lum = new Float32Array(w * h)
  const alpha = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) {
    let r, g, bl
    let al = 255
    if (ctype === 3) {
      const idx = out[i]
      r = palette[idx * 3]
      g = palette[idx * 3 + 1]
      bl = palette[idx * 3 + 2]
      al = trns && idx < trns.length ? trns[idx] : 255
    } else if (ctype === 0 || ctype === 4) {
      r = g = bl = out[i * ch]
      if (ctype === 4) al = out[i * ch + 1]
    } else {
      r = out[i * ch]
      g = out[i * ch + 1]
      bl = out[i * ch + 2]
      if (ctype === 6) al = out[i * ch + 3]
    }
    lum[i] = 0.299 * r + 0.587 * g + 0.114 * bl
    alpha[i] = al
  }
  return { w, h, depth, ctype, lum, alpha }
}

const RAMP = ' .:-=+*#%@'
for (const id of CANDIDATES) {
  const m = info[id]
  console.log(`\n######## ${id}\n  標題：${m?.title}｜格式：${m?.format}｜矩陣：${m?.matrix}`)
  if (!m?.template) continue
  for (const [name, z, y, x] of TILES) {
    const url = m.template
      .replace('{Time}', DATE)
      .replace('{TileMatrixSet}', m.matrix)
      .replace('{TileMatrix}', z)
      .replace('{TileRow}', y)
      .replace('{TileCol}', x)
    const r = await fetch(url)
    const buf = Buffer.from(await r.arrayBuffer())
    console.log(`  ${name} ${DATE}：HTTP ${r.status}，${buf.length} bytes，ct=${r.headers.get('content-type')}`)
    if (!r.ok || buf.toString('ascii', 1, 4) !== 'PNG') continue
    const img = decodePng(buf)
    if (!img.lum) {
      console.log(`    （${img.depth} bit／色彩型態 ${img.ctype}，略過）`)
      continue
    }
    let opaque = 0
    let bright = 0
    let max = 0
    for (let i = 0; i < img.lum.length; i++) {
      if (img.alpha[i] > 0) opaque++
      if (img.alpha[i] > 0 && img.lum[i] > 180) bright++
      if (img.lum[i] > max) max = img.lum[i]
    }
    console.log(`    不透明 ${((opaque / img.lum.length) * 100).toFixed(1)}%｜亮點(>180) ${bright} 像素｜最亮 ${max.toFixed(0)}`)
    // 64×32 文字圖：每格取最亮值，看得出零散亮點（船）還是整片（雲／月光）
    const cols = 64
    const rows = 32
    for (let ry = 0; ry < rows; ry++) {
      let line = '    '
      for (let rx = 0; rx < cols; rx++) {
        let best = 0
        for (let yy = Math.floor((ry * img.h) / rows); yy < Math.floor(((ry + 1) * img.h) / rows); yy++)
          for (let xx = Math.floor((rx * img.w) / cols); xx < Math.floor(((rx + 1) * img.w) / cols); xx++) {
            const i = yy * img.w + xx
            if (img.alpha[i] > 0 && img.lum[i] > best) best = img.lum[i]
          }
        line += RAMP[Math.min(RAMP.length - 1, Math.floor((best / 256) * RAMP.length))]
      }
      console.log(line)
    }
  }
}
