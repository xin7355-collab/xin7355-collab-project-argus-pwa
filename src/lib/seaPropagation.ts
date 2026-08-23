// ── 海面傳播效應：多路徑干涉瓣 與 海雜波 ──────────────────────
//
// 地形遮蔽解釋「山後看不到」，但海上作業最常遇到的「小艇忽然不見又出現」
// 多半不是地形，而是這兩件事：
//
//   1) 多路徑干涉（multipath lobing）
//      海面是良好反射面，直達波與海面反射波在目標處干涉，形成垂直方向
//      一瓣一瓣的能量分佈。落在零陷（null）的目標即使在視距內、功率也夠，
//      仍可能收不到回波。目標越低、頻率越高，零陷越密集——正好打在小艇上。
//
//   2) 海雜波（sea clutter）
//      湧浪本身的回波會蓋掉同一解析度單元內的小目標。海況越差、擦地角越大
//      （即距離越近）越嚴重，因此「近的一定看得到」這個直覺並不成立。
//
// 誠實範圍：以下為一階估算，用途是「指出哪些距離要提防」，不是精確預測。
// 多路徑用平面地球雙路徑模型（R ≫ 天線高時成立），未計入海面粗糙度造成的
// 反射係數衰減——實務上湧浪會讓零陷變淺、不至於完全消失。海雜波用
// 依海況分級的 σ⁰ 查表加擦地角修正，數量級可信，絕對值不宜當作門檻使用。

const C = 299792458

/** 波長(m)。 */
export function wavelengthM(freqGhz: number): number {
  return C / (Math.max(0.01, freqGhz) * 1e9)
}

// ── 1) 多路徑干涉 ────────────────────────────────────────────

/**
 * 傳播因子 F（0～2）：直達波與海面反射波干涉的合成振幅比。
 *   F = 2·|sin(2π·ht·hr / (λ·R))|
 * F=2 表示同相加成（訊號比自由空間強 6dB），F=0 為零陷（完全抵銷）。
 * 雷達為雙程，接收功率正比於 F⁴，等效偵測距離正比於 F。
 */
export function propagationFactor(antennaTopM: number, targetM: number, freqGhz: number, rangeKm: number): number {
  const lam = wavelengthM(freqGhz)
  const R = Math.max(1, rangeKm * 1000)
  return 2 * Math.abs(Math.sin((2 * Math.PI * Math.max(0, antennaTopM) * Math.max(0, targetM)) / (lam * R)))
}

export interface LobeStructure {
  /** 主瓣（F 最大）所在距離 km：R = 4·ht·hr/λ。 */
  peakKm: number
  /** 零陷距離 km，由遠而近：R_n = 2·ht·hr/(n·λ)。 */
  nullsKm: number[]
  /** 最遠零陷之外（R > 2·ht·hr/λ）F 隨距離單調下降，屬於「低於最低瓣」區。 */
  farRolloffFromKm: number
}

/**
 * 干涉瓣結構。
 *
 * 零陷數學上有無限多個（越近越密），但作業上沒有意義：零陷間距小於雷達距離
 * 解析度時，實務上會被平均掉而非真的看不到。因此只回報「最遠的幾個」——
 * 那些才是間距夠寬、目標真的可能整段消失的位置。
 */
export function lobeStructure(
  antennaTopM: number,
  targetM: number,
  freqGhz: number,
  maxKm: number,
  minKm = 1,
  maxNulls = 6,
): LobeStructure {
  const lam = wavelengthM(freqGhz)
  const base = (2 * Math.max(0, antennaTopM) * Math.max(0, targetM)) / lam / 1000 // km，即 n=1 的零陷
  const nullsKm: number[] = []
  if (base > 0) {
    for (let n = 1; n <= 200 && nullsKm.length < maxNulls; n++) {
      const r = base / n
      if (r < minKm) break
      if (r <= maxKm) nullsKm.push(r)
    }
  }
  return { peakKm: base * 2, nullsKm, farRolloffFromKm: base }
}

/**
 * 把干涉瓣換算成「可偵測距離的修正」：等效距離 = 自由空間距離 × F。
 * 用於判斷某個距離上的目標是否因落在零陷而偵測不到。
 */
export function multipathAdjustedKm(
  freeSpaceKm: number,
  antennaTopM: number,
  targetM: number,
  freqGhz: number,
  atKm: number,
): number {
  return freeSpaceKm * propagationFactor(antennaTopM, targetM, freqGhz, atKm)
}

// ── 2) 海雜波 ────────────────────────────────────────────────

export interface SeaState {
  ss: number
  label: string
  /** 浪高概況（m），給使用者對照用。 */
  waveM: string
  /** 正規化海面反射率 σ⁰(dB)，X 波段、水平極化、擦地角 1°（參考角）之值。 */
  sigma0Db: number
}

