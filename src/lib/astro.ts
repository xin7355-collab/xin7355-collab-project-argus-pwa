// ── 天文光照計算（日出日落 / 曙暮光 / 月出月落 / 月相）─────────────
//
// 純數學計算，免金鑰、可離線；供夜間勤務（非法越界/小艇多在夜間無月光時登陸）
// 規劃埋伏與搜索時機。演算法移植自 SunCalc (Vladimir Agafonkin, MIT License)，
// 精度對海上勤務規劃（分鐘級）已足夠。

const rad = Math.PI / 180
const dayMs = 1000 * 60 * 60 * 24
const J1970 = 2440588
const J2000 = 2451545

function toJulian(date: Date) {
  return date.valueOf() / dayMs - 0.5 + J1970
}
function fromJulian(j: number) {
  return new Date((j + 0.5 - J1970) * dayMs)
}
function toDays(date: Date) {
  return toJulian(date) - J2000
}

const e = rad * 23.4397 // 黃赤交角

function rightAscension(l: number, b: number) {
  return Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l))
}
function declination(l: number, b: number) {
  return Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l))
}
function altitude(H: number, phi: number, dec: number) {
  return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H))
}
function siderealTime(d: number, lw: number) {
  return rad * (280.16 + 360.9856235 * d) - lw
}
function astroRefraction(h: number) {
  if (h < 0) h = 0
  return 0.0002967 / Math.tan(h + 0.00312536 / (h + 0.08901179))
}

function solarMeanAnomaly(d: number) {
  return rad * (357.5291 + 0.98560028 * d)
}
function eclipticLongitude(M: number) {
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M))
  const P = rad * 102.9372
  return M + C + P + Math.PI
}
function sunCoords(d: number) {
  const M = solarMeanAnomaly(d)
  const L = eclipticLongitude(M)
  return { dec: declination(L, 0), ra: rightAscension(L, 0) }
}

// ── 太陽事件時刻 ───────────────────────────────────────────
const J0 = 0.0009
function julianCycle(d: number, lw: number) {
  return Math.round(d - J0 - lw / (2 * Math.PI))
}
function approxTransit(Ht: number, lw: number, n: number) {
  return J0 + (Ht + lw) / (2 * Math.PI) + n
}
function solarTransitJ(ds: number, M: number, L: number) {
  return J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L)
}
function hourAngle(h: number, phi: number, dec: number) {
  return Math.acos((Math.sin(h) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)))
}
function getSetJ(h: number, lw: number, phi: number, dec: number, n: number, M: number, L: number) {
  const w = hourAngle(h, phi, dec)
  const a = approxTransit(w, lw, n)
  return solarTransitJ(a, M, L)
}

export interface SunTimes {
  solarNoon: Date
  sunrise: Date
  sunset: Date
  civilDawn: Date
  civilDusk: Date
  nauticalDawn: Date
  nauticalDusk: Date
  astroDawn: Date
  astroDusk: Date
}

/** 某日某地的太陽事件時刻（回傳 Date；極區可能為 Invalid Date，台灣無此問題）。 */
export function getSunTimes(date: Date, lat: number, lng: number): SunTimes {
  const lw = rad * -lng
  const phi = rad * lat
  const d = toDays(date)
  const n = julianCycle(d, lw)
  const ds = approxTransit(0, lw, n)
  const M = solarMeanAnomaly(ds)
  const L = eclipticLongitude(M)
  const dec = declination(L, 0)
  const Jnoon = solarTransitJ(ds, M, L)

  const setTime = (h: number) => fromJulian(getSetJ(h * rad, lw, phi, dec, n, M, L))
  const riseTime = (h: number) => {
    const Jset = getSetJ(h * rad, lw, phi, dec, n, M, L)
    return fromJulian(Jnoon - (Jset - Jnoon))
  }

  return {
    solarNoon: fromJulian(Jnoon),
    sunrise: riseTime(-0.833),
    sunset: setTime(-0.833),
    civilDawn: riseTime(-6),
    civilDusk: setTime(-6),
    nauticalDawn: riseTime(-12),
    nauticalDusk: setTime(-12),
    astroDawn: riseTime(-18),
    astroDusk: setTime(-18),
  }
}

