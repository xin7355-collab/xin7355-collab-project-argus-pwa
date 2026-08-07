// ── 地形遮蔽覆蓋（terrain line-of-sight）──────────────────────
//
// 把無線電覆蓋從「圓圈」升級成「被山切出的真實形狀」：沿多條方位射線取樣地形
// 高程(Open-Meteo 90m DEM，免金鑰)，逐點檢查發射天線頂到目標的直線是否被地形
// (含地球曲率 k=4/3 等效半徑)擋住，找出每個方位「還看得到」的最遠點，連成多邊形。
//
// 數位電台在山後＝直接斷訊，所以此形狀比圓圈更貼近實況。需連網取高程。

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
  stepKm?: number
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
}

/**
 * 算出地形遮蔽覆蓋多邊形（每方位一個「最遠可視點」）。
 * 失敗（無網路等）會 throw，呼叫端保留原本圓圈即可。
 */
export async function terrainCoverage(inp: TerrainInput, opts: TerrainOpts = {}): Promise<[number, number][]> {
  const { lat, lng, antennaM, targetM, maxKm } = inp
  const k = inp.kFactor ?? 4 / 3
  if (!(maxKm > 0)) return []
  // 取樣密度：控制在 ~200 點內（1–2 次請求），避免點數過多→逐批請求→限流/逾時失敗。
  // 方位少一點沒關係、沿線步數要夠（LOS 遮蔽靠沿線密度）。
  const bearings = opts.bearings ?? 18
  const stepKm = opts.stepKm ?? Math.max(0.5, maxKm / 11)
  const steps = Math.max(3, Math.min(11, Math.ceil(maxKm / stepKm)))

  // 取樣點：第 0 個是站台本身，其後每方位 steps 個
  const pts: [number, number][] = [[lat, lng]]
  for (let b = 0; b < bearings; b++) {
    const brg = (b / bearings) * 360
    for (let s = 1; s <= steps; s++) {
      pts.push(dest(lat, lng, brg, s * stepKm * 1000))
    }
  }

  const elevs = await elevationBatch(pts)
  const H0 = elevs[0] + antennaM // 天線頂（海拔）

  const ring: [number, number][] = []
  let p = 1
  for (let b = 0; b < bearings; b++) {
    const brg = (b / bearings) * 360
    const g: number[] = []
    for (let s = 0; s < steps; s++) g.push(elevs[p + s])
    p += steps

    let reachM = 0
    for (let s = 1; s <= steps; s++) {
      const dM = s * stepKm * 1000
      const Hr = g[s - 1] + targetM // 目標/收訊端高（海拔）
      let clear = true
      for (let m = 1; m < s; m++) {
        const dmM = m * stepKm * 1000
        const losH = H0 + ((Hr - H0) * dmM) / dM // 視線在 dm 處的海拔高度
        const bulge = (dmM * (dM - dmM)) / (2 * k * R_EARTH) // 地球曲率抬升（隨 k 變）
        if (g[m - 1] + bulge > losH) {
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
