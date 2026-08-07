// ── 熱力圖色階 ──────────────────────────────────────────────
// 把數值(海溫/浪高)映射到顏色。回傳 rgba 字串。

/** 線性內插兩個 rgb。 */
function lerp(a: number[], b: number[], t: number): number[] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

/** 依 stops(由小到大)在色帶上取色。 */
function ramp(value: number, min: number, max: number, colors: number[][]): number[] {
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)))
  const seg = t * (colors.length - 1)
  const i = Math.floor(seg)
  if (i >= colors.length - 1) return colors[colors.length - 1]
  return lerp(colors[i], colors[i + 1], seg - i)
}

// 海溫：藍(冷) → 青 → 綠 → 黃 → 橙 → 紅(暖)，約 18–32°C
const SST_COLORS = [
  [37, 99, 235], // blue
  [34, 211, 238], // cyan
  [52, 211, 153], // green
  [250, 204, 21], // yellow
  [249, 115, 22], // orange
  [239, 68, 68], // red
]

// 浪高：綠(平靜) → 黃 → 橙 → 紅 → 紫(危險)，約 0–5m
const WAVE_COLORS = [
  [34, 197, 94], // green
  [250, 204, 21], // yellow
  [249, 115, 22], // orange
  [239, 68, 68], // red
  [168, 85, 247], // purple
]

export function sstColor(c: number, alpha = 0.55): string {
  const [r, g, b] = ramp(c, 18, 32, SST_COLORS)
  return `rgba(${r | 0},${g | 0},${b | 0},${alpha})`
}

export function waveColor(m: number, alpha = 0.55): string {
  const [r, g, b] = ramp(m, 0, 5, WAVE_COLORS)
  return `rgba(${r | 0},${g | 0},${b | 0},${alpha})`
}

/** 動態範圍上色：把顏色鋪滿「此畫面實際 min~max」，放大細微差異(海溫常僅差幾度)。 */
export function sstColorDyn(c: number, min: number, max: number, alpha = 0.6): string {
  const [r, g, b] = ramp(c, min, max, SST_COLORS)
  return `rgba(${r | 0},${g | 0},${b | 0},${alpha})`
}
export function waveColorDyn(m: number, min: number, max: number, alpha = 0.6): string {
  const [r, g, b] = ramp(m, min, max, WAVE_COLORS)
  return `rgba(${r | 0},${g | 0},${b | 0},${alpha})`
}

/** 圖例刻度（給 UI 畫色條）。 */
export const SST_LEGEND = { min: 18, max: 32, unit: '°C', colorAt: (c: number) => sstColor(c, 1) }
export const WAVE_LEGEND = { min: 0, max: 5, unit: 'm', colorAt: (m: number) => waveColor(m, 1) }
