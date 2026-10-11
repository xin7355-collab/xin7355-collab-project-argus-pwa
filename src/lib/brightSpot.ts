// ── 亮點偵測（輔助判讀，非 AI）────────────────────────────
//
// 在「暗色海面」上，船／殘骸／白浪會是相對亮的小點。這裡對目前畫面的
// 衛星影像做統計式亮點偵測，挑出「明顯比周圍亮、又不太大（排除雲/陸地）」
// 的小團塊，回傳其畫面座標。純前端、免金鑰。
//
// ── v2：局部自適應門檻（CFAR 思路）─────────────────────────
// 舊版是整張畫面算一個 mean + kStd×std 當門檻，而且這個門檻在環對比測試
// 「之前」就先硬篩一次。只要畫面裡有太陽反光、海岸線或雲，全域統計就被拉高，
// 暗海域裡「亮度不高但在當地很突出」的小艇會被直接丟掉——正好打在最在意的
// 小艇偵測上。現在每一格都有自己的門檻。
//
// 分塊重疊掃描的作法參考 Update-Priority-Map（Apache-2.0）
// modules/inference/tiled.py 的 Slicer：步距＝塊邊長÷重疊倍數，再用
// accumulate + count 相除把重疊處平均掉，所以塊與塊之間不會有門檻接縫。
//
// 統計量用「中位數 + MAD」而不是「平均 + 標準差」，這是 CFAR 的標準做法
// （median-CFAR）：中位數不會被塊內的目標自己拉高，平均會。
//
// 誠實定位：這是幫你在茫茫大海「快速鎖定可疑亮點」的輔助工具，不是保證是船
// （白浪、反光也可能中）。真正確認仍需雷達(Sentinel-1)或就近目視。

/**
 * 只取偵測真正用到的三個欄位。瀏覽器的 ImageData 在結構上可直接傳進來，
 * 拆成結構型別是為了能在純 Node（無 DOM）跑單元測試。
 */
export interface LumImage {
  width: number
  height: number
  data: Uint8ClampedArray
}

export interface BrightSpot {
  /** 畫面像素座標（相對傳入影像，中心）。 */
  x: number
  y: number
  /** 團塊大小（取樣格數）。 */
  size: number
  /** 亮度離群分數（越高越突出）。局部自適應模式下是「局部 σ̂」倍數。 */
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
  /** 門檻＝局部中位數 + kStd×局部 σ̂。越大越保守。 */
  kStd?: number
  /** 需比訓練環平均亮多少（0–255）的「絕對底線」，擋 JPEG 雜訊。 */
  ringMargin?: number
  /**
   * 團塊最小/最大格數（濾雜訊與雲/島）。
   *
   * minSize 預設 2（舊版是 1）：改用局部門檻後，暗區的門檻降低了，
   * 孤立的單格候選幾乎都是雜訊——取樣間隔只有 2px，真正看得見的船一定會
   * 跨到相鄰的取樣格。要求「至少兩格相連」可以把雜訊幾乎清掉而不犧牲真目標。
   */
  minSize?: number
  maxSize?: number
  /** 最多回傳幾個。 */
  maxSpots?: number
  /** false＝退回舊的全域門檻（只換門檻來源，供 A/B 對照）。預設 true。 */
  localAdaptive?: boolean
  /** 局部統計的分塊邊長（格數）。 */
  tileCells?: number
  /** 護衛環半徑（格）：這圈內不拿來估背景，免得大一點的船污染自己的背景。 */
  guard?: number
  /** 訓練環外半徑（格）。 */
  ringOut?: number
  /** 突出量同時要達到 kRing×局部 σ̂。 */
  kRing?: number
  /** 有效訓練格數下限，不足就拒絕（畫面邊緣／影像覆蓋邊界）。 */
  minTraining?: number
  /** 局部 σ̂ 的下限（亮度單位），避免完全平坦的區域門檻崩到 0 而整片誤報。 */
  minSigma?: number
}

/** 透明／無資料格的哨兵值（存在同一個亮度陣列裡）。 */
const NODATA = -1

/** 由 256 格直方圖取中位數（下中位數）。 */
function histMedian(hist: Int32Array, total: number): number {
  const half = (total + 1) >> 1
  let acc = 0
  for (let b = 0; b < 256; b++) {
    acc += hist[b]
    if (acc >= half) return b
  }
  return 255
}

/**
 * 由同一張直方圖取 MAD（絕對離差中位數）：從中位數那格往兩側擴張，
 * 累計數量過半時的半徑就是 MAD。O(256)，不必再掃一次原始資料。
 */
