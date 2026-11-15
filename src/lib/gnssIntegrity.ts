// ── GPS 干擾推估：用飛機回報的定位精度，畫出「定位異常」的格子 ──────────
//
// 飛機的 ADS-B（DO-260 第 1、2 版）會廣播自己對定位有多少把握：
//   NIC（完整性包容半徑）與 NACp（定位精度）。
// 同一區很多飛機都回報精度變差，就是「導航完整性異常」。GPS 干擾或欺騙是常見原因，
// 所以這種格子是公開、常用的 GPS 干擾指標（gpsjam.org 就是這樣做的）；
// 但航電故障、老舊詢答機也會回報低值——「疑似 GPS 干擾」只是第二層、未經驗證的解讀，
// 畫面上一律先講「定位異常」，再講「可能是干擾」。
//
// 程式移植自 gods-eye-view（MIT，見 docs/licenses/gods-eye-view-MIT.txt）的
// src/layers/gnss/records.js，判定規則與時間窗不變，改寫成 TypeScript、註解改成中文。
// 方法的三個部分出處不同：
//   - 單架判定：NIC < 7（NIC 0 且 NACp ≥ 10 例外）或 NACp < 8 或 readsb 的 gpsOkBefore 旗標。
//     門檻借自美國 14 CFR 91.227(c) ADS-B Out 性能下限，不是公開的干擾判定標準（gods-eye-view 自訂）。
//   - 格子彙整：gpsjam.org 公開的公式與 2% / 10% 分級。
//   - 時間窗：看過的畫面滾動 30 分鐘（gods-eye-view 自訂）。
// 純函式，可離線測。

/** 定位來源：失去 GPS 後可能改成 MLAT（多站定位），但品質欄位必須是飛機自己回報的。 */
const QUALIFYING_TYPES = new Set(['adsb_icao', 'mlat'])
/** 只收 DO-260A/B（第 1、2 版）解出來的品質欄位；readsb 不會把第 3 版當第 3 版解。 */
const QUALIFYING_VERSIONS = new Set([1, 2])
/** NIC < 7：包容半徑 ≥ 0.2 浬（低於美國 91.227 的 ADS-B Out 下限）。 */
export const GNSS_NIC_THRESHOLD = 7
/** NACp < 8：定位不確定度 ≥ 93 公尺（低於美國 91.227 下限）。 */
export const GNSS_NACP_THRESHOLD = 8
/** 超過 60 秒的位置不算「現在這片天空」的證據。 */
const MAX_POSITION_AGE_S = 60
/** 格子邊長（度）：南北約 30 浬。 */
export const GNSS_CELL_DEG = 0.5
/** 一兩架飛機的格子不顯示（彙整時另外會先扣掉一架壞的）。 */
export const GNSS_MIN_AIRCRAFT = 3
/** 滾動時間窗：這段時間內在格子裡出現過的飛機才算。 */
export const GNSS_WINDOW_MS = 30 * 60_000
/** gpsjam.org 的分級（扣掉一架後，回報精度差的飛機佔幾 %）。 */
export const GNSS_MEDIUM_PERCENT = 2
export const GNSS_HIGH_PERCENT = 10

export type GnssLevel = 'low' | 'medium' | 'high'

/** 一架飛機的完整性事實（只留畫格子需要的）。 */
export interface GnssRow {
  hex: string
  lat: number
  lon: number
  nic: number | null
  nacp: number | null
  /** readsb 偵測到這架剛失去 GPS（gpsOkBefore）。 */
  gpsLost: boolean
  /** 依上面的規則判定「定位精度差」。 */
  degraded: boolean
}

/** 一架飛機在一個格子裡的觀測紀錄。 */
export interface GnssObservation {
  cell: string
  seenAt: number
  degradedAt: number | null
}
export type GnssStore = Map<string, GnssObservation>

export interface GnssCell {
  id: string
  south: number
  west: number
  north: number
  east: number
  lat: number
  lon: number
  aircraft: number
  degraded: number
  percentDegraded: number
  level: GnssLevel
  /** 中等、高＝導航完整性異常。 */
  anomaly: boolean
}

const HEX_PATTERN = /^~?[0-9a-f]{6}$/
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * 把 adsb.lol／readsb 的一份快照縮成判定需要的欄位。沒有飛機陣列回 null（格式不對，不是「沒有飛機」）。
 * 擋掉的：地面上的、TIS-B 轉播的、位置超過 60 秒的、版本不對的、品質欄位是推算出來的。
 */
