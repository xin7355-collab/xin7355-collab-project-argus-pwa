// ── 亮點偵測（輔助判讀，非 AI）────────────────────────────
//
// 在「暗色海面」上，船／殘骸／白浪會是相對亮的小點。這裡對目前畫面的
// 衛星影像做統計式亮點偵測：算全畫面亮度均值/標準差，挑出「明顯比周圍亮、
// 又不太大（排除雲/陸地）」的小團塊，回傳其畫面座標。純前端、免金鑰。
//
// 誠實定位：這是幫你在茫茫大海「快速鎖定可疑亮點」的輔助工具，不是保證是船
// （白浪、反光也可能中）。真正確認仍需雷達(Sentinel-1)或就近目視。

export interface BrightSpot {
  /** 畫面像素座標（相對傳入影像，中心）。 */
  x: number
  y: number
  /** 團塊大小（取樣格數）。 */
  size: number
  /** 亮度離群分數（越高越突出）。 */
  score: number
  /** 邊界框（畫面像素）。 */
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface ScanOpts {
  /** 取樣間隔像素（越大越快）。 */
  step?: number
  /** 門檻＝均值 + kStd×標準差。越大越保守。 */
  kStd?: number
  /** 需比周圍環平均亮多少（0–255）才算突出，濾除大片亮區。 */
  ringMargin?: number
  /** 團塊最小/最大格數（濾雜訊與雲/島）。 */
  minSize?: number
  maxSize?: number
  /** 最多回傳幾個。 */
  maxSpots?: number
}

export function detectBrightSpots(img: ImageData, opt: ScanOpts = {}): BrightSpot[] {
  const step = opt.step ?? 2
  const W = img.width
  const H = img.height
  const d = img.data
  const lum = (i: number) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]

  const gw = Math.ceil(W / step)
  const gh = Math.ceil(H / step)
  const L = new Float32Array(gw * gh)
  let sum = 0
  let sum2 = 0
  let count = 0
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const px = Math.min(W - 1, gx * step)
      const py = Math.min(H - 1, gy * step)
      const idx = (py * W + px) * 4
      const v = d[idx + 3] < 10 ? -1 : lum(idx) // 透明像素略過
      L[gy * gw + gx] = v
      if (v >= 0) {
        sum += v
        sum2 += v * v
        count++
      }
    }
  }
  if (count === 0) return []
  const mean = sum / count
  const std = Math.sqrt(Math.max(0, sum2 / count - mean * mean))
  const kStd = opt.kStd ?? 3
  const thresh = mean + kStd * std
  const ringMargin = opt.ringMargin ?? 15

  const at = (gx: number, gy: number) =>
    gx < 0 || gy < 0 || gx >= gw || gy >= gh ? -1 : L[gy * gw + gx]

  // 候選遮罩：夠亮 + 明顯比周圍環亮（濾大片亮）
  const mask = new Uint8Array(gw * gh)
  const r = 3
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const v = L[gy * gw + gx]
      if (v < thresh) continue
      let rs = 0
      let rc = 0
      for (let a = -r; a <= r; a++) {
        const ring: [number, number][] = [
          [a, -r],
          [a, r],
          [-r, a],
          [r, a],
        ]
        for (const [dx, dy] of ring) {
          const rv = at(gx + dx, gy + dy)
          if (rv >= 0) {
            rs += rv
            rc++
          }
        }
      }
      const ringAvg = rc ? rs / rc : 0
      if (v - ringAvg >= ringMargin) mask[gy * gw + gx] = 1
    }
  }

  // 連通元件（8 連通略；用 4 連通即可）
  const minSize = opt.minSize ?? 1
  const maxSize = opt.maxSize ?? 40
  const seen = new Uint8Array(gw * gh)
  const spots: BrightSpot[] = []
  const stack: number[] = []
  const nbr: [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]
  for (let i = 0; i < gw * gh; i++) {
    if (!mask[i] || seen[i]) continue
    stack.length = 0
    stack.push(i)
    seen[i] = 1
    let sx = 0
    let sy = 0
    let sc = 0
    let maxv = 0
    let bMinX = gw
    let bMaxX = 0
    let bMinY = gh
    let bMaxY = 0
    while (stack.length) {
      const j = stack.pop() as number
      const jx = j % gw
      const jy = (j / gw) | 0
      sx += jx
      sy += jy
      sc++
      if (jx < bMinX) bMinX = jx
      if (jx > bMaxX) bMaxX = jx
      if (jy < bMinY) bMinY = jy
      if (jy > bMaxY) bMaxY = jy
      if (L[j] > maxv) maxv = L[j]
      for (const [dx, dy] of nbr) {
        const nx = jx + dx
        const ny = jy + dy
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue
        const nj = ny * gw + nx
        if (mask[nj] && !seen[nj]) {
          seen[nj] = 1
          stack.push(nj)
        }
      }
    }
    if (sc < minSize || sc > maxSize) continue
    spots.push({
      x: (sx / sc) * step,
      y: (sy / sc) * step,
      size: sc,
      score: (maxv - mean) / (std || 1),
      minX: bMinX * step,
      minY: bMinY * step,
      maxX: (bMaxX + 1) * step,
      maxY: (bMaxY + 1) * step,
    })
  }
  spots.sort((a, b) => b.score - a.score)
  return spots.slice(0, opt.maxSpots ?? 60)
}