function histMad(hist: Int32Array, total: number, med: number): number {
  const half = (total + 1) >> 1
  let acc = hist[med]
  if (acc >= half) return 0
  for (let r = 1; r < 256; r++) {
    const lo = med - r
    const hi = med + r
    if (lo >= 0) acc += hist[lo]
    if (hi <= 255) acc += hist[hi]
    if (acc >= half) return r
    if (lo < 0 && hi > 255) break
  }
  return 255
}

/** 局部統計場：每一格自己的背景中位數與 σ̂。 */
export interface StatsField {
  med: Float32Array
  sig: Float32Array
  /** 每格被幾個塊覆蓋到。0＝附近有效樣本太少，已退回全域統計。 */
  cnt: Uint16Array
}

export interface StatsFieldOpts {
  tileCells?: number
  minSigma?: number
  /** |平均−中位數| 超過這個倍數的 σ̂ 就判定該塊跨在雜波邊界上，不貢獻統計。 */
  edgeSkew?: number
  /** 塊被跳過時的退路（通常傳全域中位數／σ̂）。 */
  fallbackMed: number
  fallbackSig: number
}

/**
 * 以「重疊分塊」算出逐格的局部背景統計場。
 *
 * 步距取塊邊長的一半（50% 重疊），每格因此會被多個塊覆蓋，最後取平均——
 * 這就是 tiled.py 的 merge 手法（accumulate + count 相除），作用是讓門檻
 * 平滑過渡，不會在塊邊界出現「一邊抓得到、一邊抓不到」的接縫。
 */
export function localStatsField(
  L: Float32Array,
  gw: number,
  gh: number,
  opt: StatsFieldOpts,
): StatsField {
  const n = gw * gh
  const minSigma = opt.minSigma ?? 2
  // 塊不能大於整張格子，也不要小到統計沒意義。
  const tile = Math.max(8, Math.min(opt.tileCells ?? 32, Math.max(gw, gh)))
  const stride = Math.max(1, tile >> 1)

  const accMed = new Float32Array(n)
  const accSig = new Float32Array(n)
  const cnt = new Uint16Array(n)
  const hist = new Int32Array(256)

  for (let ty = 0; ty < gh; ty += stride) {
    const y1 = Math.min(ty + tile, gh)
    for (let tx = 0; tx < gw; tx += stride) {
      const x1 = Math.min(tx + tile, gw)

      hist.fill(0)
      let valid = 0
      let vsum = 0
      for (let y = ty; y < y1; y++) {
        const row = y * gw
        for (let x = tx; x < x1; x++) {
          const v = L[row + x]
          if (v < 0) continue
          hist[v > 255 ? 255 : Math.round(v)]++
          vsum += v
          valid++
        }
      }

      // 有效樣本太少的塊不貢獻統計（大片透明的地圖邊緣／未覆蓋區）。
      const area = (x1 - tx) * (y1 - ty)
      if (valid < Math.max(16, area * 0.15)) continue

      const med = histMedian(hist, valid)
      const sig = Math.max(minSigma, 1.4826 * histMad(hist, valid, med))

      // 雜波邊界護欄：跨在海岸線／反光邊緣上的塊，亮度分布是雙峰的，
      // 中位數會落在其中一峰而平均落在中間，兩者差距很大。這種塊的統計
      // 不能代表任何一側的背景——把它平均進門檻場，亮的那側就會整排誤報
      // （實測：不處理的話邊界上會多出十幾個假目標）。所以直接不讓它貢獻，
      // 由另一側「純淨」的塊接手；重疊 50% 保證每格都還有塊可用。
      if (Math.abs(vsum / valid - med) > (opt.edgeSkew ?? 1.5) * sig) continue
      for (let y = ty; y < y1; y++) {
        const row = y * gw
        for (let x = tx; x < x1; x++) {
          const i = row + x
          accMed[i] += med
          accSig[i] += sig
          cnt[i]++
        }
      }
    }
  }

  const med = new Float32Array(n)
  const sig = new Float32Array(n)
  const fbSig = Math.max(minSigma, opt.fallbackSig)
  for (let i = 0; i < n; i++) {
    if (cnt[i]) {
      med[i] = accMed[i] / cnt[i]
      sig[i] = Math.max(minSigma, accSig[i] / cnt[i])
    } else {
      med[i] = opt.fallbackMed
      sig[i] = fbSig
    }
  }
  return { med, sig, cnt }
}