export function normalizeGnssAircraft(payload: unknown): GnssRow[] | null {
  const ac = (payload as { ac?: unknown } | null)?.ac
  if (!Array.isArray(ac)) return null
  const rows: GnssRow[] = []
  const seen = new Set<string>()
  for (const raw of ac) {
    if (!raw || typeof raw !== 'object') continue
    const a = raw as Record<string, unknown>
    const hex = typeof a.hex === 'string' ? a.hex : ''
    if (!HEX_PATTERN.test(hex) || seen.has(hex)) continue
    if (!QUALIFYING_TYPES.has(a.type as string)) continue
    if (!QUALIFYING_VERSIONS.has(a.version as number)) continue
    if (a.alt_baro === 'ground' || !finite(a.alt_baro)) continue
    let lat = a.lat
    let lon = a.lon
    // tisb／mlat 陣列列出「哪些欄位是推算或轉播的」：那些不是飛機自己的精度
    const derived = (field: string) =>
      (Array.isArray(a.tisb) && a.tisb.includes(field)) || (Array.isArray(a.mlat) && a.mlat.includes(field))
    const nic = finite(a.nic) && !derived('nic') ? a.nic : null
    const nacp = finite(a.nac_p) && !derived('nac_p') ? a.nac_p : null
    if (!finite(lat) || Math.abs(lat) > 90) continue
    if (!finite(lon) || Math.abs(lon) > 180) continue
    // 只有一分鐘內確認過的位置才是現在的證據；沒給、不合法、負的都不算
    const age = a.seen_pos
    if (!finite(age) || age < 0 || age > MAX_POSITION_AGE_S) continue
    // readsb 在失去 GPS 後（最後一次好位置的 15 秒～15 分鐘）會帶這個旗標，恢復就拿掉。
    // 證據要放在最後一次好的 GPS 位置，而不是後來 MLAT 推算的位置。
    const gpsLost = finite(a.gpsOkBefore) && a.gpsOkBefore > 0
    if (nic === null && nacp === null && !gpsLost) continue
    if (gpsLost && finite(a.gpsOkLat) && Math.abs(a.gpsOkLat) <= 90 && finite(a.gpsOkLon) && Math.abs(a.gpsOkLon) <= 180) {
      lat = a.gpsOkLat
      lon = a.gpsOkLon
    }
    seen.add(hex)
    rows.push({
      hex,
      lat: lat as number,
      lon: lon as number,
      nic,
      nacp,
      gpsLost,
      degraded:
        gpsLost ||
        (nacp !== null && nacp < GNSS_NACP_THRESHOLD) ||
        (nic !== null && nic < GNSS_NIC_THRESHOLD && !(nic === 0 && nacp !== null && nacp >= 10)),
    })
  }
  return rows
}

/** 某個位置所在格子的固定代號（極區與換日線夾住，不會跑出範圍）。 */
export function gnssCellKey(lat: number, lon: number, cellDeg = GNSS_CELL_DEG): string {
  const row = Math.floor((Math.min(lat, 89.999999) + 90) / cellDeg)
  const col = Math.floor((Math.min(lon, 179.999999) + 180) / cellDeg)
  return `${row}:${col}`
}

/**
 * 把一份快照併進滾動紀錄。每架飛機在每個格子、每個時間窗只算一次。
 * 「出現過」和「回報精度差」分開計時：精度差的回報讓這架在這格維持「差」一個時間窗，
 * 之後再多好的回報也不會把它平均掉；但時間窗過了就不再算差，不會永遠被記著。
 *
 * 每一筆都用快照的「觀測時間」記，不是收到的時間：重播快取或舊快照不會讓證據變新，
 * 比時間窗還舊的快照什麼都不加。
 */
export function accumulateGnssObservations(
  store: GnssStore,
  rows: readonly (GnssRow | null | undefined)[] | null,
  nowMs: number,
  opts: { windowMs?: number; cellDeg?: number; observedAt?: number | null } = {},
): GnssStore {
  const windowMs = opts.windowMs ?? GNSS_WINDOW_MS
  const cellDeg = opts.cellDeg ?? GNSS_CELL_DEG
  const observedAt = opts.observedAt === undefined ? nowMs : opts.observedAt
  const at = finite(observedAt) ? Math.min(observedAt, nowMs) : NaN
  if (Number.isFinite(at) && nowMs - at <= windowMs) {
    for (const row of rows ?? []) {
      if (!row || !finite(row.lat) || !finite(row.lon)) continue
      const cell = gnssCellKey(row.lat, row.lon, cellDeg)
      const key = `${row.hex}|${cell}`
      const prev = store.get(key)
      // 舊的「差」就算已經超過時間窗也先帶著：下面的清理會把它改回沒有
      const prevDegradedAt = prev?.degradedAt ?? null
      store.set(key, {
        cell,
        seenAt: Math.max(prev?.seenAt ?? at, at),
        degradedAt: row.degraded ? Math.max(prevDegradedAt ?? at, at) : prevDegradedAt,
      })
    }
  }
  return pruneGnssObservations(store, nowMs, { windowMs })
}

