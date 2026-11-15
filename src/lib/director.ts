// ── 導演鏡頭：記下幾個 3D 畫面，依序飛過去播放 ─────────────────
//
// 用途：簡報、勤前說明時，一鍵依序飛到「台灣全島 → 海峽斜看 → 某個港口」，
// 不用每次手動轉鏡頭。概念參考 gods-eye-view（MIT，見 docs/licenses/gods-eye-view-MIT.txt）
// 的導演模式；這裡只做「鏡頭清單＋依序飛」，資料格式自己定、角度一律用「度」方便人看。
// 存在這支手機（localStorage），不上傳。純函式，可離線測。

export interface Shot {
  id: string
  name: string
  /** 經度（度）。 */
  lon: number
  /** 緯度（度）。 */
  lat: number
  /** 鏡頭離地高度（公尺）。 */
  height: number
  /** 朝向（度，0＝北、90＝東）。 */
  heading: number
  /** 俯仰（度，-90＝正下方、0＝平視）。 */
  pitch: number
  /** 翻滾（度）。 */
  roll: number
  /** 從上一個鏡頭飛過來要幾秒。 */
  flySec: number
  /** 到了以後停幾秒。 */
  holdSec: number
}

export type CameraView = Pick<Shot, 'lon' | 'lat' | 'height' | 'heading' | 'pitch' | 'roll'>

/** 高度範圍：100 公尺（看港內）到 4 萬公里（看整顆地球）。 */
export const SHOT_HEIGHT_MIN = 100
export const SHOT_HEIGHT_MAX = 40_000_000
export const FLY_SEC_MAX = 60
export const HOLD_SEC_MAX = 600
export const SHOT_NAME_MAX = 30
/** 清單最多幾個鏡頭（localStorage 很小，也不會有人排一百個）。 */
export const SHOTS_MAX = 50
export const DEFAULT_FLY_SEC = 4
export const DEFAULT_HOLD_SEC = 3

const STORAGE_KEY = 'argus.director.v1'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
/** 角度轉到 0～360。 */
const wrap360 = (d: number) => ((d % 360) + 360) % 360

/** 檢查、修整一個鏡頭；壞掉的回 null（讀舊資料或別人改過的資料時用）。 */
export function cleanShot(x: unknown): Shot | null {
  if (!x || typeof x !== 'object') return null
  const o = x as Record<string, unknown>
  const n = (k: string) => (typeof o[k] === 'number' && Number.isFinite(o[k]) ? (o[k] as number) : null)
  const lon = n('lon')
  const lat = n('lat')
  const height = n('height')
  if (lon === null || lat === null || height === null) return null
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || height <= 0) return null
  const id = typeof o.id === 'string' && o.id ? o.id.slice(0, 40) : null
  if (!id) return null
  const name = (typeof o.name === 'string' ? o.name : '').trim().slice(0, SHOT_NAME_MAX) || '未命名鏡頭'
  return {
    id,
    name,
    lon,
    lat,
    height: clamp(height, SHOT_HEIGHT_MIN, SHOT_HEIGHT_MAX),
    heading: wrap360(n('heading') ?? 0),
    pitch: clamp(n('pitch') ?? -90, -90, 0),
    roll: clamp(n('roll') ?? 0, -180, 180),
    flySec: clamp(n('flySec') ?? DEFAULT_FLY_SEC, 0, FLY_SEC_MAX),
    holdSec: clamp(n('holdSec') ?? DEFAULT_HOLD_SEC, 0, HOLD_SEC_MAX),
  }
}

/** 內建的幾個鏡頭（公開地理位置），第一次打開時當範例。 */
export const PRESET_SHOTS: Shot[] = [
  { id: 'preset-taiwan', name: '台灣全島', lon: 120.9, lat: 23.6, height: 1_100_000, heading: 0, pitch: -90, roll: 0, flySec: 3, holdSec: 3 },
  { id: 'preset-strait', name: '台灣海峽（由南往北看）', lon: 119.6, lat: 20.8, height: 350_000, heading: 15, pitch: -32, roll: 0, flySec: 5, holdSec: 4 },
  { id: 'preset-dongsha', name: '東沙島', lon: 116.72, lat: 20.55, height: 45_000, heading: 0, pitch: -60, roll: 0, flySec: 5, holdSec: 3 },
  { id: 'preset-taiping', name: '太平島', lon: 114.366, lat: 10.25, height: 45_000, heading: 0, pitch: -60, roll: 0, flySec: 6, holdSec: 3 },
]

