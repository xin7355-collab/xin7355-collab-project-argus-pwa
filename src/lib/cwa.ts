// ── 中央氣象署 (CWA) Open Data 介接 ─────────────────────────
//
// 取得順序：① 瀏覽器「直連」CWA opendata（多數情況允許 CORS，只需授權碼、
// 免部署 Worker）→ ② 若直連被擋(CORS/網路)且有設 Worker，改走 Worker 代理。
// 這樣使用者只要有 CWA 授權碼，通常就能直接用官方資料。
//
// 目前接：颱風路徑潛勢預報 W-C0034-005、潮汐 F-A0021-001、海面 F-A0012-001。

import { getConfig } from './config'
import { catOf, type Typhoon, type TyphoonPoint } from './typhoon'

const CWA_BASE = 'https://opendata.cwa.gov.tw/api/v1/rest/datastore'

/** 取得 CWA datastore JSON：先直連，失敗再走 Worker 代理。 */
export async function fetchCwaJson(
  dataset: string,
  params: Record<string, string> = {},
): Promise<any> {
  const cfg = getConfig()
  if (!cfg.cwaKey) throw new Error('需先設定 CWA 授權碼')

  // ① 瀏覽器直連（免 Worker）
  try {
    const p = new URLSearchParams({ Authorization: cfg.cwaKey, format: 'JSON', ...params })
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 12000)
    try {
      const res = await fetch(`${CWA_BASE}/${dataset}?${p}`, {
        headers: { accept: 'application/json' },
        signal: ctrl.signal,
      })
      if (res.ok) return await res.json()
    } finally {
      clearTimeout(t)
    }
  } catch {
    // 直連失敗（多半 CORS）→ 往下試 Worker
  }

  // ② Worker 代理（若有設定）
  if (cfg.edgeAiUrl) {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 12000)
    try {
      const res = await fetch(cfg.edgeAiUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwaDataset: dataset, cwaKey: cfg.cwaKey, cwaParams: params }),
        signal: ctrl.signal,
      })
      if (res.ok) return await res.json()
      throw new Error(`Worker/CWA ${res.status}`)
    } finally {
      clearTimeout(t)
    }
  }

  throw new Error('CWA 連線失敗（直連被擋且未設 Worker）')
}

const MS_TO_KT = 1.94384

function n(v: unknown, d = 0): number {
  const x = typeof v === 'string' ? parseFloat(v) : (v as number)
  return Number.isFinite(x) ? x : d
}

/**
 * 從一個 fix 抽出暴風半徑（km）。CWA 實際：
 *   分析點：Circle15ms.Radius（七級風平均半徑）
 *   預報點：Radius70PercentProbability（70% 機率半徑，畫潛勢圈）
 * 皆兼容大小寫與舊命名。
 */
function galeRadiusOf(fix: any): number {
  const circle = fix?.Circle15ms ?? fix?.circle15ms ?? fix?.circleOf15Ms
  const cand =
    circle?.Radius ??
    circle?.radius ??
    fix?.Radius70PercentProbability ??
    fix?.radius70PercentProbability ??
    fix?.radiusOf15Ms ??
    fix?.stormRadius ??
    0
  if (Array.isArray(cand)) return Math.max(0, ...cand.map((x) => n(x?.radius ?? x?.value ?? x)))
  return n(cand)
}

function coordOf(fix: any): [number, number] | null {
  // CWA 實際：CoordinateLongitude / CoordinateLatitude（分開的字串欄位）
  let lat = n(fix?.CoordinateLatitude ?? fix?.coordinateLatitude ?? fix?.lat ?? fix?.latitude, NaN)
  let lng = n(fix?.CoordinateLongitude ?? fix?.coordinateLongitude ?? fix?.lon ?? fix?.lng ?? fix?.longitude, NaN)
  // 舊式 "lng,lat" 字串相容
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    const c = fix?.coordinate ?? fix?.coordinates
    if (typeof c === 'string' && c.includes(',')) {
      const [a, b] = c.split(',').map((s: string) => parseFloat(s))
      lng = a
      lat = b
    }
  }
  if (Number.isFinite(lat) && Number.isFinite(lng)) return [lat, lng]
  return null
}

/** 台灣中心（多颱時挑最近台灣的一顆）。 */
const TW = { lat: 23.7, lng: 121.0 }

/** 由 fix 產生一個 TyphoonPoint；windMs 為 m/s。 */
function fixToPoint(f: any, hours: number, fallbackWindKt: number): TyphoonPoint | null {
  const co = coordOf(f)
  if (!co) return null
  const windMs = n(f?.MaxWindSpeed ?? f?.maxWindSpeed, NaN)
  const windKt = Number.isFinite(windMs) ? windMs * MS_TO_KT : fallbackWindKt
  return {
    lat: co[0],
    lng: co[1],
    hours,
    windKt: Math.round(windKt),
    galeRadiusKm: Math.round(galeRadiusOf(f)),
    cat: catOf(windKt),
  }
}

