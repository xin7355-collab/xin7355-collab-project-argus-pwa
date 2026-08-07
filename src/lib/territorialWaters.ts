// ── 中華民國領海基線 / 領海 / 鄰接區（示意參考線）────────────
//
// 依《中華民國第一批領海基線》(1999 公告、2009 修正) 的「直線基線」概念繪製。
// 這裡的基點採台灣本島與澎湖的主要岬角/沙洲之實際地理位置「近似」連線，
// 屬「示意/態勢感知」用途，非公告座標，不作為法律劃界依據。
//
// 由基線向外偏移：12 浬 = 領海外界線；24 浬 = 鄰接區(查察/移民/衛生)外界。
// 這對海上「船隻是否進入我領海/鄰接區」的態勢判斷很實用。

const DEG = Math.PI / 180
const R = 6371000

/** 台灣本島直線基線（順時針，主要岬角/沙洲近似）。 */
export const TAIWAN_BASELINE: [number, number][] = [
  [25.298, 121.538], // 富貴角（北端）
  [25.007, 122.002], // 三貂角（東北）
  [24.463, 121.842], // 烏石鼻（宜蘭）
  [23.79, 121.545], // 花蓮外
  [23.124, 121.408], // 三仙台（台東）
  [22.35, 121.02], // 台東外海
  [21.902, 120.857], // 鵝鑾鼻（南端）
  [21.925, 120.7], // 貓鼻頭（西南）
  [22.61, 120.235], // 高雄港外
  [23.0, 120.03], // 台南安平外
  [23.5, 119.98], // 外傘頂洲（外海沙洲）
  [24.285, 120.44], // 台中港外
  [24.85, 120.83], // 新竹南寮外
  [25.18, 121.41], // 淡水河口外
]

/** 澎湖群島基線（順時針，四極島嶼近似）。 */
export const PENGHU_BASELINE: [number, number][] = [
  [23.798, 119.596], // 目斗嶼（北）
  [23.57, 119.69], // 查母嶼（東）
  [23.19, 119.5], // 七美嶼（南）
  [23.36, 119.31], // 花嶼（西）
]

/**
 * 將封閉環向外偏移 nm 海浬（在局部公尺平面做等距外偏，miter 接角）。
 * 用於由基線產生 12/24 浬外界線。台灣本島近凸形，視覺上準確、適合態勢參考。
 */
export function offsetRing(ring: [number, number][], nm: number): [number, number][] {
  const d = nm * 1852
  const n = ring.length
  const lat0 = ring.reduce((s, p) => s + p[0], 0) / n
  const lng0 = ring.reduce((s, p) => s + p[1], 0) / n
  const k = Math.cos(lat0 * DEG)
  const toXY = ([la, lo]: [number, number]): [number, number] => [
    (lo - lng0) * DEG * R * k,
    (la - lat0) * DEG * R,
  ]
  const toLL = ([x, y]: [number, number]): [number, number] => [
    lat0 + y / R / DEG,
    lng0 + x / (R * k) / DEG,
  ]
  const P = ring.map(toXY)
  // 環的走向（外積正=逆時針）
  let area = 0
  for (let i = 0; i < n; i++) {
    const a = P[i]
    const b = P[(i + 1) % n]
    area += a[0] * b[1] - b[0] * a[1]
  }
  const sign = area > 0 ? 1 : -1
  const outN = (a: [number, number], b: [number, number]): [number, number] => {
    const ex = b[0] - a[0]
    const ey = b[1] - a[1]
    const l = Math.hypot(ex, ey) || 1
    return [(sign * ey) / l, (sign * -ex) / l]
  }
  const out: [number, number][] = []
  for (let i = 0; i < n; i++) {
    const prev = P[(i - 1 + n) % n]
    const cur = P[i]
    const next = P[(i + 1) % n]
    const n1 = outN(prev, cur)
    const n2 = outN(cur, next)
    let bx = n1[0] + n2[0]
    let by = n1[1] + n2[1]
    const bl = Math.hypot(bx, by) || 1
    bx /= bl
    by /= bl
    const cosH = Math.max(0.4, n1[0] * bx + n1[1] * by)
    const push = d / cosH
    out.push(toLL([cur[0] + bx * push, cur[1] + by * push]))
  }
  return out
}