type Store = Pick<Storage, 'getItem' | 'setItem'>
const defaultStore = (): Store | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** 讀鏡頭清單。沒存過回內建範例；資料壞掉的鏡頭丟掉（不讓一個壞的毀了整份）。 */
export function loadShots(store: Store | null = defaultStore()): Shot[] {
  let raw: string | null = null
  try {
    raw = store?.getItem(STORAGE_KEY) ?? null
  } catch {
    raw = null
  }
  if (raw === null) return PRESET_SHOTS.map((s) => ({ ...s }))
  try {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return PRESET_SHOTS.map((s) => ({ ...s }))
    const seen = new Set<string>()
    const out: Shot[] = []
    for (const x of arr) {
      const s = cleanShot(x)
      if (s && !seen.has(s.id)) {
        seen.add(s.id)
        out.push(s)
      }
    }
    return out.slice(0, SHOTS_MAX)
  } catch {
    return PRESET_SHOTS.map((s) => ({ ...s }))
  }
}

/** 存鏡頭清單。存不了（無痕模式、空間滿）回 false，畫面要說「沒存到」。 */
export function persistShots(shots: Shot[], store: Store | null = defaultStore()): boolean {
  try {
    if (!store) return false
    store.setItem(STORAGE_KEY, JSON.stringify(shots.slice(0, SHOTS_MAX)))
    return true
  } catch {
    return false
  }
}

/** 把目前鏡頭加到清單最後。名字沒給就用「鏡頭 N」。清單滿了回原清單。 */
export function addShot(shots: Shot[], view: CameraView, id: string, name?: string): Shot[] {
  if (shots.length >= SHOTS_MAX) return shots
  const s = cleanShot({ ...view, id, name: name || `鏡頭 ${shots.length + 1}`, flySec: DEFAULT_FLY_SEC, holdSec: DEFAULT_HOLD_SEC })
  return s ? [...shots, s] : shots
}

/** 往前（-1）或往後（+1）移一格；已經在頭尾就不動。 */
export function moveShot(shots: Shot[], id: string, dir: -1 | 1): Shot[] {
  const i = shots.findIndex((s) => s.id === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= shots.length) return shots
  const out = shots.slice()
  ;[out[i], out[j]] = [out[j], out[i]]
  return out
}

export function removeShot(shots: Shot[], id: string): Shot[] {
  return shots.filter((s) => s.id !== id)
}

/** 改一個鏡頭的名字或秒數（會經過 cleanShot 修整）。 */
export function updateShot(shots: Shot[], id: string, patch: Partial<Pick<Shot, 'name' | 'flySec' | 'holdSec'>>): Shot[] {
  return shots.map((s) => (s.id === id ? (cleanShot({ ...s, ...patch }) ?? s) : s))
}

export interface TourStep {
  id: string
  /** 從開始播放算起，開始飛向這個鏡頭的秒數。 */
  startSec: number
  /** 到達的秒數。 */
  arriveSec: number
  /** 停完、要飛下一個的秒數。 */
  leaveSec: number
}

/** 整段播放的時間表（第一個鏡頭也照它的 flySec 飛過去）。 */
export function tourTimeline(shots: Shot[]): TourStep[] {
  let t = 0
  return shots.map((s) => {
    const startSec = t
    const arriveSec = startSec + s.flySec
    const leaveSec = arriveSec + s.holdSec
    t = leaveSec
    return { id: s.id, startSec, arriveSec, leaveSec }
  })
}

/** 「全長 1 分 05 秒」。 */
export function durationText(shots: Shot[]): string {
  const steps = tourTimeline(shots)
  const total = Math.round(steps.length ? steps[steps.length - 1].leaveSec : 0)
  const m = Math.floor(total / 60)
  const s = total % 60
  return m ? `${m} 分 ${String(s).padStart(2, '0')} 秒` : `${s} 秒`
}

/** 高度給人看：1,100 公里／45 公里／800 公尺。 */
export function heightText(m: number): string {
  if (m >= 10_000) return `${Math.round(m / 1000).toLocaleString('en-US')} 公里`
  if (m >= 1000) return `${(m / 1000).toFixed(1)} 公里`
  return `${Math.round(m)} 公尺`
}
