// ── 認出「沒有資料」的圖磚，讓底下那層露出來 ─────────────────
//
// 為什麼需要：免費圖磚服務在沒資料的地方「不會回 404」，而是回 HTTP 200 加一張
// 看起來像圖的圖磚。瀏覽器分不出來，就照樣貼上去，蓋掉底下明明有資料的那層。
// 以下全部是在 GitHub Actions 上打真的伺服器、解碼圖磚量出來的（開發沙箱連不出去）：
//
//   Esri（街道／衛星／暗灰）：灰底 + 「Map data not yet available」字樣
//     → 平均色 #cdcdcd、四角是同一個灰。出現時機：
//        暗灰 z17 以上「全部」都是（連台北 101 都是）——這就是舊預設地圖放大就空的原因
//        街道：外海 z13 起、近岸 z18 起、金門 z16 起、廈門 z15 起
//        衛星：外海 z14 起、近岸 z19
//   NLSC 通用電子地圖：涵蓋範圍外、或海面 z16 以上 → 一整片 #a5dbf1（淺藍）
//   NLSC 影像＋注記：海面與範圍外 → 一整片 #183b4b（深青）
//
// 判斷方式只看幾個像素（縮成 16×16 再取樣），所以很便宜；判斷失敗（例如
// 讀不到像素）一律「保留顯示」——寧可多一張空白，也不要把真的地圖藏掉。

export type TileVerdict =
  /** Esri 的「尚無資料」灰底佔位圖。 */
  | 'esriPlaceholder'
  /** 整張單一顏色（沒有任何資訊）。 */
  | 'flat'
  /** 有內容的真圖。 */
  | 'real'

export interface TileSample {
  /** RGBA，長度 = w*h*4。 */
  data: Uint8ClampedArray | Uint8Array | number[]
  w: number
  h: number
}

export interface Classified {
  verdict: TileVerdict
  /** 全部取樣點的平均色 [r,g,b]。 */
  mean: [number, number, number]
  /** 任一取樣點、任一色版，離平均最遠多少。0 = 完全單色。 */
  dev: number
}

/** 單色門檻。JPEG 壓縮會讓「同一個顏色」在格與格之間差 1–2。 */
const FLAT_DEV = 3

/** Esri 佔位圖的灰階範圍（實測平均 #cdcdcd，含字樣；四角是更淺的純灰）。 */
const PLACEHOLDER_GRAY_MIN = 190
const PLACEHOLDER_GRAY_MAX = 225

function px(s: TileSample, x: number, y: number): [number, number, number, number] {
  const i = (y * s.w + x) * 4
  return [s.data[i], s.data[i + 1], s.data[i + 2], s.data[i + 3]]
}

function isGray(c: [number, number, number, number], tol = 3): boolean {
  return Math.abs(c[0] - c[1]) <= tol && Math.abs(c[1] - c[2]) <= tol
}

export function classifyTile(s: TileSample): Classified {
  const n = s.w * s.h
  let r = 0
  let g = 0
  let b = 0
  let transparent = 0
  for (let i = 0; i < n; i++) {
    r += s.data[i * 4]
    g += s.data[i * 4 + 1]
    b += s.data[i * 4 + 2]
    if (s.data[i * 4 + 3] < 10) transparent++
  }
  const mean: [number, number, number] = [Math.round(r / n), Math.round(g / n), Math.round(b / n)]

  let dev = 0
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) dev = Math.max(dev, Math.abs(s.data[i * 4 + c] - mean[c]))
  }

  // 透明的疊加層（標註圖層的空白處）本來就該透明，不歸這裡管
  if (transparent > n * 0.5) return { verdict: 'real', mean, dev }

  // 佔位圖：四個角是同一個中淺灰。字樣在正中間，四角一定是純底色。
  const corners = [px(s, 0, 0), px(s, s.w - 1, 0), px(s, 0, s.h - 1), px(s, s.w - 1, s.h - 1)]
  const c0 = corners[0]
  const cornersSame = corners.every(
    (c) => Math.abs(c[0] - c0[0]) <= 3 && Math.abs(c[1] - c0[1]) <= 3 && Math.abs(c[2] - c0[2]) <= 3,
  )
  if (
    cornersSame &&
    corners.every((c) => isGray(c)) &&
    c0[0] >= PLACEHOLDER_GRAY_MIN &&
    c0[0] <= PLACEHOLDER_GRAY_MAX
  ) {
    return { verdict: 'esriPlaceholder', mean, dev }
  }

  if (dev <= FLAT_DEV) return { verdict: 'flat', mean, dev }
  return { verdict: 'real', mean, dev }
}

/** 兩個顏色夠不夠接近（逐色版）。 */
export function colorNear(a: readonly number[], b: readonly number[], tol = 8): boolean {
  return Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol
}

/** 每種圖層「要藏哪些圖磚」的規則。 */
export interface HideRule {
  /** 藏 Esri 佔位圖。 */
  esriPlaceholder?: boolean
  /** 藏這些顏色的單色圖（各家「沒資料」的顏色不同）。 */
  flatColors?: readonly (readonly [number, number, number])[]
}

/** 實測的「沒資料」顏色。 */
export const NLSC_EMAP_EMPTY = [0xa5, 0xdb, 0xf1] as const
export const NLSC_PHOTO_EMPTY = [0x18, 0x3b, 0x4b] as const

export function shouldHide(c: Classified, rule: HideRule): boolean {
  if (rule.esriPlaceholder && c.verdict === 'esriPlaceholder') return true
  if (c.verdict === 'flat' && rule.flatColors?.some((fc) => colorNear(c.mean, fc))) return true
  return false
}
