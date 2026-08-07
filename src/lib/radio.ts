// ── 無線電中繼台覆蓋（私密，只存本機）──────────────────────
//
// 輸入中繼台座標/天線高/頻率/瓦數，估算通訊覆蓋半徑並畫半透明涵蓋圈。
// 涵蓋取兩個限制的較小者：
//   1) 視距(radio horizon)：d(km)=4.12×(√發射天線高 + √收訊天線高)（含 4/3 折射）
//   2) 功率極限(link budget)：用 EIRP、頻率、路徑損耗指數、收訊靈敏度反解最遠距離
//        PL(dB)=32.44 + 20·log10(f_MHz) + 10·n·log10(d_km)；可用⇔ EIRP−PL ≥ 靈敏度
// 誠實限制：此為「視距/自由空間」樂觀估算，實際受地形、建物、植被遮蔽會更短。

export interface Repeater {
  id: string
  name: string
  lat: number
  lng: number
  /** 發射天線離地/海高度(m)。 */
  antennaM: number
  /** 頻率(MHz)。 */
  freqMHz: number
  /** 發射功率(W)。 */
  powerW: number
  /** 收訊端天線高(m)：手持~1.5、車機~2.5。 */
  rxM: number
  /** 發射天線增益(dBi)。 */
  txGainDbi: number
  /** 可用收訊靈敏度(dBm，含衰落餘裕)。 */
  rxSensDbm: number
  /** 路徑損耗指數 n：自由空間 2、郊區/混合 ~3、市區 ~3.5–4。 */
  pathExp: number
  /** 等效地球半徑因子 k（大氣折射/地球曲度）：日間 4/3、夜間海面逆溫更大 → 距離更遠。 */
  kFactor: number
  /** 上行：沿岸手持/車機的發射功率(W)。手持~5、車機~25。預設 5。 */
  mobilePowerW?: number
  /** 上行：手持/車機天線增益(dBi)。橡皮天線含人體遮蔽常為負，保守取 0。 */
  mobileGainDbi?: number
  /** 上行：站台接收靈敏度(dBm)。站台有前級/好天線，通常優於手持。預設 -116。 */
  stationRxSensDbm?: number
  /** 站點地面高程(m，海拔)：由座標自動查 DEM 帶入；天線頂高＝地面高程＋天線高。 */
  siteElevM?: number
}

/**
 * 天線頂「海拔高」(m)：一般鐵塔高直接加在站點地面高程上（座標自動查得的 DEM）。
 * 但若使用者把「天線高」欄位當成山頂海拔填了很大的值（>300m），則視為絕對海拔、
 * 不再重複加地面（避免「山頂 2900m 又加 3020m→6000m」的過度樂觀）。
 * → 使用者只要填鐵塔/天線離地高，山頂站也會自動算到正確的大範圍。
 */
export function antennaTopM(groundElevM: number, antennaM: number): number {
  const g = Number.isFinite(groundElevM) ? groundElevM : 0
  return antennaM > 300 ? Math.max(g, antennaM) : g + antennaM
}

/** 建立時的預設進階參數（一般使用者不用動）。 */
export const RADIO_DEFAULTS = {
  rxM: 1.5,
  txGainDbi: 2,
  rxSensDbm: -112,
  pathExp: 3,
  kFactor: 4 / 3,
  mobilePowerW: 5,
  mobileGainDbi: 0,
  stationRxSensDbm: -116,
}

/**
 * 裝置類型快速預設（給不懂數值的使用者一鍵填好）。
 * 只設「站台本身」相關的數字：天線高、功率、增益、頻段；其餘進階用合理預設。
 */
export interface DevicePreset {
  id: string
  icon: string
  label: string
  desc: string
  antennaM: number
  powerW: number
  freqMHz: number
  txGainDbi: number
  pathExp: number
}

