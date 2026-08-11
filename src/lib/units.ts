// ── 距離單位（海上作業預設用浬）──────────────────────────────
//
// 海上人員講距離習慣用「浬」（海里，1 浬 = 1852 m = 1.852 km），
// 雷達量程、通訊涵蓋、AIS 距離在船上都是以浬溝通。內部一律以 km 運算，
// 只在「顯示」這一層換算，避免到處塞轉換造成誤差累積。

export type DistUnit = 'nm' | 'km'

/** 1 浬 = 1.852 km（國際海里定義值）。 */
export const KM_PER_NM = 1.852
/** 1 浬 = 1852 m。 */
export const M_PER_NM = 1852

export const kmToNm = (km: number): number => km / KM_PER_NM
export const nmToKm = (nm: number): number => nm * KM_PER_NM

/** 單位標籤。 */
export function unitLabel(u: DistUnit): string {
  return u === 'nm' ? '浬' : 'km'
}

/** 把 km 轉成指定單位的數值（不含單位字）。 */
export function toUnit(km: number, u: DistUnit): number {
  return u === 'nm' ? kmToNm(km) : km
}

/** 把指定單位的數值轉回 km（表單輸入用）。 */
export function fromUnit(v: number, u: DistUnit): number {
  return u === 'nm' ? nmToKm(v) : v
}

/**
 * 依單位格式化（含單位字）。內部 km → 顯示字串。
 * 例：formatDist(238.2, 'nm') → "128.6 浬"
 */
export function formatDist(km: number, u: DistUnit = 'nm', digits = 1): string {
  if (!Number.isFinite(km)) return '—'
  return `${toUnit(km, u).toFixed(digits)} ${unitLabel(u)}`
}

/**
 * 主單位為主、另一單位加註於括號——給「怕看錯」的關鍵數字用。
 * 例：formatDistBoth(238.2, 'nm') → "128.6 浬（238.2 km）"
 */
export function formatDistBoth(km: number, u: DistUnit = 'nm', digits = 1): string {
  if (!Number.isFinite(km)) return '—'
  const other: DistUnit = u === 'nm' ? 'km' : 'nm'
  return `${formatDist(km, u, digits)}（${formatDist(km, other, digits)}）`
}

// ── 偏好保存（只存本機）──────────────────────────────────────

const LS_KEY = 'argus.distUnit.v1'

/** 讀取單位偏好。預設「浬」——海上作業的通用單位。 */
export function loadDistUnit(): DistUnit {
  try {
    return localStorage.getItem(LS_KEY) === 'km' ? 'km' : 'nm'
  } catch {
    return 'nm'
  }
}

export function persistDistUnit(u: DistUnit) {
  try {
    localStorage.setItem(LS_KEY, u)
  } catch {
    /* ignore quota */
  }
}
