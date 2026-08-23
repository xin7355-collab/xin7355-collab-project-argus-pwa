// ── 地形遮蔽覆蓋（terrain line-of-sight）──────────────────────
//
// 把無線電覆蓋從「圓圈」升級成「被山切出的真實形狀」：沿多條方位射線取樣地形
// 高程(Open-Meteo 90m DEM，免金鑰)，逐點檢查發射天線頂到目標的直線是否被地形
// (含地球曲率 k=4/3 等效半徑)擋住，找出每個方位「還看得到」的最遠點，連成多邊形。
//
// 數位電台在山後＝直接斷訊，所以此形狀比圓圈更貼近實況。需連網取高程。

import { antennaTopM } from './radio'

const R_EARTH = 6371000
const DEG = Math.PI / 180

/** 由起點、方位、距離求終點座標（大圓）。 */
function dest(lat: number, lng: number, brgDeg: number, distM: number): [number, number] {
  const br = brgDeg * DEG
  const dR = distM / R_EARTH
  const la1 = lat * DEG
  const lo1 = lng * DEG
  const la2 = Math.asin(Math.sin(la1) * Math.cos(dR) + Math.cos(la1) * Math.sin(dR) * Math.cos(br))
  const lo2 =
    lo1 + Math.atan2(Math.sin(br) * Math.sin(dR) * Math.cos(la1), Math.cos(dR) - Math.sin(la1) * Math.sin(la2))
  return [la2 / DEG, lo2 / DEG]
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * 抓單一批次（≤100 點）高程，失敗自動重試（含 429 限流退避）。
 * 走 /v1/forecast 讀每點的 elevation（Open-Meteo 用 90m DEM 提供）——這是風場也在
 * 用、確定通的端點；比獨立的 /v1/elevation 端點可靠（後者常被限流/擋）。
 */
async function fetchElevChunk(chunk: [number, number][]): Promise<number[]> {
  const lats = chunk.map((p) => p[0].toFixed(5)).join(',')
  const lngs = chunk.map((p) => p[1].toFixed(5)).join(',')
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lngs}` +
    `&current=temperature_2m&timezone=UTC`
  let lastErr: unknown = null
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await sleep(400 * attempt * attempt) // 0 / 400 / 1600 / 3600ms 退避
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 15000)
    try {
      const res = await fetch(url, { signal: ctrl.signal })
      if (res.status === 429) throw new Error('rate-limited') // 觸發退避重試
      if (!res.ok) throw new Error('elevation ' + res.status)
      const j = await res.json()
      const arr = Array.isArray(j) ? j : [j] // 單點回物件、多點回陣列
      return chunk.map((_, k) => {
        const v = arr[k]?.elevation
        return typeof v === 'number' && Number.isFinite(v) ? v : 0
      })
    } catch (e) {
      lastErr = e
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('elevation failed')
}

/**
 * 批次查高程（公尺），每 100 點一個請求、逐批之間留 150ms 間隔避免限流；
 * 每批失敗自動退避重試。查不到的點以 0（海平面）計。
 */
export async function elevationBatch(pts: [number, number][]): Promise<number[]> {
  const out: number[] = []
  for (let i = 0; i < pts.length; i += 100) {
    if (i > 0) await sleep(150) // 批次間小間隔，降低瞬間請求密度
    const chunk = pts.slice(i, i + 100)
    out.push(...(await fetchElevChunk(chunk)))
  }
  return out
}

export interface TerrainOpts {
  bearings?: number
  /** 每方位取樣點數。 */
  steps?: number
}

/** 地形遮蔽計算輸入（通用：無線電中繼台或雷達站皆可）。 */
export interface TerrainInput {
  lat: number
  lng: number
  /** 天線/雷達架設高度(m)。 */
  antennaM: number
  /** 目標/收訊端高度(m)。 */
  targetM: number
  /** RF 涵蓋上限(km)——地形只會讓它更短，不會更長。 */
  maxKm: number
  /** 等效地球半徑因子（大氣折射）：日間 4/3、夜間海面逆溫更大。預設 4/3。 */
  kFactor?: number
  /**
   * 工作頻率(MHz)。有給就額外要求第一 Fresnel 區 60% 淨空，而不是只看「有沒有擋到」。
   * 純幾何視線會把「擦過稜線」判為暢通，實際上繞射損耗很大——VHF 尤其明顯：
   *   145MHz 走 40km，F1 半徑約 144m，需淨空 86m；
   *   X 波段 9.4GHz 同距離只需 11m（波長短，Fresnel 區小）。
   * 因此同一套實作用頻率驅動，對無線電與雷達自動給出合理的嚴格度。
   * 不給則退回純幾何判定（與舊行為相同）。
   */
  freqMHz?: number
}

/**
 * 第一 Fresnel 區半徑(m)。d1/d2 為該點到兩端的距離(km)，D 為總路徑長(km)。
 *   F1 = 17.32 × √( d1·d2 / (f_GHz · D) )
 */
export function fresnelRadiusM(d1Km: number, d2Km: number, freqMHz: number, totalKm: number): number {
  const fGHz = Math.max(0.001, freqMHz / 1000)
  if (!(totalKm > 0)) return 0
  return 17.32 * Math.sqrt(Math.max(0, (d1Km * d2Km) / (fGHz * totalKm)))
}

/**
 * 算出地形遮蔽覆蓋多邊形（每方位一個「最遠可視點」）。
 * 失敗（無網路等）會 throw，呼叫端保留原本圓圈即可。
 */
export async function terrainCoverage(inp: TerrainInput, opts: TerrainOpts = {}): Promise<[number, number][]> {
  const { lat, lng, antennaM, targetM, maxKm } = inp
  const k = inp.kFactor ?? 4 / 3
  if (!(maxKm > 0)) return []

  // ── 取樣密度（36 方位 × 28 點 ≈ 1009 點 / 11 批請求，elevationBatch 分批+退避）──
  //
  // 舊版是「等距」取樣：stepKm = maxKm/10，最多 14 步。問題在於第一個取樣點就落在
  // maxKm/10 —— 240km 的高山站，第一點在 24km 外，站台自己旁邊那座山、腳下的岬角
  // 完全沒被取樣到。而遮蔽多半正是由近處地形決定的，等於把最關鍵的部分漏掉。
  //
  // 改為冪次分佈（d ∝ (s/steps)^1.6）：近場密、遠場疏。理由是
  //   • 近場：視線仰角變化快，一座近山就能擋掉整個方位，需要高解析度；
  //   • 遠場：地球曲率已把視線抬高（240km 處抬升約 470m），要擋住得是很高的地形，
  //     且同樣的角度誤差在遠處對應的高度差較大，密集取樣的邊際效益低。
  //
  // 對 240km 站：首點 24km → 1.16km（改善約 20 倍）。
  //
  // ⚠ 已知殘留限制：遠場末段間距仍約 13km（240km 站），寬度小於此的離島／礁岩
  //   仍可能落在兩點之間而未被偵測到。要根治需大幅增加請求數（會踩免費高程 API
  //   限流，v2.32 已因此吃過虧），或改用靜態離島圖層另行判定。
  const bearings = opts.bearings ?? 36
  const steps = opts.steps ?? 28
  const SPREAD = 1.6

  // 各取樣點距站台的距離(km)，近密遠疏
  const distKm: number[] = []
  for (let s = 1; s <= steps; s++) distKm.push(maxKm * Math.pow(s / steps, SPREAD))

  // 取樣點：第 0 個是站台本身，其後每方位 steps 個
  const pts: [number, number][] = [[lat, lng]]
  for (let b = 0; b < bearings; b++) {
    const brg = (b / bearings) * 360
    for (const d of distKm) pts.push(dest(lat, lng, brg, d * 1000))
  }

  const elevs = await elevationBatch(pts)
  // 天線頂海拔＝站點地面高程（本函式自查的 DEM）＋天線高（antennaTopM 一致處理：
  // 一般鐵塔高相加；>300m 視為絕對海拔不重複加）。與涵蓋圈用同一套邏輯。
  const H0 = antennaTopM(elevs[0], antennaM) + 3

  const ring: [number, number][] = []
  let p = 1
  for (let b = 0; b < bearings; b++) {
    const brg = (b / bearings) * 360
    const g: number[] = []
    for (let s = 0; s < steps; s++) g.push(elevs[p + s])
    p += steps

    let reachM = 0
    for (let s = 1; s <= steps; s++) {
      const dKm = distKm[s - 1]
      const dM = dKm * 1000
      const Hr = g[s - 1] + targetM // 目標/收訊端高（海拔）
      let clear = true
      for (let m = 1; m < s; m++) {
        const dmKm = distKm[m - 1]
        const dmM = dmKm * 1000
        const losH = H0 + ((Hr - H0) * dmM) / dM // 視線在 dm 處的海拔高度
        const bulge = (dmM * (dM - dmM)) / (2 * k * R_EARTH) // 地球曲率抬升（隨 k 變）
        // 有給頻率 → 要求第一 Fresnel 區 60% 淨空（純幾何會把擦過稜線判為暢通，
        // 但實際繞射損耗很大）。沒給就退回純幾何，與舊行為一致。
        const need = inp.freqMHz ? 0.6 * fresnelRadiusM(dmKm, dKm - dmKm, inp.freqMHz, dKm) : 0
        if (g[m - 1] + bulge + need > losH) {
          clear = false
          break
        }
      }
      if (clear) reachM = dM // 記錄最遠可視（可越過山脊看到遠方山谷）
    }
    ring.push(reachM > 0 ? dest(lat, lng, brg, reachM) : [lat, lng])
  }
  return ring
}
