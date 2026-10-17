// ── 比例尺用的「好看的整數」 ────────────────────────────────
//
// Leaflet 內建比例尺只有公里／英哩。本專案距離預設是浬（海上溝通用浬），
// 所以自己算：給定比例尺最長可以畫多少浬，挑一個 1/2/3/5×10ⁿ 的整數。
// 不足 1 浬時改用公尺（港內、靠泊時 0.2 浬這種數字沒人會唸）。

export interface ScaleChoice {
  /** 要顯示的文字。 */
  text: string
  /** 這個數字佔最長可畫長度的比例（0–1）→ 比例尺實際畫多寬。 */
  ratio: number
}

/** 不超過 n 的 1/2/3/5×10ⁿ。 */
export function roundNice(n: number): number {
  if (!(n > 0) || !Number.isFinite(n)) return 0
  const pow = Math.pow(10, Math.floor(Math.log10(n)))
  const d = n / pow
  const nice = d >= 5 ? 5 : d >= 3 ? 3 : d >= 2 ? 2 : 1
  return nice * pow
}

/**
 * @param maxMeters 比例尺最長可以代表多少公尺
 * @param unit 'nm' 浬（預設）或 'km'
 */
export function chooseScale(maxMeters: number, unit: 'nm' | 'km'): ScaleChoice | null {
  if (!(maxMeters > 0) || !Number.isFinite(maxMeters)) return null
  if (unit === 'nm') {
    const maxNm = maxMeters / 1852
    if (maxNm >= 1) {
      const nm = roundNice(maxNm)
      return { text: `${nm} 浬`, ratio: nm / maxNm }
    }
  } else if (maxMeters >= 1000) {
    const km = roundNice(maxMeters / 1000)
    return { text: `${km} km`, ratio: (km * 1000) / maxMeters }
  }
  const m = roundNice(maxMeters)
  return { text: `${m} m`, ratio: m / maxMeters }
}