export function detectBrightSpots(img: LumImage, opt: ScanOpts = {}): BrightSpot[] {
  const step = opt.step ?? 2
  const W = img.width
  const H = img.height
  const d = img.data
  const lum = (i: number) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]

  const gw = Math.ceil(W / step)
  const gh = Math.ceil(H / step)
  const L = new Float32Array(gw * gh)
  const gHist = new Int32Array(256)
  let sum = 0
  let sum2 = 0
  let count = 0
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const px = Math.min(W - 1, gx * step)
      const py = Math.min(H - 1, gy * step)
      const idx = (py * W + px) * 4
      const v = d[idx + 3] < 10 ? NODATA : lum(idx) // 透明像素略過
      L[gy * gw + gx] = v
      if (v >= 0) {
        sum += v
        sum2 += v * v
        count++
        gHist[v > 255 ? 255 : Math.round(v)]++
      }
    }
  }
  if (count === 0) return []

  const mean = sum / count
  const std = Math.sqrt(Math.max(0, sum2 / count - mean * mean))
  const gMed = histMedian(gHist, count)
  const gSig = 1.4826 * histMad(gHist, count, gMed)

  const kStd = opt.kStd ?? 3
  const localAdaptive = opt.localAdaptive ?? true
  const minSigma = opt.minSigma ?? 2
  const ringMargin = opt.ringMargin ?? 10
  const kRing = opt.kRing ?? 1.5
  const minTraining = opt.minTraining ?? 24
  const guard = Math.max(0, opt.guard ?? 2)
  const ringOut = Math.max(guard + 1, opt.ringOut ?? 4)

  const field = localStatsField(L, gw, gh, {
    tileCells: opt.tileCells,
    minSigma,
    fallbackMed: gMed,
    fallbackSig: gSig,
  })
  // 舊行為：整張畫面一個門檻。只在 localAdaptive=false 時使用。
  const globalThresh = mean + kStd * std

  // 訓練環位移表（Chebyshev 半徑落在 (guard, ringOut] 的格子），dx,dy 攤平成
  // 一維陣列，免得每一格候選都重新配置小陣列。預設 guard=2、ringOut=4 → 56 格。
  const offs: number[] = []
  for (let dy = -ringOut; dy <= ringOut; dy++) {
    for (let dx = -ringOut; dx <= ringOut; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) > guard) offs.push(dx, dy)
    }
  }

  // 候選遮罩：過得了局部門檻 + 明顯比訓練環亮（濾大片亮區）
  const mask = new Uint8Array(gw * gh)
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const i = gy * gw + gx
      const v = L[i]
      if (v < 0) continue
      const thr = localAdaptive ? field.med[i] + kStd * field.sig[i] : globalThresh
      if (v < thr) continue

      let rs = 0
      let rs2 = 0
      let rc = 0
      for (let k = 0; k < offs.length; k += 2) {
        const nx = gx + offs[k]
        const ny = gy + offs[k + 1]
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue
        const rv = L[ny * gw + nx]
        if (rv < 0) continue
        rs += rv
        rs2 += rv * rv
        rc++
      }
      // 訓練格不足就拒絕。舊版在這裡讓 ringAvg=0 而「無條件通過」，
      // 是影像覆蓋邊界的誤報來源。
      if (rc < minTraining) continue

      const ringAvg = rs / rc
      let need = ringMargin
      if (localAdaptive) {
        // 訓練環本身的離散度：環跨在海岸線／反光邊緣上時會很大，
        // 此時要求更高的突出量，免得「邊界另一側比較亮」被當成目標。
        const ringStd = Math.sqrt(Math.max(0, rs2 / rc - ringAvg * ringAvg))
        need = Math.max(ringMargin, kRing * Math.max(field.sig[i], ringStd))
      }
      if (v - ringAvg >= need) mask[i] = 1
    }
  }

  // 連通元件（4 連通即可）。門檻是逐格的，泛洪仍是整張畫面單一次掃描，
  // 所以不會因為分塊而產生重複偵測，不需要額外的 NMS。
  const minSize = opt.minSize ?? 2
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
    let maxv = -1
    let maxIdx = i
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
      if (L[j] > maxv) {
        maxv = L[j]
        maxIdx = j
      }
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
    // 分數用「局部」σ̂：舊版用全域 mean/std，暗區小艇的分數會被壓低，
    // 在 sort + slice(maxSpots) 時被亮區的反光紋理擠掉。
    const score = localAdaptive
      ? (maxv - field.med[maxIdx]) / field.sig[maxIdx]
      : (maxv - mean) / (std || 1)
    spots.push({
      x: (sx / sc) * step,
      y: (sy / sc) * step,
      size: sc,
      score,
      minX: bMinX * step,
      minY: bMinY * step,
      maxX: (bMaxX + 1) * step,
      maxY: (bMaxY + 1) * step,
    })
  }
  spots.sort((a, b) => b.score - a.score)
  return spots.slice(0, opt.maxSpots ?? 60)
}