// ── 月球位置 / 月相 / 月出月落 ─────────────────────────────
function moonCoords(d: number) {
  const L = rad * (218.316 + 13.176396 * d)
  const M = rad * (134.963 + 13.064993 * d)
  const F = rad * (93.272 + 13.22935 * d)
  const l = L + rad * 6.289 * Math.sin(M)
  const b = rad * 5.128 * Math.sin(F)
  const dt = 385001 - 20905 * Math.cos(M)
  return { ra: rightAscension(l, b), dec: declination(l, b), dist: dt }
}

export interface MoonIllum {
  /** 受光比例 0–1（照明度）。 */
  fraction: number
  /** 月相 0–1（0=新月, 0.25=上弦, 0.5=滿月, 0.75=下弦）。 */
  phase: number
}

export function getMoonIllumination(date: Date): MoonIllum {
  const d = toDays(date)
  const s = sunCoords(d)
  const m = moonCoords(d)
  const sdist = 149598000 // 日地距(km)
  const phi = Math.acos(
    Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra),
  )
  const inc = Math.atan2(sdist * Math.sin(phi), m.dist - sdist * Math.cos(phi))
  const angle = Math.atan2(
    Math.cos(s.dec) * Math.sin(s.ra - m.ra),
    Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra),
  )
  return {
    fraction: (1 + Math.cos(inc)) / 2,
    phase: 0.5 + (0.5 * inc * (angle < 0 ? -1 : 1)) / Math.PI,
  }
}

function moonAltitude(date: Date, lat: number, lng: number) {
  const lw = rad * -lng
  const phi = rad * lat
  const d = toDays(date)
  const c = moonCoords(d)
  const H = siderealTime(d, lw) - c.ra
  const h = altitude(H, phi, c.dec)
  return h + astroRefraction(h)
}

export interface MoonTimes {
  rise?: Date
  set?: Date
  alwaysUp?: boolean
  alwaysDown?: boolean
}

/** 某「當地日曆日」的月出月落（以 date 的 00:00 當地時間為起點掃描 24 小時）。 */
export function getMoonTimes(date: Date, lat: number, lng: number): MoonTimes {
  const t = new Date(date)
  t.setHours(0, 0, 0, 0)
  const hc = 0.133 * rad
  let h0 = moonAltitude(t, lat, lng) - hc
  let rise: number | undefined
  let set: number | undefined
  let ye = 0

  for (let i = 1; i <= 24; i += 2) {
    const h1 = moonAltitude(hoursLater(t, i), lat, lng) - hc
    const h2 = moonAltitude(hoursLater(t, i + 1), lat, lng) - hc
    const a = (h0 + h2) / 2 - h1
    const b = (h2 - h0) / 2
    const xe = -b / (2 * a)
    ye = (a * xe + b) * xe + h1
    const d = b * b - 4 * a * h1
    let roots = 0
    let x1 = 0
    let x2 = 0
    if (d >= 0) {
      const dx = (Math.sqrt(d) / (Math.abs(a) * 2)) || 0
      x1 = xe - dx
      x2 = xe + dx
      if (Math.abs(x1) <= 1) roots++
      if (Math.abs(x2) <= 1) roots++
      if (x1 < -1) x1 = x2
    }
    if (roots === 1) {
      if (h0 < 0) rise = i + x1
      else set = i + x1
    } else if (roots === 2) {
      rise = i + (ye < 0 ? x2 : x1)
      set = i + (ye < 0 ? x1 : x2)
    }
    if (rise !== undefined && set !== undefined) break
    h0 = h2
  }

  const res: MoonTimes = {}
  if (rise !== undefined) res.rise = hoursLater(t, rise)
  if (set !== undefined) res.set = hoursLater(t, set)
  if (rise === undefined && set === undefined) {
    if (ye > 0) res.alwaysUp = true
    else res.alwaysDown = true
  }
  return res
}

function hoursLater(date: Date, h: number) {
  return new Date(date.valueOf() + (h * dayMs) / 24)
}

// ── 判讀輔助 ───────────────────────────────────────────────
/** 月相中文名（依 phase 0–1）。 */
export function moonPhaseName(phase: number): string {
  if (phase < 0.03 || phase > 0.97) return '新月 🌑'
  if (phase < 0.22) return '眉月 🌒'
  if (phase < 0.28) return '上弦月 🌓'
  if (phase < 0.47) return '盈凸月 🌔'
  if (phase < 0.53) return '滿月 🌕'
  if (phase < 0.72) return '虧凸月 🌖'
  if (phase < 0.78) return '下弦月 🌗'
  return '殘月 🌘'
}

