// ── 雷達涵蓋規劃（私密，只存本機）────────────────────────────
//
// 海上沿岸雷達站點屬敏感資料，無公開來源；此工具讓使用者輸入自己已知的雷達
// 站（沿岸/離岸風電/艦艇），App 依「雷達地平線」公式算出對不同高度目標的實際偵測
// 距離，畫出涵蓋圈與死角——用於研判非法越界小艇(低矮，偵測距離短)可能鑽的縫。
//
// 涵蓋取三個限制的最小者：
//   1) 雷達地平線：d(km)=3.569×√k×(√天線頂高m + √目標高m)（k=4/3 時係數=4.12）
//      天線頂高＝站點地面海拔（座標自動查 DEM）＋天線離地高 —— 山頂/岬角站因此
//      自動有大範圍，不必手填海拔。
//   2) 功率極限（雷達方程式，選填）：
//      R⁴ = (Pt·G²·λ²·σ) / ((4π)³·Smin)
//      不知道功率就留空 → 不套用此限制，只用地平線與規格量程。
//   3) 規格量程：裝備型錄上「已知可以打多遠」。
//
// 對海上的重點：同一座雷達，對 2m 小艇的涵蓋比 10m 漁船短一截，死角就在那。
// 目標大小同時影響「高度」(遮蔽) 與「RCS」(回波強度)，兩者都要算進去。

import { nmToKm } from './units'

export type RadarType = 'coast' | 'windfarm' | 'ship' | 'other'

export interface RadarSite {
  id: string
  name: string
  lat: number
  lng: number
  type: RadarType
  /** 天線離地高度(m)。天線頂海拔＝siteElevM＋此值。 */
  antennaM: number
  /** 站點地面海拔(m)：由座標自動查 DEM 帶入；山頂站靠這個才算得出大範圍。 */
  siteElevM?: number
  /** 假設目標高度(m)：小艇~2、舢舨~3、漁船~10、貨輪~20。 */
  targetM: number
  /** 目標雷達截面積 RCS(m²)：小艇~2、漁船~50、貨輪~10000。影響回波強度。 */
  targetRcsM2?: number
  /** 裝備規格量程(km)：型錄上已知可以打多遠。 */
  maxRangeKm: number
  /** 峰值發射功率(kW)。留空＝不套用功率限制（不知道就別填）。 */
  powerKw?: number
  /** 天線增益(dBi)：沿岸監視雷達常見 30–35。 */
  gainDbi?: number
  /** 工作頻率(GHz)：X 波段 9.4、S 波段 3.05。 */
  freqGhz?: number
  /** 最小可偵測訊號(dBm)：接收機靈敏度。 */
  minDetDbm?: number
  /** 等效地球半徑因子 k：日間 4/3、夜間海面逆溫 1.6、強波導 2.5（距離更遠）。 */
  kFactor?: number
  /** 個別關閉：true＝停用（不畫涵蓋、不納入死角），保留設定可隨時開回。 */
  off?: boolean
}

/** 雷達參數預設值（不填時採用）。 */
export const RADAR_DEFAULTS = {
  gainDbi: 30,
  freqGhz: 9.4,
  minDetDbm: -110,
  kFactor: 4 / 3,
  targetRcsM2: 2,
}

/**
 * 天線頂「海拔高」(m)：天線離地高加在站點地面海拔上。
 * 若使用者把天線高欄位當成山頂海拔填了很大的值(>300m)，視為絕對海拔不重複相加，
 * 避免「山頂 2975m 又加 3000m→6000m」的過度樂觀。與無線電面板同一套規則。
 */
export function antennaTopM(siteElevM: number | undefined, antennaM: number): number {
  const g = Number.isFinite(siteElevM as number) ? (siteElevM as number) : 0
  return antennaM > 300 ? Math.max(g, antennaM) : g + antennaM
}

/** 傳播條件 → 等效地球半徑因子 k。海面逆溫/波導會顯著拉遠雷達距離。 */
export const RADAR_PROP_MODES: { id: string; label: string; k: number; hint: string }[] = [
  { id: 'day', label: '☀️ 日間·標準', k: 4 / 3, hint: '一般大氣，標準 4/3 地球半徑' },
  { id: 'night', label: '🌙 夜間·海面逆溫', k: 1.6, hint: '夜間海面降溫形成逆溫層，折射增強、打得更遠' },
  { id: 'duct', label: '🌫️ 強波導/超折射', k: 2.5, hint: '強波導可讓回波沿海面傳很遠，但低空盲區也會變複雜' },
]

