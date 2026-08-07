// 產生 PWA 需要的 PNG 圖示（無外部依賴，用 Node 內建 zlib 手刻 PNG）。
// 執行：node scripts/gen-icons.mjs
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
  }
  return ~c >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const body = Buffer.concat([typeBuf, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function makePng(size) {
  const [r0, g0, b0] = [15, 23, 42] // slate-900 背景
  const cx = size / 2
  const cy = size / 2
  const raw = Buffer.alloc(size * (size * 4 + 1))
  let o = 0
  for (let y = 0; y < size; y++) {
    raw[o++] = 0 // filter type
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - cx, y - cy)
      let r = r0,
        g = g0,
        b = b0
      // 外環 cyan
      const ring = size * 0.36
      if (Math.abs(d - ring) < size * 0.03) {
        r = 34
        g = 211
        b = 238
      }
      // 中心綠點
      if (d < size * 0.09) {
        r = 52
        g = 211
        b = 153
      }
      // 掃描線（十字）
      if (Math.abs(x - cx) < size * 0.006 || Math.abs(y - cy) < size * 0.006) {
        if (d < ring) {
          r = 34
          g = 211
          b = 238
        }
      }
      raw[o++] = r
      raw[o++] = g
      raw[o++] = b
      raw[o++] = 255
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

mkdirSync('public', { recursive: true })
for (const size of [192, 512]) {
  writeFileSync(`public/icon-${size}.png`, makePng(size))
  console.log(`wrote public/icon-${size}.png`)
}