export const DEVICE_PRESETS: DevicePreset[] = [
  { id: 'handheld', icon: '📻', label: '手持機', desc: '5W · 天線1.5m', antennaM: 1.5, powerW: 5, freqMHz: 145, txGainDbi: 0, pathExp: 3 },
  { id: 'vehicle', icon: '🚗', label: '車機', desc: '25W · 天線2.5m', antennaM: 2.5, powerW: 25, freqMHz: 145, txGainDbi: 2.5, pathExp: 3 },
  { id: 'fixed', icon: '🏢', label: '固定台', desc: '25W · 天線10m', antennaM: 10, powerW: 25, freqMHz: 145, txGainDbi: 3, pathExp: 2.9 },
  { id: 'mountain', icon: '📡', label: '高山中繼', desc: '25W · 天線50m', antennaM: 50, powerW: 25, freqMHz: 145, txGainDbi: 5, pathExp: 2.8 },
]

/** 傳播條件（日夜/波導）→ 等效地球半徑因子 k。 */
export const PROP_MODES: { id: string; label: string; k: number }[] = [
  { id: 'day', label: '☀️ 日間·標準', k: 4 / 3 },
  { id: 'night', label: '🌙 夜間·海面逆溫', k: 1.6 },
  { id: 'duct', label: '🌫️ 強波導/超折射', k: 2.5 },
]

/**
 * 視距(km)：含大氣折射(等效地球半徑 k)，發射與收訊天線高共同決定。
 * d = 3.569·√k·(√txM + √rxM)；k=4/3 時係數=4.12。夜間 k 較大 → 距離較遠。
 */
export function radioHorizonKm(txM: number, rxM: number, kFactor: number = 4 / 3): number {
  const c = 3.569 * Math.sqrt(Math.max(0.5, kFactor))
  return c * (Math.sqrt(Math.max(0, txM)) + Math.sqrt(Math.max(0, rxM)))
}

/** 功率極限距離(km)：由 EIRP、頻率、路徑損耗、靈敏度反解。 */
export function powerLimitedKm(r: Repeater): number {
  const eirp = 30 + 10 * Math.log10(Math.max(0.01, r.powerW)) + r.txGainDbi // dBm
  const budget = eirp - r.rxSensDbm // 可容許路徑損耗(dB)
  const n = Math.max(2, r.pathExp)
  const exp = (budget - 32.44 - 20 * Math.log10(Math.max(1, r.freqMHz))) / (10 * n)
  return Math.max(0, Math.pow(10, exp))
}

export interface Coverage {
  km: number
  losKm: number
  powerKm: number
  /** 目前是「視距」還是「功率」在限制涵蓋。 */
  limit: 'los' | 'power'
}

export function coverage(r: Repeater): Coverage {
  // 天線頂等效海拔＝站點地面高程（座標自動查）＋天線高；山頂站因此自動有大範圍。
  const losKm = radioHorizonKm(antennaTopM(r.siteElevM ?? 0, r.antennaM), r.rxM, r.kFactor)
  const powerKm = powerLimitedKm(r)
  return {
    km: Math.min(losKm, powerKm),
    losKm,
    powerKm,
    limit: powerKm < losKm ? 'power' : 'los',
  }
}

/** 每個中繼台一個穩定且彼此不同的顏色（依 id 雜湊配色，刪站也不變）。 */
const REPEATER_PALETTE = [
  '#22d3ee', '#a78bfa', '#34d399', '#f59e0b', '#f43f5e', '#38bdf8',
  '#e879f9', '#fbbf24', '#4ade80', '#fb7185', '#818cf8', '#2dd4bf',
  '#c084fc', '#f97316', '#60a5fa', '#a3e635',
]
export function repeaterColor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return REPEATER_PALETTE[h % REPEATER_PALETTE.length]
}

/** 依頻率分頻段（配色 + 名稱）。 */
export function band(freqMHz: number): { name: string; color: string } {
  if (freqMHz < 30) return { name: 'HF 短波', color: '#34d399' }
  if (freqMHz < 300) return { name: 'VHF 特高頻', color: '#22d3ee' }
  if (freqMHz < 3000) return { name: 'UHF 極高頻', color: '#a78bfa' }
  return { name: 'SHF 微波', color: '#f59e0b' }
}

