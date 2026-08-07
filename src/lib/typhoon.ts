// ── 颱風路徑資料 ────────────────────────────────────────────
//
// 即時 W.Pacific 颱風「預報路徑」沒有乾淨的免金鑰 CORS 來源（CWA/JTWC 都無
// 開放 CORS JSON）。這裡提供結構化的示範颱風＋渲染，真實 feed 之後可由
// Cloudflare Worker 代理 GDACS/JTWC 後以相同格式餵入。

export interface TyphoonPoint {
  lat: number
  lng: number
  /** 距現在的小時（0=現在，負=過去，正=預報）。 */
  hours: number
  /** 近中心最大風速（kt）。 */
  windKt: number
  /** 七級暴風半徑（km）。 */
  galeRadiusKm: number
  /** 分類：TD/TS/TY/STY。 */
  cat: string
  /** 是否為「簡易外推」估計點（非官方預報）。 */
  estimated?: boolean
}

export interface Typhoon {
  name: string
  nameEn: string
  demo: boolean
  track: TyphoonPoint[]
  /**
   * 簡易外推預測（青色虛線，非官方）：只有當來源沒有官方預報時刻時才產生，
   * 用「近期移動方向×速度」等速直線外推，供概略參考。正式預報以 CWA 為準。
   */
  estTrack?: TyphoonPoint[]
}

/** 依風速分類（简化，kt）。 */
export function catOf(windKt: number): string {
  if (windKt < 34) return '熱帶低壓 TD'
  if (windKt < 64) return '輕度 TS'
  if (windKt < 100) return '中度 TY'
  return '強烈 STY'
}

/** 示範颱風：自台灣東南方向西北移動、逼近台灣。 */
export function demoTyphoon(): Typhoon {
  const raw: [number, number, number, number, number][] = [
    // lat, lng, hours, windKt, galeRadiusKm
    [19.5, 126.5, -24, 45, 150],
    [20.6, 125.2, -12, 60, 180],
    [21.6, 124.0, 0, 85, 220],
    [22.6, 122.9, 12, 95, 250],
    [23.6, 121.8, 24, 90, 240],
    [24.8, 120.6, 48, 70, 200],
    [26.2, 119.6, 72, 50, 160],
  ]
  return {
    name: '示範颱風',
    nameEn: 'DEMO',
    demo: true,
    track: raw.map(([lat, lng, hours, windKt, galeRadiusKm]) => ({
      lat,
      lng,
      hours,
      windKt,
      galeRadiusKm,
      cat: catOf(windKt),
    })),
  }
}

/** 取「現在」位置點（hours===0，否則最接近 0）。 */
export function currentPoint(t: Typhoon): TyphoonPoint {
  return t.track.reduce((a, b) => (Math.abs(b.hours) < Math.abs(a.hours) ? b : a))
}

/**
 * 是否含「可信的未來預報」（任一點 hours>0）。
 * GDACS 免費資料常只有觀測軌跡（過去/現在），沒有官方預報時刻——此時不可
 * 憑空捏造未來路徑（會畫出方向相反的假預報），改以觀測軌跡呈現並提醒用 CWA。
 */
export function hasForecast(t: Typhoon): boolean {
  return t.track.some((p) => p.hours > 0)
}

const DEG = Math.PI / 180

/**
 * 簡易外推預測（非官方）：用觀測軌跡「近期移動方向×速度」等速直線外推 12/24/36/48h。
 * 只在沒有官方預報時作為概略參考；近乎靜止（<8km/h）或資料不足時回空（不虛構方向）。
 * 方向以「較早的參考點 → 現在」為準（過去→現在），確保外推是往前而非往回。
 */
export function extrapolateTrack(track: TyphoonPoint[]): TyphoonPoint[] {
  const obs = track.filter((p) => p.hours <= 0).sort((a, b) => a.hours - b.hours)
  if (obs.length < 2) return []
  const now = obs[obs.length - 1]
  // 參考點：現在之前、盡量接近 −12h 的觀測點（較單一前點穩定）。
  const older = obs.filter((p) => p.hours < now.hours - 2)
  if (!older.length) return []
  let ref = older[0]
  for (const p of older) {
    if (Math.abs(p.hours - (now.hours - 12)) < Math.abs(ref.hours - (now.hours - 12))) ref = p
  }
  const gapH = now.hours - ref.hours // >0
  if (gapH <= 0) return []
  const vLat = (now.lat - ref.lat) / gapH
  const vLng = (now.lng - ref.lng) / gapH
  const kmh =
    Math.hypot((now.lat - ref.lat) * 111, (now.lng - ref.lng) * 111 * Math.cos(now.lat * DEG)) / gapH
  if (kmh < 8) return [] // 近乎滯留：不硬指方向
  return [12, 24, 36, 48].map((h) => ({
    lat: now.lat + vLat * h,
    lng: now.lng + vLng * h,
    hours: h,
    windKt: now.windKt,
    galeRadiusKm: now.galeRadiusKm,
    cat: now.cat,
    estimated: true,
  }))
}