/** 目標快捷：高度與 RCS 一起帶（兩者都影響偵測距離）。 */
export interface TargetPreset {
  m: number
  rcs: number
  label: string
}
export const TARGET_PRESETS: TargetPreset[] = [
  { m: 2, rcs: 2, label: '小艇 2m' },
  { m: 3, rcs: 5, label: '舢舨 3m' },
  { m: 6, rcs: 20, label: '小漁船 6m' },
  { m: 10, rcs: 50, label: '漁船 10m' },
  { m: 20, rcs: 10000, label: '貨輪 20m' },
]

/** 雷達裝備快速預設（不懂數值的人一鍵填好）。 */
export interface RadarPreset {
  id: string
  icon: string
  label: string
  desc: string
  antennaM: number
  powerKw: number
  gainDbi: number
  freqGhz: number
  maxRangeKm: number
  type: RadarType
}

/**
 * 規格量程一律以「浬」定義後換算成內部 km——船用雷達的量程檔位本來就是
 * 24/48/72/96 浬這種刻度，用浬定義才對得上型錄，也才不會在 UI 出現
 * 「59 浬」這種由 km 硬換過來的怪數字。
 */
export const RANGE_PRESETS_NM = [24, 48, 72, 96, 150, 250]

export const RADAR_PRESETS: RadarPreset[] = [
  {
    id: 'boat', icon: '🚤', label: '船用雷達', desc: '4kW · X 波段 · 天線 5m',
    antennaM: 5, powerKw: 4, gainDbi: 25, freqGhz: 9.4, maxRangeKm: nmToKm(24), type: 'ship',
  },
  {
    id: 'coast', icon: '🗼', label: '沿岸監視', desc: '25kW · X 波段 · 天線 30m',
    antennaM: 30, powerKw: 25, gainDbi: 30, freqGhz: 9.4, maxRangeKm: nmToKm(48), type: 'coast',
  },
  {
    id: 'mountain', icon: '⛰️', label: '高山長程', desc: '200kW · S 波段 · 天線 20m',
    antennaM: 20, powerKw: 200, gainDbi: 35, freqGhz: 3.05, maxRangeKm: nmToKm(250), type: 'coast',
  },
  {
    id: 'windfarm', icon: '🌀', label: '離岸風電', desc: '10kW · X 波段 · 天線 25m',
    antennaM: 25, powerKw: 10, gainDbi: 28, freqGhz: 9.4, maxRangeKm: nmToKm(40), type: 'windfarm',
  },
]

export const RADAR_TYPES: { id: RadarType; label: string; color: string }[] = [
  { id: 'coast', label: '海上沿岸雷達', color: '#22d3ee' },
  { id: 'windfarm', label: '離岸風電雷達', color: '#a78bfa' },
  { id: 'ship', label: '艦艇雷達', color: '#34d399' },
  { id: 'other', label: '其他', color: '#f59e0b' },
]

export function radarColor(t: RadarType): string {
  return RADAR_TYPES.find((x) => x.id === t)?.color ?? '#f59e0b'
}
export function radarTypeLabel(t: RadarType): string {
  return RADAR_TYPES.find((x) => x.id === t)?.label ?? '其他'
}

/**
 * 雷達地平線(km)：含大氣折射(等效地球半徑 k)。
 * d = 3.569×√k×(√天線頂高 + √目標高)；k=4/3 時係數＝4.12。
 * 注意第一參數是「天線頂海拔」(已含地面高程)，不是天線離地高。
 */
export function radarHorizonKm(antennaTopMeters: number, targetM: number, kFactor: number = 4 / 3): number {
  const c = 3.569 * Math.sqrt(Math.max(0.5, kFactor))
  return c * (Math.sqrt(Math.max(0, antennaTopMeters)) + Math.sqrt(Math.max(0, targetM)))
}

/**
 * 功率極限距離(km)：雷達方程式反解。
 *   R⁴ = (Pt·G²·λ²·σ) / ((4π)³·Smin)
 * Pt 峰值功率(W)、G 天線增益(線性)、λ 波長(m)、σ 目標 RCS(m²)、Smin 最小可偵測訊號(W)。
 * 未填功率 → 回 Infinity（不套用此限制）。
 */
