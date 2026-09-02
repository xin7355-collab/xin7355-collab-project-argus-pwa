// ── 微波鏈路預算與雨衰 ────────────────────────────────────────
//
// 備用鏈路只確認「有沒有被擋住」是不夠的：微波在台灣真正會斷的原因多半是
// 暴雨，而不是地形。同一條 10km 路徑，18GHz 在 0.01% 時間的雨衰可達 40dB
// 以上，7GHz 卻只有約 6dB——選頻直接決定這條備援在颱風天還在不在。
//
// 因此本模組同時給兩個數字：
//   1) 晴天餘裕（fade margin）：自由空間損耗下收訊電位高出靈敏度多少
//   2) 雨衰（ITU-R P.838 比衰減 + P.530 有效路徑長）：暴雨時會吃掉多少
// 兩者相減就是「暴雨時還剩多少」——這才是備援鏈路該看的數字。

/** 常見微波頻段（GHz）。低頻抗雨、高頻頻寬大天線小。 */
export const MICROWAVE_BANDS: { ghz: number; label: string; note: string }[] = [
  { ghz: 6, label: '6 GHz', note: '長距幹線，抗雨最好，天線大' },
  { ghz: 7, label: '7 GHz', note: '長距，抗雨佳' },
  { ghz: 8, label: '8 GHz', note: '中長距，抗雨佳' },
  { ghz: 11, label: '11 GHz', note: '中距，雨衰開始明顯' },
  { ghz: 15, label: '15 GHz', note: '中短距，雨衰大' },
  { ghz: 18, label: '18 GHz', note: '短距，雨衰很大' },
  { ghz: 23, label: '23 GHz', note: '短距，雨衰極大，颱風天易斷' },
]

/**
 * ITU-R P.838-3 比衰減係數（水平極化）。垂直極化略低，此處取水平（較保守）。
 * 以對數頻率內插；超出範圍則夾在端點。
 */
const RAIN_COEF: { f: number; k: number; a: number }[] = [
  { f: 1, k: 0.0000259, a: 0.9691 },
  { f: 2, k: 0.0000847, a: 1.0664 },
  { f: 4, k: 0.0001071, a: 1.6009 },
  { f: 6, k: 0.001155, a: 1.4745 },
  { f: 7, k: 0.001731, a: 1.4745 },
  { f: 8, k: 0.002741, a: 1.429 },
  { f: 10, k: 0.01217, a: 1.2571 },
  { f: 12, k: 0.02386, a: 1.1825 },
  { f: 15, k: 0.04481, a: 1.1233 },
  { f: 20, k: 0.09164, a: 1.0568 },
  { f: 25, k: 0.1571, a: 0.9991 },
  { f: 30, k: 0.2403, a: 0.9485 },
  { f: 40, k: 0.4431, a: 0.8673 },
]

function rainCoef(fGhz: number): { k: number; a: number } {
  const f = Math.max(RAIN_COEF[0].f, Math.min(RAIN_COEF[RAIN_COEF.length - 1].f, fGhz))
  for (let i = 1; i < RAIN_COEF.length; i++) {
    const lo = RAIN_COEF[i - 1]
    const hi = RAIN_COEF[i]
    if (f <= hi.f) {
      const t = (Math.log(f) - Math.log(lo.f)) / (Math.log(hi.f) - Math.log(lo.f))
      return {
        k: Math.exp(Math.log(lo.k) + t * (Math.log(hi.k) - Math.log(lo.k))),
        a: lo.a + t * (hi.a - lo.a),
      }
    }
  }
  return { k: RAIN_COEF[RAIN_COEF.length - 1].k, a: RAIN_COEF[RAIN_COEF.length - 1].a }
}

/**
 * 台灣的 0.01% 降雨強度(mm/h)。ITU 雨區約 N–P，實務常取 70–95。
 * 預設 80 偏保守中間值；山區/東部可調高。
 */
export const DEFAULT_RAIN_MMH = 80

/** 自由空間路徑損耗(dB)。 */
export function fsplDb(freqGhz: number, km: number): number {
  if (!(km > 0) || !(freqGhz > 0)) return 0
  return 92.45 + 20 * Math.log10(freqGhz) + 20 * Math.log10(km)
}

/**
 * 雨衰(dB)，0.01% 時間不被超過。
 * 比衰減 γ = k·R^α（P.838）；有效路徑長 d_eff = d/(1+d/d0)，d0 = 35·e^(−0.015R)（P.530 簡化式）。
 * 長路徑不會整條同時下同樣大的雨，有效長度才是實際會衰減的距離。
 */
export function rainAttenuationDb(freqGhz: number, km: number, rainMmh = DEFAULT_RAIN_MMH): number {
  if (!(km > 0)) return 0
  const { k, a } = rainCoef(freqGhz)
  const gamma = k * Math.pow(Math.max(0, rainMmh), a) // dB/km
  const d0 = 35 * Math.exp(-0.015 * Math.max(0, rainMmh))
  const dEff = km / (1 + km / Math.max(0.1, d0))
  return gamma * dEff
}

export interface LinkBudgetInput {
  freqGhz: number
  km: number
  /** 發射功率(dBm)。微波電台常見 +20 ~ +30。 */
  txDbm: number
  /** 兩端天線增益(dBi)。0.6m 碟約 30dBi@7GHz、38dBi@18GHz。 */
  txGainDbi: number
  rxGainDbi: number
  /** 饋線／接頭等固定損耗(dB，兩端合計)。 */
  lineLossDb?: number
  /** 接收機靈敏度(dBm)，常見 −70 ~ −85（視調變與頻寬）。 */
  rxSensDbm: number
  rainMmh?: number
}

export interface LinkBudget {
  fsplDb: number
  rxLevelDbm: number
  /** 晴天餘裕(dB)＝收訊電位 − 靈敏度。 */
  fadeMarginDb: number
  /** 0.01% 時間的雨衰(dB)。 */
  rainDb: number
  /** 暴雨時剩餘餘裕(dB)。負值代表該情況下會斷線。 */
  marginInRainDb: number
  /** 暴雨時是否仍可通。 */
  survivesRain: boolean
}

export function linkBudget(inp: LinkBudgetInput): LinkBudget {
  const fspl = fsplDb(inp.freqGhz, inp.km)
  const line = inp.lineLossDb ?? 2
  const rxLevelDbm = inp.txDbm + inp.txGainDbi + inp.rxGainDbi - fspl - line
  const fadeMarginDb = rxLevelDbm - inp.rxSensDbm
  const rainDb = rainAttenuationDb(inp.freqGhz, inp.km, inp.rainMmh)
  const marginInRainDb = fadeMarginDb - rainDb
  return {
    fsplDb: fspl,
    rxLevelDbm,
    fadeMarginDb,
    rainDb,
    marginInRainDb,
    survivesRain: marginInRainDb > 0,
  }
}

/**
 * 在同樣的天線與功率條件下，各頻段的暴雨餘裕比較——用來回答
 * 「這條備援該選哪個頻段」。回傳依頻率排序。
 */
export function compareBands(base: Omit<LinkBudgetInput, 'freqGhz'>): { ghz: number; b: LinkBudget }[] {
  return MICROWAVE_BANDS.map((m) => ({ ghz: m.ghz, b: linkBudget({ ...base, freqGhz: m.ghz }) }))
}
