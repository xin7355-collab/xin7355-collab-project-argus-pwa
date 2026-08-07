// ── 攔截解算（constant-bearing intercept）────────────────────
// 給定我方位置/航速、目標位置/航向/航速，求「往哪個方向開、幾分鐘能攔到、
// 攔截點在哪」。平面近似（數十浬內誤差可忽略），純幾何、免金鑰、可離線。

export interface InterceptInput {
  own: { lat: number; lng: number }
  ownSpeedKn: number
  target: { lat: number; lng: number }
  targetCourseDeg: number
  targetSpeedKn: number
}

export interface InterceptResult {
  feasible: boolean
  /** 不可行原因（feasible=false 時填）。 */
  reason?: string
  /** 我方應操之航向（度，真北）。 */
  courseDeg: number
  /** 攔截所需時間（分鐘）。 */
  timeMin: number
  /** 攔截點座標。 */
  point: { lat: number; lng: number }
  /** 我方到攔截點的航程（浬）。 */
  ownDistNm: number
  /** 目標到攔截點的航程（浬）。 */
  targetDistNm: number
  /** 目標目前的距離（浬）與方位（度）。 */
  rangeNm: number
  bearingDeg: number
  /** 接近速率（浬/時，>0 表拉近）。 */
  closingKn: number
}

const DEG = Math.PI / 180

/** 把相對位移（東/北，浬）換算成航向度（0=北、90=東）。 */
function vecToCourse(east: number, north: number): number {
  return (Math.atan2(east, north) / DEG + 360) % 360
}

/**
 * 求攔截解。座標系：以我方為原點，東(x)/北(y) 浬為單位；
 * 航速為浬/時（節），時間為時。
 */
export function solveIntercept(inp: InterceptInput): InterceptResult {
  const { own, target, ownSpeedKn: So, targetCourseDeg, targetSpeedKn: St } = inp
  const midLat = (own.lat + target.lat) / 2
  const cosLat = Math.cos(midLat * DEG) || 1e-6

  // 目標相對我方的位移（浬）
  const east = (target.lng - own.lng) * 60 * cosLat
  const north = (target.lat - own.lat) * 60
  const rangeNm = Math.hypot(east, north)
  const bearingDeg = vecToCourse(east, north)

  const base: InterceptResult = {
    feasible: false,
    courseDeg: bearingDeg,
    timeMin: 0,
    point: { ...target },
    ownDistNm: 0,
    targetDistNm: 0,
    rangeNm,
    bearingDeg,
    closingKn: 0,
  }

  if (So <= 0) return { ...base, reason: '我方航速需大於 0。' }
  if (rangeNm < 1e-4) return { ...base, feasible: true, reason: undefined, courseDeg: targetCourseDeg }

  // 視線單位向量 u（我→目標），以及其左垂直 p
  const ux = east / rangeNm
  const uy = north / rangeNm
  const px = -uy
  const py = ux

  // 目標速度向量（東/北）
  const tvx = St * Math.sin(targetCourseDeg * DEG)
  const tvy = St * Math.cos(targetCourseDeg * DEG)
  const tPar = tvx * ux + tvy * uy // 沿視線分量（+ 遠離我）
  const tPerp = tvx * px + tvy * py // 垂直視線分量

  // 定常方位攔截：我方垂直分量須等於目標垂直分量
  if (Math.abs(tPerp) > So) {
    return { ...base, reason: '目標橫向速度超過我方航速，任何航向都攔不到（需更快的船或呼叫增援）。' }
  }
  const oPar = Math.sqrt(So * So - tPerp * tPerp) // 我方沿視線分量（取正＝朝目標）
  const closing = oPar - tPar
  if (closing <= 1e-6) {
    return { ...base, reason: '目標順沿逃離、速度過快，追不上（改用攔截線佈署或增援）。' }
  }

  const tHr = rangeNm / closing
  const timeMin = tHr * 60

  // 我方速度向量 = oPar·u + tPerp·p（垂直分量與目標相同 → 定常方位）
  const ovx = oPar * ux + tPerp * px
  const ovy = oPar * uy + tPerp * py
  const courseDeg = vecToCourse(ovx, ovy)

  // 攔截點 = 目標現位 + 目標速度 × t
  const ipEast = east + tvx * tHr
  const ipNorth = north + tvy * tHr
  const point = {
    lat: own.lat + ipNorth / 60,
    lng: own.lng + ipEast / (60 * cosLat),
  }
  const ownDistNm = So * tHr
  const targetDistNm = St * tHr

  return {
    feasible: true,
    courseDeg,
    timeMin,
    point,
    ownDistNm,
    targetDistNm,
    rangeNm,
    bearingDeg,
    closingKn: closing,
  }
}

/**
 * 推算船位（dead reckoning）：從起點以定航向、定航速直航一段時間後的位置。
 * minutes 為正＝往未來推、為負＝回推來時位置。平面近似。
 */
export function projectPosition(
  start: { lat: number; lng: number },
  courseDeg: number,
  speedKn: number,
  minutes: number,
): { lat: number; lng: number } {
  const distNm = speedKn * (minutes / 60)
  const east = distNm * Math.sin(courseDeg * DEG)
  const north = distNm * Math.cos(courseDeg * DEG)
  const cosLat = Math.cos(start.lat * DEG) || 1e-6
  return {
    lat: start.lat + north / 60,
    lng: start.lng + east / (60 * cosLat),
  }
}

/** 方位度轉八方位中文（0=北）。 */
export function courseToText(deg: number): string {
  const dirs = ['北', '東北', '東', '東南', '南', '西南', '西', '西北']
  return dirs[Math.round(((deg % 360) / 45)) % 8]
}