/** 只清理不加：超過時間窗的觀測刪掉、超過時間窗的「差」改回沒有。 */
export function pruneGnssObservations(store: GnssStore, nowMs: number, opts: { windowMs?: number } = {}): GnssStore {
  const windowMs = opts.windowMs ?? GNSS_WINDOW_MS
  for (const [key, e] of store) {
    if (nowMs - e.seenAt > windowMs) store.delete(key)
    else if (e.degradedAt != null && nowMs - e.degradedAt > windowMs) store.set(key, { ...e, degradedAt: null })
  }
  return store
}

/**
 * 格子的等級，用 gpsjam.org 公開的公式：先扣掉一架精度差的（降低誤報），
 * 再算佔幾 %：< 2% 低、2–10% 中、> 10% 高。中、高就是導航完整性異常。
 */
export function gnssIntegrityLevel(total: number, degraded: number): { percent: number; level: GnssLevel; anomaly: boolean } {
  const percent = total > 0 ? (100 * Math.max(0, degraded - 1)) / total : 0
  const level: GnssLevel = percent > GNSS_HIGH_PERCENT ? 'high' : percent >= GNSS_MEDIUM_PERCENT ? 'medium' : 'low'
  return { percent, level, anomaly: level !== 'low' }
}

/** 把滾動紀錄彙整成可以畫的格子（紀錄要先清理過）。飛機太少的格子不出來。 */
export function binGnssCells(
  store: GnssStore,
  opts: { cellDeg?: number; minAircraft?: number } = {},
): GnssCell[] {
  const cellDeg = opts.cellDeg ?? GNSS_CELL_DEG
  const minAircraft = opts.minAircraft ?? GNSS_MIN_AIRCRAFT
  const tallies = new Map<string, { aircraft: number; degraded: number }>()
  for (const { cell, degradedAt } of store.values()) {
    const t = tallies.get(cell) ?? { aircraft: 0, degraded: 0 }
    t.aircraft += 1
    if (degradedAt != null) t.degraded += 1
    tallies.set(cell, t)
  }
  const cells: GnssCell[] = []
  for (const [id, { aircraft, degraded }] of tallies) {
    if (aircraft < minAircraft) continue
    const [row, col] = id.split(':').map(Number)
    const south = row * cellDeg - 90
    const west = col * cellDeg - 180
    const { percent, level, anomaly } = gnssIntegrityLevel(aircraft, degraded)
    cells.push({
      id,
      south,
      west,
      north: south + cellDeg,
      east: west + cellDeg,
      lat: south + cellDeg / 2,
      lon: west + cellDeg / 2,
      aircraft,
      degraded,
      percentDegraded: Math.round(percent * 10) / 10,
      level,
      anomaly,
    })
  }
  return cells.sort((a, b) => a.id.localeCompare(b.id))
}

/** 圖例顏色：照 gpsjam 的綠／黃／紅。 */
export const GNSS_LEVEL_COLORS: Record<GnssLevel, string> = {
  low: '#3fb950',
  medium: '#e3b341',
  high: '#f85149',
}

export const GNSS_LEVEL_TEXT: Record<GnssLevel, string> = {
  low: '正常',
  medium: '定位異常（中）',
  high: '定位異常（高）',
}

/** 點格子時的說明：先講看到什麼，再講可能原因，最後講限制。 */
export function gnssCellText(c: GnssCell): string[] {
  const lines = [
    `${GNSS_LEVEL_TEXT[c.level]}`,
    `近 ${GNSS_WINDOW_MS / 60_000} 分鐘 ${c.aircraft} 架飛機經過，${c.degraded} 架回報定位精度差（扣掉 1 架後 ${c.percentDegraded}%）`,
  ]
  if (c.anomaly) {
    lines.push('可能原因：GPS 干擾或欺騙（未經驗證）；個別飛機的航電問題也會回報低值')
  }
  lines.push('這是用高空飛機推估的，海面上的船受影響的範圍可能不同')
  return lines
}
