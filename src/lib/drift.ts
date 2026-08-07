// ── 落海漂流預判引擎 (Search & Rescue drift model) ──────────
//
// 純函式、無副作用、可單元測試。輸入落海點 + 風 + 洋流，輸出未來
// 各時間點的預測位置與「搜索半徑」（不確定性隨時間擴大）。
//
// 模型（簡化 SAR leeway）：
//   總漂移 = 洋流漂移向量 + 風致漂移向量(leeway)
//   - 洋流：直接以洋流速度×時間位移，方向 = 洋流流向（toward）
//   - leeway：漂浮人體約為風速的 ~3%，方向順風（downwind）
//   搜索半徑：隨時間與漂移距離擴大（累積定位誤差 + 洋流/風不確定性）
//
// 註：這是給第一線快速決策用的近似模型，不取代官方 SAROPS。

export interface DriftPoint {
  hours: number
  lat: number
  lng: number
  /** 從落海點算起的漂移距離 (m)。 */
  driftMeters: number
  /** 建議搜索半徑 (m)。 */
  radiusMeters: number
  /** 該時刻的總漂移方向（度，toward）。 */
  bearingDeg: number
}

/**
 * 漂流物體類型與其風壓漂移係數 (leeway)。不同物體受風影響差很多：
 * 救生筏有帆布受風大、落海人幾乎沒入水中受風小。數值為近似 SAR 經驗值。
 */
export interface DriftTarget {
  id: string
  label: string
  leeway: number
  icon: string
}

export const DRIFT_TARGETS: DriftTarget[] = [
  { id: 'piw', label: '落海人', leeway: 0.014, icon: '🏊' },
  { id: 'lifejacket', label: '救生衣浮者', leeway: 0.02, icon: '🦺' },
  { id: 'liferaft', label: '救生筏', leeway: 0.03, icon: '🛟' },
  // 台灣本土化：舢舨、管筏（塑膠管漁筏）受風面積較大，偏航較高
  { id: 'sampan', label: '舢舨', leeway: 0.04, icon: '🛶' },
  { id: 'raft', label: '管筏', leeway: 0.045, icon: '🧑‍🌾' },
  { id: 'boat', label: '小船', leeway: 0.05, icon: '🚤' },
]

/** 把方向度數轉成 8 方位中文，給 UI 顯示用。 */
export function bearingToText(deg: number): string {
  const dirs = ['北', '東北', '東', '東南', '南', '西南', '西', '西北']
  return dirs[Math.round((deg % 360) / 45) % 8]
}