export function radarPowerRangeKm(s: RadarSite): number {
  if (!Number.isFinite(s.powerKw as number) || (s.powerKw as number) <= 0) return Infinity
  const ptW = (s.powerKw as number) * 1000
  const gLin = Math.pow(10, (s.gainDbi ?? RADAR_DEFAULTS.gainDbi) / 10)
  const freqHz = (s.freqGhz ?? RADAR_DEFAULTS.freqGhz) * 1e9
  const lambda = 299792458 / freqHz
  const sigma = Math.max(0.01, s.targetRcsM2 ?? RADAR_DEFAULTS.targetRcsM2)
  const sminW = Math.pow(10, ((s.minDetDbm ?? RADAR_DEFAULTS.minDetDbm) - 30) / 10)
  const num = ptW * gLin * gLin * lambda * lambda * sigma
  const den = Math.pow(4 * Math.PI, 3) * sminW
  if (!(den > 0) || !(num > 0)) return Infinity
  return Math.pow(num / den, 0.25) / 1000
}

export interface RadarCoverage {
  /** 實際涵蓋(km)：三個限制取最小。 */
  km: number
  /** 雷達地平線(km)。 */
  horizonKm: number
  /** 功率極限(km)，未填功率為 Infinity。 */
  powerKm: number
  /** 規格量程(km)。 */
  specKm: number
  /** 目前是誰在限制涵蓋。 */
  limit: 'horizon' | 'power' | 'spec'
  /** 天線頂海拔(m)。 */
  antennaTop: number
}

/** 完整涵蓋分析：看得出是地平線、功率還是規格在卡。 */
export function radarCoverage(s: RadarSite): RadarCoverage {
  const antennaTop = antennaTopM(s.siteElevM, s.antennaM)
  const horizonKm = radarHorizonKm(antennaTop, s.targetM, s.kFactor ?? RADAR_DEFAULTS.kFactor)
  const powerKm = radarPowerRangeKm(s)
  const specKm = Number.isFinite(s.maxRangeKm) && s.maxRangeKm > 0 ? s.maxRangeKm : Infinity
  const km = Math.min(horizonKm, powerKm, specKm)
  const limit: RadarCoverage['limit'] = km === powerKm ? 'power' : km === specKm ? 'spec' : 'horizon'
  return { km, horizonKm, powerKm, specKm, limit, antennaTop }
}

/** 實際涵蓋(km)。保留原簽名供既有呼叫端使用。 */
export function coverageKm(s: RadarSite): number {
  return radarCoverage(s).km
}

const LS_KEY = 'argus.radar.v1'

/** 補預設，避免舊/損壞紀錄缺欄位→coverageKm NaN→Leaflet 半徑 NaN。 */
function normalizeRadarSite(r: Partial<RadarSite>): RadarSite {
  const n = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  const types: RadarType[] = ['coast', 'windfarm', 'ship', 'other']
  return {
    id: typeof r.id === 'string' ? r.id : newRadarId(),
    name: typeof r.name === 'string' ? r.name : '雷達站',
    lat: r.lat as number,
    lng: r.lng as number,
    type: types.includes(r.type as RadarType) ? (r.type as RadarType) : 'coast',
    antennaM: n(r.antennaM, 30),
    // 舊紀錄沒有這些欄位 → 用預設補；siteElevM 留 undefined 讓地圖層自動查 DEM 補上。
    siteElevM: Number.isFinite(r.siteElevM as number) ? (r.siteElevM as number) : undefined,
    targetM: n(r.targetM, 2),
    targetRcsM2: n(r.targetRcsM2, RADAR_DEFAULTS.targetRcsM2),
    maxRangeKm: n(r.maxRangeKm, nmToKm(48)),
    powerKw: Number.isFinite(r.powerKw as number) ? (r.powerKw as number) : undefined,
    gainDbi: n(r.gainDbi, RADAR_DEFAULTS.gainDbi),
    freqGhz: n(r.freqGhz, RADAR_DEFAULTS.freqGhz),
    minDetDbm: n(r.minDetDbm, RADAR_DEFAULTS.minDetDbm),
    kFactor: n(r.kFactor, RADAR_DEFAULTS.kFactor),
    off: r.off === true ? true : undefined,
  }
}

export function loadRadar(): RadarSite[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || '[]')
    if (!Array.isArray(raw)) return []
    return raw
      .filter((r) => r && typeof r.lat === 'number' && typeof r.lng === 'number')
      .map(normalizeRadarSite)
  } catch {
    return []
  }
}

export function persistRadar(sites: RadarSite[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(sites))
  } catch {
    /* ignore quota */
  }
}

export function newRadarId(): string {
  return 'r' + Math.abs(Date.now() ^ ((Math.random() * 1e9) | 0)).toString(36)
}