// ── 通訊死角（多台覆蓋聯集後仍收不到的網格）────────────────────
export interface DeadZones {
  /** 未被任何中繼台覆蓋的網格中心點。 */
  cells: [number, number][]
  /** 網格緯/經間距（畫方格用）。 */
  dLat: number
  dLng: number
  /** 檢查總格數（供顯示涵蓋率）。 */
  total: number
  /** 是否採用「地形遮蔽」判定（至少一台用了地形多邊形）。 */
  terrainUsed: boolean
}

/** 點是否在多邊形內（射線法；ring 為 [lat,lng] 序列）。 */
export function pointInPolygon(lat: number, lng: number, ring: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i][0]
    const xi = ring[i][1]
    const yj = ring[j][0]
    const xj = ring[j][1]
    const hit = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi
    if (hit) inside = !inside
  }
  return inside
}

export interface DeadZoneOpts {
  /** 各台「地形遮蔽覆蓋多邊形」（terrainCoverage 結果），有才會納入山後遮蔽。 */
  rings?: Record<string, [number, number][]>
  /** 是否採用地形多邊形（對應 UI 的「地形/圓圈」切換）。 */
  useTerrain?: boolean
  gridN?: number
}

/**
 * 死角標示：在所有中繼台外擴一圈的範圍內鋪網格，逐格檢查是否被「任一」台涵蓋（聯集），
 * 沒被涵蓋的格＝通訊死角。
 *
 * 覆蓋判定分兩種：
 *   • 有地形多邊形且開啟地形 → 用「被山切出的真實形狀」做點在多邊形內判定，
 *     故「涵蓋圈半徑內、但在山後」的格會正確標為死角（符合實地量測）。
 *   • 否則退回視距圓：距離 ≤ 涵蓋半徑即算涵蓋（樂觀，會低估山後死角）。
 */
export function deadZones(list: Repeater[], opts: DeadZoneOpts = {}): DeadZones {
  const { rings, useTerrain = false, gridN = 48 } = opts
  if (!list.length) return { cells: [], dLat: 0, dLng: 0, total: 0, terrainUsed: false }
  let terrainUsed = false
  const covs = list.map((r) => {
    const km = coverage(r).km
    const ring = useTerrain ? rings?.[r.id] : undefined
    const poly = ring && ring.length >= 3 ? ring : null
    if (poly) terrainUsed = true
    return { r, km, poly }
  })
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity, maxKm = 0
  for (const c of covs) {
    maxKm = Math.max(maxKm, c.km)
    minLat = Math.min(minLat, c.r.lat)
    maxLat = Math.max(maxLat, c.r.lat)
    minLng = Math.min(minLng, c.r.lng)
    maxLng = Math.max(maxLng, c.r.lng)
  }
  const midLat = (minLat + maxLat) / 2
  const padLat = maxKm / 111
  const padLng = maxKm / (111 * Math.max(0.2, Math.cos(midLat * DEG)))
  minLat -= padLat; maxLat += padLat; minLng -= padLng; maxLng += padLng
  const dLat = (maxLat - minLat) / gridN
  const dLng = (maxLng - minLng) / gridN
  const cells: [number, number][] = []
  for (let i = 0; i < gridN; i++) {
    for (let j = 0; j < gridN; j++) {
      const lat = minLat + (i + 0.5) * dLat
      const lng = minLng + (j + 0.5) * dLng
      const covered = covs.some((c) =>
        c.poly
          ? pointInPolygon(lat, lng, c.poly)
          : distanceMeters(c.r.lat, c.r.lng, lat, lng) <= c.km * 1000,
      )
      if (!covered) cells.push([lat, lng])
    }
  }
  return { cells, dLat, dLng, total: gridN * gridN, terrainUsed }
}

// ── 測距 / 方位 / 數位鏈路研判 ──────────────────────────────
const DEG = Math.PI / 180
const R_EARTH = 6371000

