import { bearingDeg, destPoint, distanceKm } from './windRadar.ts'

// ── 衛星地面軌跡與掃描帶 ───────────────────────────────────
//
// 把「下次過境」從一張時刻表，變成地圖上畫得出來的東西：
// 衛星飛過去的那條線（地面軌跡），以及感測器實際掃到的那條帶（掃幅）。
//
// ── 模型與它的極限（請先讀完再用）────────────────────────
// 這裡用的是「圓軌道近似」：給定一個已知時刻的星下點、軌道傾角與週期，
// 往前往後推算軌跡。對地球觀測衛星（近圓軌道、嚴格維持軌位）在一兩圈之內
// 夠準，可以回答「這一趟會不會掃到我這片海」。
//
// 它**不是** SGP4。沒有考慮軌道攝動（J2 造成的升交點漂移、大氣阻力），
// 所以推算越久誤差越大，不要拿來預報好幾天以後的事。
//
// 更重要的是：它需要一個「已知時刻的星下點」當錨點。沒有那個錨點，
// 這個模組什麼都算不出來——軌道傾角只決定軌跡的形狀與方向，
// 決定它「畫在地圖上哪個位置」的是錨點。呼叫端沒拿到真實位置時，
// 必須明講那是示意圖，不可以拿假錨點硬畫。

/** 恆星日（秒）。地球自轉要用恆星日，不是 86400 的太陽日——
 *  一圈 90 分鐘的軌道用錯會差約 0.37 度經度，一天累積下來很可觀。 */
const SIDEREAL_DAY_S = 86164.0905

const DEG = Math.PI / 180

/** 軌道錨點：某個已知時刻的星下點，加上軌道形狀。 */
export interface OrbitAnchor {
  /** 參考時刻（毫秒）。 */
  at: number
  /** 該時刻的星下點緯度（度）。 */
  lat: number
  /** 該時刻的星下點經度（度）。 */
  lng: number
  /** 軌道傾角（度）。太陽同步軌道約 98；ISS 約 51.6。 */
  inclinationDeg: number
  /** 軌道週期（分鐘）。 */
  periodMin: number
  /** 參考時刻在上升段（往北飛）為 true，下降段為 false。 */
  ascending: boolean
}

export interface TrackPoint {
  lat: number
  lng: number
  /** 這個點對應的時刻（毫秒）。 */
  at: number
}

