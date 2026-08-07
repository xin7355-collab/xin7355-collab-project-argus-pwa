// ── 全域型別定義 ───────────────────────────────────────────

/**
 * 「一鍵戰術模式」。互斥：同一時間只有一種在運行，
 * 藉此強制「同一時間只有一種重度資源」的省電原則。
 *   orbit   軌道預警 · sar 雷達盲搜 · optical 沿岸光學
 *   ais     船舶識別 · rescue 搜救推演（風/流/漂流）
 */
export type TacticalMode =
  | 'basic' // 基本地圖：無任何模式疊層（乾淨底圖）；點亮起的模式即回到此狀態
  | 'orbit'
  | 'sar'
  | 'optical'
  | 'ais'
  | 'rescue'
  | 'seastate'
  | 'envanim'
  | 'typhoon'

/** Web Worker 回傳的單顆衛星即時狀態。 */
export interface SatelliteState {
  id: string
  name: string
  lat: number
  lng: number
  /** 高度（km），僅供顯示。 */
  altKm: number
  /** 最近的軌跡點（[lat, lng]），畫尾巴用。 */
  trail: [number, number][]
}

/** 主執行緒 → Worker 的指令。 */
export type WorkerCommand =
  | { type: 'start' }
  | { type: 'stop' }
  | { type: 'setRate'; fps: number }

/** Worker → 主執行緒的訊息。 */
export type WorkerMessage = {
  type: 'positions'
  epoch: number
  satellites: SatelliteState[]
}

/** 邊緣 AI 回傳的 GeoJSON FeatureCollection（船隻偵測結果）。 */
export interface DetectionFeature {
  type: 'Feature'
  geometry: { type: 'Point'; coordinates: [number, number] } // [lng, lat]
  properties: {
    confidence: number
    label: string
    /** 是否為「疑似無名船隻」→ 紅色警示。 */
    suspicious: boolean
  }
}

export interface DetectionCollection {
  type: 'FeatureCollection'
  features: DetectionFeature[]
}

/** 使用者框選的分析區域（bbox）。 */
export interface BBox {
  west: number
  south: number
  east: number
  north: number
}