/**
 * 海況對照表。σ⁰ 取 X 波段水平極化、低擦地角的常見量級。
 * 垂直極化雜波較強、S 波段較弱，此處不細分——目的是分辨「哪個海況開始要提防」。
 */
export const SEA_STATES: SeaState[] = [
  { ss: 1, label: '平靜／微浪', waveM: '< 0.5', sigma0Db: -60 },
  { ss: 2, label: '小浪', waveM: '0.5–1', sigma0Db: -52 },
  { ss: 3, label: '中浪', waveM: '1–1.5', sigma0Db: -46 },
  { ss: 4, label: '大浪', waveM: '1.5–2.5', sigma0Db: -41 },
  { ss: 5, label: '巨浪', waveM: '2.5–4', sigma0Db: -37 },
  { ss: 6, label: '狂浪', waveM: '> 4', sigma0Db: -34 },
]

export interface ClutterInput {
  antennaTopM: number
  rangeKm: number
  /** 目標雷達截面積 m²。 */
  targetRcsM2: number
  /** 海況 1–6。 */
  seaState: number
  /** 天線水平波束寬度(度)。船用/沿岸雷達常見 1–2°。 */
  beamwidthDeg?: number
  /** 距離解析度(m)＝c·τ/2。短脈衝約 10–20m、中脈衝約 40–60m。 */
  rangeResM?: number
}

export interface ClutterResult {
  /** 該解析度單元的海雜波等效 RCS(m²)。 */
  clutterRcsM2: number
  /** 訊號雜波比(dB)：目標 RCS 相對於雜波。 */
  scrDb: number
  /** 擦地角(度)。 */
  grazingDeg: number
  /** 雜波單元面積(m²)。 */
  cellAreaM2: number
}

/**
 * 海雜波訊雜比一階估算。
 *
 * 雜波單元面積 A_c ≈ R · θ_az · ΔR（低擦地角近似，忽略 sec ψ）
 * 雜波 RCS   σ_c = σ⁰(ψ, 海況) · A_c
 * 訊雜比     SCR = σ_target / σ_c
 *
 * σ⁰ 隨擦地角上升而增大，此處以參考角 0.5° 線性外推（低擦地角區的常見近似）。
 * 擦地角由天線高與距離估得：ψ ≈ atan(ht / R)。
 */
export function seaClutter(inp: ClutterInput): ClutterResult {
  const R = Math.max(100, inp.rangeKm * 1000)
  const beamRad = ((inp.beamwidthDeg ?? 1.5) * Math.PI) / 180
  const dR = inp.rangeResM ?? 30
  const cellAreaM2 = R * beamRad * dR

  const grazingRad = Math.atan(Math.max(0, inp.antennaTopM) / R)
  const grazingDeg = (grazingRad * 180) / Math.PI

  const st = SEA_STATES.find((s) => s.ss === inp.seaState) ?? SEA_STATES[2]
  // σ⁰ 隨擦地角的變化分兩段（參考角 1°）：
  //   • ψ < 1°「干涉區」：海面反射與直達波干涉，σ⁰ 隨 ψ⁴ 急遽下降。
  //     這正是雜波在遠距離迅速消退的原因；用線性縮放會與 A_c ∝ R 抵銷，
  //     算出「SCR 與距離無關」的退化結果，反而看不出近距離才是雜波重災區。
  //   • ψ ≥ 1°「平台區」：變化平緩，此處以線性近似即可。
  const REF_DEG = 1
  const g = Math.max(1e-4, grazingDeg)
  const scale = g < REF_DEG ? Math.pow(g / REF_DEG, 4) : g / REF_DEG
  const sigma0 = Math.pow(10, st.sigma0Db / 10) * scale

  const clutterRcsM2 = sigma0 * cellAreaM2
  const scrDb = 10 * Math.log10(Math.max(1e-9, inp.targetRcsM2) / Math.max(1e-9, clutterRcsM2))
  return { clutterRcsM2, scrDb, grazingDeg, cellAreaM2 }
}

/**
 * 在給定海況下，目標要高出雜波 thresholdDb 才算可偵測；
 * 回傳「由近而遠第一個滿足條件的距離(km)」——比它更近的距離都被雜波蓋掉。
 * 全程都滿足回 0（不受雜波限制）；全程都不滿足回 null（此海況下該目標基本看不到）。
 */
export function clutterLimitedInnerKm(
  inp: Omit<ClutterInput, 'rangeKm'>,
  maxKm: number,
  thresholdDb = 6,
): number | null {
  const step = Math.max(0.1, maxKm / 200)
  let firstOk: number | null = null
  for (let r = step; r <= maxKm; r += step) {
    const ok = seaClutter({ ...inp, rangeKm: r }).scrDb >= thresholdDb
    if (ok) {
      firstOk = r
      break
    }
  }
  if (firstOk === null) return null
  return firstOk <= step * 1.01 ? 0 : firstOk
}