/** 把經度收斂到 (-180, 180]。 */
export function wrapLng(lng: number): number {
  let v = ((lng + 180) % 360 + 360) % 360 - 180
  if (v === -180) v = 180
  return v
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/**
 * 由錨點反推它的「緯度幅角」u（從升交點算起的角度）。
 *
 * sin(lat) = sin(i)·sin(u)。asin 只給 [-90,90]，那是上升段；
 * 下降段是 180° − u。傾角小於錨點緯度時無解（物理上到不了那個緯度），
 * 這時夾到極值，讓呼叫端至少拿得到一條合理的線而不是 NaN。
 */
function anchorU(a: OrbitAnchor): number {
  const i = a.inclinationDeg * DEG
  const si = Math.sin(i)
  if (Math.abs(si) < 1e-9) return 0 // 赤道軌道
  const u = Math.asin(clamp(Math.sin(a.lat * DEG) / si, -1, 1))
  return a.ascending ? u : Math.PI - u
}

/** 相對於升交點的經度差（弧度）。 */
function nodeOffset(i: number, u: number): number {
  return Math.atan2(Math.cos(i) * Math.sin(u), Math.cos(u))
}

/** 推算某個時刻的星下點。 */
export function subPointAt(a: OrbitAnchor, tMs: number): { lat: number; lng: number } {
  const i = a.inclinationDeg * DEG
  const u0 = anchorU(a)
  const dtS = (tMs - a.at) / 1000
  const n = (2 * Math.PI) / (a.periodMin * 60) // 角速度 rad/s
  const u = u0 + n * dtS

  const lat = Math.asin(clamp(Math.sin(i) * Math.sin(u), -1, 1)) / DEG
  // 軌道造成的經度變化 + 地球自轉把地面往東帶（相對而言軌跡往西移）
  const dLon = (nodeOffset(i, u) - nodeOffset(i, u0)) / DEG
  const earth = (-360 * dtS) / SIDEREAL_DAY_S
  return { lat, lng: wrapLng(a.lng + dLon + earth) }
}

/**
 * 產生一段地面軌跡。stepS 預設 20 秒——對 90 分鐘的軌道大約每 1.3° 一點，
 * 畫在手機上已經夠平滑，再密只是浪費記憶體。
 */
export function groundTrack(
  a: OrbitAnchor,
  fromMs: number,
  toMs: number,
  stepS = 20,
): TrackPoint[] {
  const out: TrackPoint[] = []
  const step = Math.max(1, stepS) * 1000
  for (let t = fromMs; t <= toMs; t += step) {
    const p = subPointAt(a, t)
    out.push({ lat: p.lat, lng: p.lng, at: t })
  }
  return out
}

/**
 * 把軌跡切成不跨越換日線的小段。
 *
 * 不切的話，經度從 +180 跳到 -180 時 Leaflet 會畫一條橫貫整張地圖的假線。
 */
export function splitAtDateline(track: TrackPoint[]): TrackPoint[][] {
  const segs: TrackPoint[][] = []
  let cur: TrackPoint[] = []
  for (const p of track) {
    const prev = cur[cur.length - 1]
    if (prev && Math.abs(p.lng - prev.lng) > 180) {
      if (cur.length > 1) segs.push(cur)
      cur = []
    }
    cur.push(p)
  }
  if (cur.length > 1) segs.push(cur)
  return segs
}

/**
 * 掃幅的左右邊界。感測器掃的是軌跡兩側各 swathKm/2 的帶狀範圍。
 * 回傳的 right 已經反轉過，left ++ right 直接就是一個封閉多邊形。
 */
export function swathEdges(
  track: TrackPoint[],
  swathKm: number,
): { left: [number, number][]; right: [number, number][] } {
  const half = swathKm / 2
  const left: [number, number][] = []
  const right: [number, number][] = []
  for (let k = 0; k < track.length; k++) {
    const p = track[k]
    // 用前後點求航向；端點就用相鄰的那一段
    const a = track[Math.max(0, k - 1)]
    const b = track[Math.min(track.length - 1, k + 1)]
    if (a === b) continue
    const brg = bearingDeg(a.lat, a.lng, b.lat, b.lng)
    left.push(destPoint(p.lat, p.lng, brg - 90, half))
    right.push(destPoint(p.lat, p.lng, brg + 90, half))
  }
  return { left, right: right.reverse() }
}

/** 軌跡上離某個點最近的位置與距離。 */
export function nearestApproach(
  track: TrackPoint[],
  lat: number,
  lng: number,
): { km: number; at: number; idx: number } | null {
  if (track.length === 0) return null
  let best = { km: Infinity, at: track[0].at, idx: 0 }
  for (let k = 0; k < track.length; k++) {
    const d = distanceKm(lat, lng, track[k].lat, track[k].lng)
    if (d < best.km) best = { km: d, at: track[k].at, idx: k }
  }
  return best
}

/**
 * 這一趟掃不掃得到某個點。
 *
 * 判斷方式是「最近距離是否在掃幅半寬之內」。這是沿著軌跡取樣的近似，
 * 在掃幅邊緣（差幾公里）不要當成準確答案——真正的邊界還受姿態與
 * 實際取像排程影響，那是這個模型管不到的。
 */
export function coversPoint(
  track: TrackPoint[],
  swathKm: number,
  lat: number,
  lng: number,
): { covered: boolean; km: number; at: number } | null {
  const near = nearestApproach(track, lat, lng)
  if (!near) return null
  return { covered: near.km <= swathKm / 2, km: near.km, at: near.at }
}


/** 一次「掃過目標點」的時段。 */
export interface PassWindow {
  /** 進入掃幅的時刻（毫秒）。 */
  startMs: number
  /** 離開掃幅的時刻（毫秒）。 */
  endMs: number
  /** 這一趟最接近目標的距離（公里）。 */
  closestKm: number
  /** 最接近的時刻（毫秒）。 */
  closestMs: number
}

/**
 * 找出軌跡上所有「掃得到目標點」的時段。
 *
 * 跟 coversPoint 的差別：那個只回答「有沒有、最近多少」，
 * 這個回答「第幾趟、從幾點到幾點」——使用者要排作業時間，需要的是後者。
 *
 * 用取樣點判斷，所以起訖時間的精度就是取樣間隔。邊界幾公里內不要當精準值：
 * 真正的取像邊界還受姿態與排程影響，那不是軌道算得出來的。
 */
export function findPasses(
  track: TrackPoint[],
  swathKm: number,
  lat: number,
  lng: number,
): PassWindow[] {
  const half = swathKm / 2
  const out: PassWindow[] = []
  let cur: PassWindow | null = null

  for (const p of track) {
    const d = distanceKm(lat, lng, p.lat, p.lng)
    if (d <= half) {
      if (!cur) {
        cur = { startMs: p.at, endMs: p.at, closestKm: d, closestMs: p.at }
      } else {
        cur.endMs = p.at
        if (d < cur.closestKm) {
          cur.closestKm = d
          cur.closestMs = p.at
        }
      }
    } else if (cur) {
      out.push(cur)
      cur = null
    }
  }
  if (cur) out.push(cur)
  return out
}
