// ── 颱風「預報員解讀」白話摘要 + 侵襲機率估計 ──────────────
//
// 參考在地氣象 App 做法：把路徑資料轉成一句人話——目前相對台灣的方位/距離、
// 移動方向、近中心風、最近接近距離、侵襲機率與白話建議。純函式、可驗證。

import { currentPoint, type Typhoon } from './typhoon'

const TW = { lat: 23.7, lng: 121.0 } // 台灣中心
const DEG = Math.PI / 180
const R = 6371
function km(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const a =
    Math.sin(((lat2 - lat1) * DEG) / 2) ** 2 +
    Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(((lng2 - lng1) * DEG) / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}
function bearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const y = Math.sin((lng2 - lng1) * DEG) * Math.cos(lat2 * DEG)
  const x =
    Math.cos(lat1 * DEG) * Math.sin(lat2 * DEG) -
    Math.sin(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.cos((lng2 - lng1) * DEG)
  return (Math.atan2(y, x) / DEG + 360) % 360
}
const DIRS = ['北', '東北', '東', '東南', '南', '西南', '西', '西北']
function dir8(deg: number): string {
  return DIRS[Math.round(deg / 45) % 8]
}

export interface TyphoonBrief {
  headline: string
  prob: number
  threat: 'low' | 'mid' | 'high' | 'extreme'
  advice: string
  distNowKm: number
  closestKm: number
}

/**
 * ref = 參考點（有 GPS 就用你的實際位置，否則台灣中心）；
 * refLabel = 顯示用（『您所在位置』或『台灣』）。
 */
export function typhoonBrief(ty: Typhoon, ref = TW, refLabel = '台灣'): TyphoonBrief {
  const cur = currentPoint(ty)
  const future = ty.track.filter((p) => p.hours > 0)
  const distNow = km(ref.lat, ref.lng, cur.lat, cur.lng)
  const brgNow = dir8(bearing(ref.lat, ref.lng, cur.lat, cur.lng))
  const nxt = future[0] ?? cur
  const moveTxt = future.length ? dir8(bearing(cur.lat, cur.lng, nxt.lat, nxt.lng)) : '原地'
  const windMs = Math.round(cur.windKt * 0.5144)

  let closest = distNow
  for (const p of future) closest = Math.min(closest, km(ref.lat, ref.lng, p.lat, p.lng))
  const gap = closest - cur.galeRadiusKm

  let prob: number
  let threat: TyphoonBrief['threat']
  let advice: string
  if (gap <= 0) {
    prob = 80
    threat = 'extreme'
    advice = '暴風圈可能直接影響，建議立即啟動應變、發布警戒、船艇進港。'
  } else if (gap <= 100) {
    prob = 45
    threat = 'high'
    advice = '接近中，密切監控並預做整備，注意後續是否發布海警。'
  } else if (gap <= 300) {
    prob = 15
    threat = 'mid'
    advice = '保持關注，持續蒐集後續預報。'
  } else if (gap <= 600) {
    prob = 6
    threat = 'low'
    advice = '威脅尚低，維持追蹤即可，暫可照常管理。'
  } else {
    prob = 2
    threat = 'low'
    advice = '距離遠、影響機率低，正常作業。'
  }

  const headline =
    `颱風「${ty.name}」目前位於${refLabel}${brgNow}方海面約 ${Math.round(distNow)} 公里處，` +
    `向${moveTxt}方移動，近中心風約 ${windMs} m/s（${cur.windKt} kt）；` +
    `預估最近接近至約 ${Math.round(closest)} 公里。侵襲機率估計約 ${prob}%。`

  return { headline, prob, threat, advice, distNowKm: distNow, closestKm: closest }
}