/** 兩點大圓距離（公尺）。 */
export function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = (bLat - aLat) * DEG
  const dLng = (bLng - aLng) * DEG
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * DEG) * Math.cos(bLat * DEG) * Math.sin(dLng / 2) ** 2
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** 方位角（度，0=正北，順時針）。 */
export function bearingDeg(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const y = Math.sin((bLng - aLng) * DEG) * Math.cos(bLat * DEG)
  const x =
    Math.cos(aLat * DEG) * Math.sin(bLat * DEG) -
    Math.sin(aLat * DEG) * Math.cos(bLat * DEG) * Math.cos((bLng - aLng) * DEG)
  return (Math.atan2(y, x) / DEG + 360) % 360
}

/** 多單位距離字串：公里／浬／公尺。 */
export function fmtDist(m: number): string {
  return `${(m / 1000).toFixed(2)} km ／ ${(m / 1852).toFixed(2)} 浬 ／ ${Math.round(m)} m`
}

// ── 路徑穿越離岸風電場研判（干擾：多重路徑衰落／塔架遮蔽）──────────
/** 圓形干擾區（離岸風電場）。 */
export interface AreaCircle {
  name: string
  lat: number
  lng: number
  radiusKm: number
}

/** 以 a 為原點的局部平面(km)投影。 */
function toXY(lat: number, lng: number, lat0: number, lng0: number): [number, number] {
  return [(lng - lng0) * 111 * Math.cos(lat0 * DEG), (lat - lat0) * 111]
}

/** 點 p 到線段 a→b 的最短距離(km)（局部平面近似，適用數十公里）。 */
export function segPointKm(
  aLat: number, aLng: number, bLat: number, bLng: number, pLat: number, pLng: number,
): number {
  const [bx, by] = toXY(bLat, bLng, aLat, aLng)
  const [px, py] = toXY(pLat, pLng, aLat, aLng)
  const len2 = bx * bx + by * by
  let t = len2 > 0 ? (px * bx + py * by) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - t * bx, py - t * by)
}

/**
 * 回傳「站台→單位」路徑穿越（或貼近 bufferKm 內）的離岸風電場名稱。
 * 訊號穿過離岸風電場正後方或近旁時，旋轉葉片＋巨大金屬塔會造成多重路徑衰落與遮蔽。
 */
export function windFarmsOnPath(
  aLat: number, aLng: number, bLat: number, bLng: number, areas: AreaCircle[], bufferKm = 1,
): string[] {
  const hit: string[] = []
  for (const w of areas) {
    if (segPointKm(aLat, aLng, bLat, bLng, w.lat, w.lng) <= w.radiusKm + bufferKm) hit.push(w.name)
  }
  return hit
}

/** 指定距離(km)的路徑損耗(dB)。 */
export function pathLossDb(r: Repeater, dKm: number): number {
  return (
    32.44 +
    20 * Math.log10(Math.max(1, r.freqMHz)) +
    10 * Math.max(2, r.pathExp) * Math.log10(Math.max(0.001, dKm))
  )
}

/** 收訊端收到的訊號強度(dBm)。 */
export function receivedDbm(r: Repeater, dKm: number): number {
  const eirp = 30 + 10 * Math.log10(Math.max(0.01, r.powerW)) + r.txGainDbi
  return eirp - pathLossDb(r, dKm)
}

export interface LinkStatus {
  distM: number
  bearing: number
  /** 下行：手持端收到站台的訊號強度(dBm)。 */
  rxDbm: number
  /** 兩向較差者的餘裕(dB)——決定能否「雙向」通聯（排序用）。 */
  marginDb: number
  /** 下行餘裕：站台→手持（聽得到嗎）。 */
  downMarginDb: number
  /** 上行餘裕：手持→站台（叫得回去嗎）。 */
  upMarginDb: number
  withinLos: boolean
  level: 'good' | 'marginal' | 'none'
  /** 哪一向卡住：up=打不回、down=聽不到、both=雙向不通、none=都通。 */
  limiting: 'up' | 'down' | 'both' | 'none'
  text: string
}

