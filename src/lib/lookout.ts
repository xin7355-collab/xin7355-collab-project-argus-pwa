// ── 瞭望哨視域（observation viewshed，私密，只存本機）──────────
//
// 沿岸瞭望哨/高地觀測點「看得到哪片海」的可視範圍。用途：判斷非法越界小艇、
// 舢舨可能從哪個死角(被地形擋住、或超出目視距離)靠岸，佈署觀測與攔截。
//
// 兩個限制取小：
//   1) 目視地平線(含大氣折射 k=4/3)：d(km) ≈ 4.12 × (√眼高m + √目標高m)
//   2) 目視辨識距離：肉眼看小艇約 5–8km、望遠鏡約 12–18km（裝備/天候而定）
// 再用 90m DEM 沿各方位切出「被山/岬角擋住」的真實視域形狀。

export interface Lookout {
  id: string
  name: string
  lat: number
  lng: number
  /** 觀測者眼睛「離地高度」(m)＝哨台高＋人眼高；地面海拔在地形模式由 DEM 自動補上（勿重複填海拔）。 */
  eyeM: number
  /** 目標高度(m)：泳渡者~0.5、小艇~1、舢舨~3、漁船~10。 */
  targetM: number
  /** 目視辨識上限(km)：肉眼~6、雙筒~15、光電/夜視依裝備。 */
  maxKm: number
}

/** 觀測裝備 → 目視辨識上限(km) 快捷。 */
export const OPTIC_PRESETS: { label: string; km: number }[] = [
  { label: '肉眼 6km', km: 6 },
  { label: '雙筒 15km', km: 15 },
  { label: '光電/夜視 25km', km: 25 },
]

/** 常見目標高度快捷。 */
export const LOOKOUT_TARGETS: { m: number; label: string }[] = [
  { m: 0.5, label: '泳渡者 0.5m' },
  { m: 1, label: '小艇 1m' },
  { m: 3, label: '舢舨 3m' },
  { m: 10, label: '漁船 10m' },
]

/** 目視地平線(km)：含大氣折射，眼高與目標高共同決定。 */
export function opticalHorizonKm(eyeM: number, targetM: number): number {
  return 4.12 * (Math.sqrt(Math.max(0, eyeM)) + Math.sqrt(Math.max(0, targetM)))
}

/** 實際視域半徑(km)：地平線與目視辨識上限取小。 */
export function lookoutReachKm(l: Lookout): number {
  return Math.min(opticalHorizonKm(l.eyeM, l.targetM), l.maxKm)
}

const LS_KEY = 'argus.lookout.v1'

/** 補預設，避免舊/損壞紀錄缺欄位→lookoutReachKm NaN→Leaflet 半徑 NaN。 */
function normalizeLookout(r: Partial<Lookout>): Lookout {
  const n = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  return {
    id: typeof r.id === 'string' ? r.id : newLookoutId(),
    name: typeof r.name === 'string' ? r.name : '瞭望哨',
    lat: r.lat as number,
    lng: r.lng as number,
    eyeM: n(r.eyeM, 10),
    targetM: n(r.targetM, 1),
    maxKm: n(r.maxKm, 15),
  }
}

export function loadLookouts(): Lookout[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || '[]')
    if (!Array.isArray(raw)) return []
    return raw
      .filter((r) => r && typeof r.lat === 'number' && typeof r.lng === 'number')
      .map(normalizeLookout)
  } catch {
    return []
  }
}

export function persistLookouts(list: Lookout[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list))
  } catch {
    /* ignore quota */
  }
}

export function newLookoutId(): string {
  return 'lo' + Math.abs(Date.now() ^ ((Math.random() * 1e9) | 0)).toString(36)
}

// ── 備份匯出／匯入（只在裝置本機產生檔案，不上傳）──────────────
export function exportLookoutsJson(list: Lookout[]): string {
  return JSON.stringify({ tag: 'argus-lookouts', v: 1, ts: Date.now(), lookouts: list }, null, 2)
}

/** 從備份 JSON 解析瞭望哨（去 id）。回傳 null 表格式不符。 */
export function parseLookoutsJson(text: string): Omit<Lookout, 'id'>[] | null {
  try {
    const j = JSON.parse(text) as { lookouts?: unknown }
    const arr = Array.isArray(j.lookouts) ? j.lookouts : Array.isArray(j) ? (j as unknown[]) : null
    if (!arr) return null
    const n = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
    const out: Omit<Lookout, 'id'>[] = []
    for (const raw of arr) {
      if (!raw || typeof raw !== 'object') continue
      const r = raw as Partial<Lookout>
      if (typeof r.lat !== 'number' || typeof r.lng !== 'number') continue
      out.push({
        name: typeof r.name === 'string' ? r.name : '匯入瞭望哨',
        lat: r.lat,
        lng: r.lng,
        eyeM: n(r.eyeM, 10),
        targetM: n(r.targetM, 1),
        maxKm: n(r.maxKm, 15),
      })
    }
    return out
  } catch {
    return null
  }
}
