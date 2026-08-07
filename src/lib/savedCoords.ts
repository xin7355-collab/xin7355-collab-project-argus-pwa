// ── 已存座標 / 歷史（localStorage 持久化）──────────────────
//
// 釘選(pinned)：地圖上長駐的記號，切換模式也不會不見，直到取消。
// 最愛(favorite)：常用點清單，隨時一鍵跳過去。
// 歷史(history)：用過的座標自動記錄（去重、上限）。

export interface SavedCoord {
  id: string
  lat: number
  lng: number
  label: string
  favorite: boolean
  pinned: boolean
  createdAt: number
}

export interface HistItem {
  lat: number
  lng: number
  at: number
}

const K_SAVED = 'argus.coords.saved.v1'
const K_HIST = 'argus.coords.hist.v1'
const HIST_MAX = 15

let idSeq = 0
export function newId(now: number): string {
  idSeq = (idSeq + 1) % 100000
  return `${now.toString(36)}-${idSeq.toString(36)}`
}

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
    /* 儲存空間滿或隱私模式，忽略 */
  }
}

export function loadSaved(): SavedCoord[] {
  const list = read<SavedCoord[]>(K_SAVED, [])
  return Array.isArray(list) ? list.filter((c) => Number.isFinite(c?.lat) && Number.isFinite(c?.lng)) : []
}
export function persistSaved(list: SavedCoord[]) {
  write(K_SAVED, list)
}

export function loadHistory(): HistItem[] {
  const list = read<HistItem[]>(K_HIST, [])
  return Array.isArray(list) ? list : []
}
export function persistHistory(list: HistItem[]) {
  write(K_HIST, list)
}

/** 加一筆歷史（去重：0.001° 內視為同點），最新在前，上限 HIST_MAX。 */
export function pushHistory(list: HistItem[], lat: number, lng: number, at: number): HistItem[] {
  const dedup = list.filter((h) => Math.abs(h.lat - lat) > 0.001 || Math.abs(h.lng - lng) > 0.001)
  return [{ lat, lng, at }, ...dedup].slice(0, HIST_MAX)
}