/**
 * 雙向數位鏈路研判：站台↔某座標。分別算下行(站台→手持)與上行(手持→站台)。
 * 因手持功率/天線遠小於站台，常見「聽得到卻叫不回」——上行才是限制。
 */
export function linkStatus(r: Repeater, lat: number, lng: number): LinkStatus {
  const distM = distanceMeters(r.lat, r.lng, lat, lng)
  const dKm = distM / 1000
  const pl = pathLossDb(r, dKm)

  // 下行：站台發射(功率+天線增益) → 手持接收(靈敏度已含手持天線)
  const rxDbm = receivedDbm(r, dKm)
  const downMarginDb = rxDbm - r.rxSensDbm

  // 上行：手持發射(小功率/低增益) → 站台接收(站台天線增益 txGainDbi 幫忙收 + 較佳靈敏度)
  const mobW = r.mobilePowerW ?? RADIO_DEFAULTS.mobilePowerW
  const mobG = r.mobileGainDbi ?? RADIO_DEFAULTS.mobileGainDbi
  const staSens = r.stationRxSensDbm ?? RADIO_DEFAULTS.stationRxSensDbm
  const upEirp = 30 + 10 * Math.log10(Math.max(0.01, mobW)) + mobG
  const upRxAtStation = upEirp - pl + r.txGainDbi // 站台天線增益（收發互易）
  const upMarginDb = upRxAtStation - staSens

  const withinLos = dKm <= radioHorizonKm(antennaTopM(r.siteElevM ?? 0, r.antennaM), r.rxM, r.kFactor)
  const downOk = withinLos && downMarginDb > 0
  const upOk = withinLos && upMarginDb > 0
  const marginDb = Math.min(downMarginDb, upMarginDb)

  let level: LinkStatus['level']
  let limiting: LinkStatus['limiting']
  let text: string
  if (!withinLos) {
    level = 'none'
    limiting = 'both'
    text = '超出視距 · 雙向都不通'
  } else if (downOk && upOk) {
    limiting = 'none'
    if (marginDb < 10) {
      level = 'marginal'
      text = '雙向邊緣 · 數位可能斷續'
    } else {
      level = 'good'
      text = '雙向穩定 · 座標回傳正常'
    }
  } else if (downOk && !upOk) {
    level = 'none'
    limiting = 'up'
    text = '⚠ 聽得到叫不回 · 手持上行功率/天線不足'
  } else if (!downOk && upOk) {
    level = 'none'
    limiting = 'down'
    text = '站台收得到但手持收不到下行'
  } else {
    level = 'none'
    limiting = 'both'
    text = '雙向都收不到'
  }
  return {
    distM,
    bearing: bearingDeg(r.lat, r.lng, lat, lng),
    rxDbm,
    marginDb,
    downMarginDb,
    upMarginDb,
    withinLos,
    level,
    limiting,
    text,
  }
}

export function linkColor(level: LinkStatus['level']): string {
  return level === 'good' ? '#34d399' : level === 'marginal' ? '#f59e0b' : '#f43f5e'
}

const LS_KEY = 'argus.radio.v1'