/** 兩點大圓距離（km）。 */
function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = (bLat - aLat) * DEG
  const dLng = (bLng - aLng) * DEG
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(aLat * DEG) * Math.cos(bLat * DEG) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(s)))
}

/** 影響時窗研判結果（相對「現在」的小時）。 */
export interface ImpactWindow {
  /** 參考點目前是否在七級暴風圈內。 */
  affectedNow: boolean
  /** 目前距颱風中心(km)。 */
  distNowKm: number
  /** 目前七級暴風半徑(km)。 */
  galeNowKm: number
  /** 預估「進入」暴風圈的時刻（小時，相對現在）；不適用時 null。 */
  enterHours: number | null
  /** 預估「脫離／解除」暴風圈的時刻（小時，相對現在）；預報期內未脫離時 null。 */
  exitHours: number | null
  /** 是否採用「簡易外推」估計（非官方預報）。 */
  estimated: boolean
  /** 可用預報的最遠時數（超過此值的研判無資料）。 */
  horizonHours: number
}

/**
 * 依颱風「預報路徑」研判參考點（我方位置/畫面中心）何時進入、何時脫離七級暴風圈。
 * 沿相鄰預報點以每小時線性內插中心位置與暴風半徑，找出 inside↔outside 的跨越時刻。
 * 優先用官方未來點（hours>0）；若無則用簡易外推 estTrack（標記 estimated）。
 */
export function impactWindow(ty: Typhoon, ref: { lat: number; lng: number }): ImpactWindow | null {
  const now = currentPoint(ty)
  const official = ty.track.filter((p) => p.hours > 0.01).sort((a, b) => a.hours - b.hours)
  let estimated = false
  let seq: TyphoonPoint[]
  if (official.length >= 1) {
    seq = [now, ...official].sort((a, b) => a.hours - b.hours)
  } else if (ty.estTrack && ty.estTrack.length) {
    seq = [now, ...ty.estTrack].sort((a, b) => a.hours - b.hours)
    estimated = true
  } else {
    return null // 沒有任何未來資訊，無從研判脫離時間
  }

  const distNowKm = haversineKm(ref.lat, ref.lng, now.lat, now.lng)
  const galeNowKm = now.galeRadiusKm
  const affectedNow = distNowKm <= galeNowKm

  const horizonHours = seq[seq.length - 1].hours
  // 每小時取樣（線性內插中心與暴風半徑），標記是否在圈內
  const insideAt = (h: number): boolean => {
    // 找 h 落在哪一段
    let i = 0
    while (i < seq.length - 1 && seq[i + 1].hours < h) i++
    const a = seq[Math.min(i, seq.length - 1)]
    const b = seq[Math.min(i + 1, seq.length - 1)]
    const span = b.hours - a.hours
    const t = span > 0 ? (h - a.hours) / span : 0
    const lat = a.lat + (b.lat - a.lat) * t
    const lng = a.lng + (b.lng - a.lng) * t
    const gale = a.galeRadiusKm + (b.galeRadiusKm - a.galeRadiusKm) * t
    return haversineKm(ref.lat, ref.lng, lat, lng) <= gale
  }

  let enterHours: number | null = null
  let exitHours: number | null = null
  let prevInside = affectedNow
  for (let h = 1; h <= horizonHours; h++) {
    const ins = insideAt(h)
    if (!prevInside && ins && enterHours === null) enterHours = h
    if (prevInside && !ins) {
      exitHours = h
      // 只要脫離就記錄「最後一次脫離」——覆蓋前面的暫時脫離，取最終離開時刻
    }
    prevInside = ins
  }
  // 若目前在圈內、但取樣期間從未脫離 → exitHours 維持 null（預報期內未脫離）
  return { affectedNow, distNowKm, galeNowKm, enterHours, exitHours, estimated, horizonHours }
}