/**
 * 解析 CWA W-C0034-005（颱風路徑潛勢預報）為我們的 Typhoon 結構。
 * CWA 實際欄位為 PascalCase：TropicalCyclones.TropicalCyclone[]、CwaTyphoonName、
 * AnalysisData.Fix[]（含 DateTime/CoordinateLongitude/Latitude/MaxWindSpeed/Circle15ms）、
 * ForecastData.Fix[]（含 Tau 或 ForecastHour、Radius70PercentProbability）。全兼容大小寫。
 * 回傳語意：
 *   - Typhoon：有官方路徑（即使颱風還遠、未發台灣警報，CWA 仍會提供潛勢預報）
 *   - null：已連上 CWA 但目前無活動中颱風（或欄位對不上）——呼叫端改用 GDACS
 *   - throw：連線/授權失敗——呼叫端提示使用者
 */
/** 解析單一 TropicalCyclone 物件為 Typhoon（欄位對不上回 null）。 */
function parseTc(tc: any, nowMs: number): Typhoon | null {
  const name = String(
    tc.CwaTyphoonName || tc.cwaTyphoonName || tc.TyphoonName || tc.typhoonName ||
      (tc.CwaTdNo || tc.cwaTdNo ? `TD${tc.CwaTdNo || tc.cwaTdNo}` : '') || '颱風',
  )
  const nameEn = String(tc.TyphoonName || tc.typhoonName || 'TYPHOON')

  const analysis = toArr(tc?.AnalysisData?.Fix ?? tc?.analysisData?.fix)
  const fd = tc?.ForecastData ?? tc?.forecastData
  const forecast = toArr(fd?.Fix ?? fd?.fix)
  const fdInit = Date.parse(fd?.InitialTime ?? fd?.initTime ?? '')
  const track: TyphoonPoint[] = []
  let curWindKt = 45

  // 分析(觀測/現在)點：DateTime 為絕對時刻 → 換算成距現在小時（多為負或 0）。
  for (const f of analysis) {
    const t = Date.parse(f?.DateTime ?? f?.dateTime ?? f?.fixTime ?? '')
    const hours = Number.isFinite(t) ? Math.round((t - nowMs) / 3600000) : 0
    const p = fixToPoint(f, hours, curWindKt)
    if (!p) continue
    curWindKt = p.windKt
    track.push(p)
  }
  // 預報點：優先用 fix 的 DateTime；否則 InitialTime + Tau/ForecastHour。
  for (const f of forecast) {
    let hours = NaN
    const dt = Date.parse(f?.DateTime ?? f?.dateTime ?? '')
    if (Number.isFinite(dt)) {
      hours = Math.round((dt - nowMs) / 3600000)
    } else {
      const fh = n(f?.Tau ?? f?.tau ?? f?.ForecastHour ?? f?.forecastHour, NaN)
      const init = Number.isFinite(Date.parse(f?.InitialTime ?? '')) ? Date.parse(f.InitialTime) : fdInit
      if (Number.isFinite(fh) && Number.isFinite(init)) hours = Math.round((init + fh * 3600000 - nowMs) / 3600000)
      else if (Number.isFinite(fh)) hours = Math.round(fh)
    }
    if (!Number.isFinite(hours)) continue
    const p = fixToPoint(f, hours, curWindKt)
    if (p) track.push(p)
  }

  if (track.length < 2) return null
  track.sort((a, b) => a.hours - b.hours)
  return { name, nameEn, demo: false, track }
}

/** 現在位置（hours 最接近 0 的點）到台灣的距離平方（排序用）。 */
function distToTwSq(ty: Typhoon): number {
  const cur = ty.track.reduce((a, b) => (Math.abs(b.hours) < Math.abs(a.hours) ? b : a))
  return (cur.lat - TW.lat) ** 2 + (cur.lng - TW.lng) ** 2
}

/**
 * 抓 CWA 目前「所有」活動中颱風，依「離台灣近→遠」排序。
 * 連線/授權失敗 → throw；已連上但無颱風 → 回空陣列。
 */
export async function fetchCwaTyphoons(nowMs: number): Promise<Typhoon[]> {
  const data = await fetchCwaJson('W-C0034-005')
  try {
    const list = toArr(
      data?.records?.TropicalCyclones?.TropicalCyclone ??
        data?.records?.tropicalCyclones?.tropicalCyclone ??
        data?.records?.tropicalCyclone,
    )
    const tys = list.map((tc) => parseTc(tc, nowMs)).filter((t): t is Typhoon => t != null)
    tys.sort((a, b) => distToTwSq(a) - distToTwSq(b)) // 最近台灣者排最前（主要颱風）
    return tys
  } catch {
    return []
  }
}

/** 相容用：回傳最接近台灣的那一顆（無則 null）。 */
export async function fetchCwaTyphoon(nowMs: number): Promise<Typhoon | null> {
  const tys = await fetchCwaTyphoons(nowMs)
  return tys[0] ?? null
}

function toArr(x: any): any[] {
  if (x == null) return []
  return Array.isArray(x) ? x : [x]
}
