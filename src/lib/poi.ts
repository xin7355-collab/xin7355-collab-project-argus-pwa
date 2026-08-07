// ── 自訂點位 / 群組（海上檢查據點等，私有・只存本機）─────────────
//
// 需求：使用者要放自己的據點（檢查據點、分署…），自訂圖示(emoji)＋顏色，
// 依群組開關顯示，且「不讓別人看到」。故：
//   - 全部只存 localStorage（argus.poi.*），自動含進備份匯出，絕不上傳。
//   - 一個「全部隱藏」總開關，旁邊有人時一鍵藏起來。
// 這裡只做「框架」，實際點位由使用者自己新增。

import { newId } from './savedCoords'

export interface PoiGroup {
  id: string
  name: string
  /** 圖示 emoji（例：🛡️🏛️⚓🚔）。 */
  icon: string
  /** 記號顏色（hex）。 */
  color: string
  /** 此群組是否顯示。 */
  visible: boolean
}

export interface PoiPoint {
  id: string
  groupId: string
  label: string
  lat: number
  lng: number
  note?: string
  /** 海拔（公尺）；null=查過但無資料，undefined=尚未查。 */
  elevM?: number | null
  createdAt: number
}

const K_GROUPS = 'argus.poi.groups.v1'
const K_POINTS = 'argus.poi.points.v1'
const K_HIDDEN = 'argus.poi.hidden.v1'

/** 群組圖示 emoji 快選集（海上情境，分類用）。 */
export const POI_ICONS = [
  // 機關/據點
  '🛡️', '🏛️', '🏢', '🗼', '🏭', '🏫', '🏥', '⚓', '🚨', '🚔',
  // 海上載具
  '⛴️', '🛥️', '🚤', '⛵', '🚢', '🛳️', '🚁', '🛟', '🎣', '🐟',
  // 標記/方向
  '📍', '📌', '🚩', '🏁', '🏴', '🎯', '🧭', '🔦', '⚠️', '🚧',
  // 數字（分署/編號好分類）
  '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟',
  // 顏色圓（純視覺分類）
  '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚫', '⚪', '🟤', '🔺',
]

/** 群組顏色快選集。 */
export const POI_COLORS = [
  '#f43f5e', '#f59e0b', '#22d3ee', '#34d399', '#a78bfa', '#f472b6', '#60a5fa', '#fbbf24',
]

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}
function write(key: string, val: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(val))
  } catch {
    /* 空間滿/隱私模式，忽略 */
  }
}

export function loadGroups(): PoiGroup[] {
  const list = read<PoiGroup[]>(K_GROUPS, [])
  return Array.isArray(list) ? list.filter((g) => g && typeof g.id === 'string') : []
}
export function persistGroups(list: PoiGroup[]) {
  write(K_GROUPS, list)
}

export function loadPoints(): PoiPoint[] {
  const list = read<PoiPoint[]>(K_POINTS, [])
  return Array.isArray(list) ? list.filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng)) : []
}
export function persistPoints(list: PoiPoint[]) {
  write(K_POINTS, list)
}

export function loadHidden(): boolean {
  return read<boolean>(K_HIDDEN, false) === true
}
export function persistHidden(v: boolean) {
  write(K_HIDDEN, v)
}

export { newId }
