// ── 日出/日落/曙暮光（NOAA 日出方程，純函式免金鑰）──────────
//
// 搜救很看「還有多久天黑」——關係到目視搜索窗口與落海者存活。這裡對搜索點
// 算當日日出、日落、民用曙光(dawn)/暮光(dusk)，全部本機計算、無需連網。

const DEG = Math.PI / 180
const J2000 = 2451545.0
const J1970 = 2440587.5

function toJulian(epoch: number): number {
  return epoch / 86400000 + J1970
}
function fromJulian(j: number): number {
  return (j - J1970) * 86400000
}

/** 計算某地某日的太陽事件（回傳 epoch ms，UTC；顯示時用本地時區）。 */
export interface SunTimes {
  sunrise: number | null
  sunset: number | null
  dawn: number | null // 民用曙光開始（日出前）
  dusk: number | null // 民用暮光結束（日落後）
  transit: number // 正午（太陽最高）
  polar: 'day' | 'night' | null // 永晝/永夜（高緯）
}

/** 給定「當天某 epoch」與座標，算太陽事件。 */
export function sunTimes(epoch: number, lat: number, lng: number): SunTimes {
  const jd = toJulian(epoch)
  const n = Math.round(jd - J2000 + 0.0008)
  const jStar = n - lng / 360 // 平太陽正午
  const M = (357.5291 + 0.98560028 * jStar) % 360
  const Mr = M * DEG
  const C = 1.9148 * Math.sin(Mr) + 0.02 * Math.sin(2 * Mr) + 0.0003 * Math.sin(3 * Mr)
  const lambda = (M + C + 180 + 102.9372) % 360
  const lr = lambda * DEG
  const transitJ = J2000 + jStar + 0.0053 * Math.sin(Mr) - 0.0069 * Math.sin(2 * lr)
  const sinDec = Math.sin(lr) * Math.sin(23.44 * DEG)
  const dec = Math.asin(sinDec)
  const phi = lat * DEG

  const hourAngle = (angleDeg: number): number | null => {
    const cosw = (Math.sin(angleDeg * DEG) - Math.sin(phi) * sinDec) / (Math.cos(phi) * Math.cos(dec))
    if (cosw > 1 || cosw < -1) return null
    return Math.acos(cosw) / DEG
  }

  const w0 = hourAngle(-0.833) // 日出日落（含大氣折射+日盤半徑）
  const w6 = hourAngle(-6) // 民用曙暮光

  let polar: 'day' | 'night' | null = null
  if (w0 === null) {
    // 判斷永晝或永夜：正午太陽高度
    const noonAlt = 90 - Math.abs(lat - dec / DEG)
    polar = noonAlt > 0 ? 'day' : 'night'
  }

  return {
    sunrise: w0 === null ? null : fromJulian(transitJ - w0 / 360),
    sunset: w0 === null ? null : fromJulian(transitJ + w0 / 360),
    dawn: w6 === null ? null : fromJulian(transitJ - w6 / 360),
    dusk: w6 === null ? null : fromJulian(transitJ + w6 / 360),
    transit: fromJulian(transitJ),
    polar,
  }
}