/** 數字欄位補預設，避免舊紀錄缺欄位導致 coverage() 算出 NaN、Leaflet 半徑 NaN。 */
function normalizeRepeater(r: Partial<Repeater>): Repeater {
  const n = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  return {
    id: typeof r.id === 'string' ? r.id : newRepeaterId(),
    name: typeof r.name === 'string' ? r.name : '中繼台',
    lat: r.lat as number,
    lng: r.lng as number,
    antennaM: n(r.antennaM, 50),
    freqMHz: n(r.freqMHz, 145),
    powerW: n(r.powerW, 25),
    rxM: n(r.rxM, RADIO_DEFAULTS.rxM),
    txGainDbi: n(r.txGainDbi, RADIO_DEFAULTS.txGainDbi),
    rxSensDbm: n(r.rxSensDbm, RADIO_DEFAULTS.rxSensDbm),
    pathExp: n(r.pathExp, RADIO_DEFAULTS.pathExp),
    kFactor: n(r.kFactor, RADIO_DEFAULTS.kFactor),
    mobilePowerW: n(r.mobilePowerW, RADIO_DEFAULTS.mobilePowerW),
    mobileGainDbi: n(r.mobileGainDbi, RADIO_DEFAULTS.mobileGainDbi),
    stationRxSensDbm: n(r.stationRxSensDbm, RADIO_DEFAULTS.stationRxSensDbm),
    siteElevM: typeof r.siteElevM === 'number' && Number.isFinite(r.siteElevM) ? r.siteElevM : undefined,
  }
}

export function loadRepeaters(): Repeater[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || '[]')
    if (!Array.isArray(raw)) return []
    return raw
      .filter((r) => r && typeof r.lat === 'number' && typeof r.lng === 'number')
      .map(normalizeRepeater)
  } catch {
    return []
  }
}

export function persistRepeaters(list: Repeater[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list))
  } catch {
    /* ignore quota */
  }
}

export function newRepeaterId(): string {
  return 'rp' + Math.abs(Date.now() ^ ((Math.random() * 1e9) | 0)).toString(36)
}

// ── 備份匯出／匯入（只在你裝置上產生檔案，不上傳）──────────────
const BACKUP_TAG = 'argus-repeaters'

/** 把中繼台清單序列化成備份 JSON 字串。 */
export function exportRepeatersJson(list: Repeater[]): string {
  return JSON.stringify({ tag: BACKUP_TAG, v: 1, ts: Date.now(), repeaters: list }, null, 2)
}

/** 從備份 JSON 解析出中繼台（去掉 id，交給 importRepeaters 配新 id）。回傳 null 表示格式不符。 */
export function parseRepeatersJson(text: string): Omit<Repeater, 'id'>[] | null {
  try {
    const j = JSON.parse(text) as { tag?: string; repeaters?: unknown }
    const arr = Array.isArray(j.repeaters) ? j.repeaters : Array.isArray(j) ? (j as unknown[]) : null
    if (!arr) return null
    const out: Omit<Repeater, 'id'>[] = []
    for (const raw of arr) {
      if (!raw || typeof raw !== 'object') continue // 跳過 null/非物件元素，不讓整包匯入失敗
      const r = raw as Partial<Repeater>
      if (typeof r.lat !== 'number' || typeof r.lng !== 'number') continue
      out.push({
        name: typeof r.name === 'string' ? r.name : '匯入中繼台',
        lat: r.lat,
        lng: r.lng,
        antennaM: Number(r.antennaM) || 50,
        freqMHz: Number(r.freqMHz) || 145,
        powerW: Number(r.powerW) || 25,
        rxM: Number(r.rxM) || RADIO_DEFAULTS.rxM,
        txGainDbi: Number(r.txGainDbi ?? RADIO_DEFAULTS.txGainDbi),
        rxSensDbm: Number(r.rxSensDbm ?? RADIO_DEFAULTS.rxSensDbm),
        pathExp: Number(r.pathExp ?? RADIO_DEFAULTS.pathExp),
        kFactor: Number(r.kFactor ?? RADIO_DEFAULTS.kFactor),
        mobilePowerW: Number(r.mobilePowerW ?? RADIO_DEFAULTS.mobilePowerW),
        mobileGainDbi: Number(r.mobileGainDbi ?? RADIO_DEFAULTS.mobileGainDbi),
        stationRxSensDbm: Number(r.stationRxSensDbm ?? RADIO_DEFAULTS.stationRxSensDbm),
        siteElevM: typeof r.siteElevM === 'number' && Number.isFinite(r.siteElevM) ? r.siteElevM : undefined,
      })
    }
    return out
  } catch {
    return null
  }
}