/** 月亮此刻是否在地平線上。 */
export function isMoonUp(date: Date, lat: number, lng: number): boolean {
  return moonAltitude(date, lat, lng) > 0
}

export interface NightPlan {
  /** 觀測地點 */
  lat: number
  lng: number
  sunset: Date
  /** 天文暮光終＝完全黑暗開始（今晚） */
  astroDusk: Date
  /** 天文曙光始＝黑暗結束（明晨） */
  astroDawn: Date
  sunrise: Date
  /** 月受光比例 0–1 */
  illum: number
  phaseName: string
  /** 今晚落在 [日落, 明晨日出] 之間的月落 / 月出 */
  moonSet?: Date
  moonRise?: Date
  /** 天文夜內「月亮在地平線下」最長的黑暗窗口（最利埋伏/目視搜索） */
  darkStart?: Date
  darkEnd?: Date
  darkMinutes: number
  /** 一句勤務判讀 */
  verdict: string
}

/**
 * 綜整「今晚」的光照勤務規劃：日落→明晨日出的關鍵時刻、月相照明度，以及天文夜
 * 內月亮沉入地平線下的最長黑暗窗口（非法越界/小艇常挑此時登陸）。
 */
export function computeNightPlan(now: Date, lat: number, lng: number): NightPlan {
  const tomorrow = new Date(now.valueOf() + dayMs)
  const st = getSunTimes(now, lat, lng)
  const st2 = getSunTimes(tomorrow, lat, lng)
  const sunset = st.sunset
  const astroDusk = st.astroDusk
  const astroDawn = st2.astroDawn
  const sunrise = st2.sunrise
  const ill = getMoonIllumination(now)

  // 今晚窗口內的月出月落
  const nightStart = sunset.valueOf()
  const nightEnd = sunrise.valueOf()
  const cand = [getMoonTimes(now, lat, lng), getMoonTimes(tomorrow, lat, lng)]
  let moonSet: Date | undefined
  let moonRise: Date | undefined
  for (const mt of cand) {
    if (mt.set && mt.set.valueOf() >= nightStart && mt.set.valueOf() <= nightEnd && !moonSet) moonSet = mt.set
    if (mt.rise && mt.rise.valueOf() >= nightStart && mt.rise.valueOf() <= nightEnd && !moonRise) moonRise = mt.rise
  }

  // 天文夜內，掃描月亮在地平線下的最長連續黑暗窗口
  let bestStart: number | undefined
  let bestEnd: number | undefined
  let best = 0
  const dawnV = astroDawn.valueOf()
  const step = 10 * 60 * 1000
  let curStart: number | null = null
  if (Number.isFinite(astroDusk.valueOf()) && Number.isFinite(dawnV) && dawnV > astroDusk.valueOf()) {
    for (let t = astroDusk.valueOf(); t <= dawnV; t += step) {
      const up = moonAltitude(new Date(t), lat, lng) > 0
      if (!up) {
        if (curStart === null) curStart = t
      } else if (curStart !== null) {
        if (t - curStart > best) {
          best = t - curStart
          bestStart = curStart
          bestEnd = t
        }
        curStart = null
      }
    }
    if (curStart !== null && dawnV - curStart > best) {
      best = dawnV - curStart
      bestStart = curStart
      bestEnd = dawnV
    }
  }
  const darkMinutes = Math.round(best / 60000)

  // 判讀
  const pct = Math.round(ill.fraction * 100)
  let verdict: string
  if (pct < 15) {
    verdict = `月照僅 ${pct}%，整夜海面昏暗——利於埋伏，但己方目視搜索也受限，多倚賴熱像/雷達。`
  } else if (pct > 70) {
    verdict = `月照 ${pct}% 偏亮，海面反光明顯——可疑船隻較可能避開此夜或改走月落後時段（見下方黑暗窗口）。`
  } else {
    verdict = `月照 ${pct}% 中等；重點盯下方「最暗窗口」時段，登陸風險較高。`
  }

  return {
    lat,
    lng,
    sunset,
    astroDusk,
    astroDawn,
    sunrise,
    illum: ill.fraction,
    phaseName: moonPhaseName(ill.phase),
    moonSet,
    moonRise,
    darkStart: bestStart ? new Date(bestStart) : undefined,
    darkEnd: bestEnd ? new Date(bestEnd) : undefined,
    darkMinutes,
    verdict,
  }
}
