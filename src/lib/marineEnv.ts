// ── 海象環境資料源 (Open-Meteo，免金鑰、免費) ────────────────
//
// 抓風（來向）、洋流（流向）、浪高。給風場箭頭、洋流箭頭、漂流預判用。
// Open-Meteo 有 CORS，瀏覽器可直接呼叫；支援多座標一次請求（grid 批次）。

export interface MarineEnv {
  lat: number
  lng: number
  /** 風速 m/s */
  windSpeed: number
  /** 風的來向（度，氣象慣例 from）。 */
  windDir: number
  /** 洋流速 m/s */
  currentSpeed: number
  /** 洋流流向（度，海洋慣例 toward）。 */
  currentDir: number
  /** 浪高 m */
  waveHeight: number
  /** 海表溫度 °C */
  sst: number
  /** 此點是否為陸地（海洋 API 無海溫/浪高回傳→視為陸地，海況圖不上色）。 */
  onLand: boolean
  /** 資料是否為即時抓取（false = 用了離線 fallback）。 */
  live: boolean
}

const WEATHER = 'https://api.open-meteo.com/v1/forecast'
const MARINE = 'https://marine-api.open-meteo.com/v1/marine'

/**
 * 離線 fallback 改用「黑潮氣候平均」空間場，而非到處一樣的固定值。
 *
 * 台灣周邊主要流系（夏季 7 月概況）：
 *  - 台灣東岸：黑潮北上，沿岸強（~1.2 m/s，朝 NNE 20–40°），離岸漸弱。
 *  - 台灣海峽：夏季西南季風驅動偏北流（~0.4 m/s，朝 NE ~35°）。
 *  - 巴士海峽/南端：南海表層流，較弱且多變（~0.4 m/s，朝北）。
 * 這是「氣候平均」不是即時觀測，但地理上真實、比固定值有意義得多。
 * 標記 live:false，UI 會顯示「氣候平均(離線)」以示區別。
 */
export function climatologyCurrent(lat: number, lng: number): { speed: number; dir: number } {
  // 東岸經度界線隨緯度略移：北端約 122.0，南端約 121.0。
  const kuroshioEdge = 121.0 + (lat - 22) * 0.12
  if (lng >= kuroshioEdge - 0.3 && lat >= 21.5 && lat <= 26) {
    // 黑潮主流帶：離岸越遠越弱（0.3° 內最強）。
    const offshore = Math.max(0, lng - kuroshioEdge)
    const speed = Math.max(0.4, 1.35 - offshore * 0.55)
    const dir = 30 + (lat - 22) * 3 // 南段偏北、北段偏東北
    return { speed, dir }
  }
  if (lng < kuroshioEdge - 0.3 && lng >= 118 && lat >= 22 && lat <= 25.6) {
    // 台灣海峽：夏季偏北流。
    return { speed: 0.45, dir: 35 }
  }
  // 其他（南海/外海）：弱北向。
  return { speed: 0.35, dir: 10 }
}

/** 海上網路不穩時的預設值：洋流用黑潮氣候平均（空間變化），風用夏季西南季風。 */
function fallback(lat: number, lng: number): MarineEnv {
  const c = climatologyCurrent(lat, lng)
  return {
    lat,
    lng,
    windSpeed: 6,
    windDir: 225, // 夏季西南風（來向）
    currentSpeed: c.speed,
    currentDir: c.dir,
    waveHeight: 1.2,
    sst: 28,
    onLand: false,
    live: false,
  }
}

async function getJson(url: string, signal: AbortSignal): Promise<any> {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`open-meteo ${res.status}`)
  return res.json()
}

/** 抓單一座標的完整海象（風 + 洋流 + 浪）。 */
export async function fetchEnvAt(lat: number, lng: number): Promise<MarineEnv> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    const wUrl = `${WEATHER}?latitude=${lat}&longitude=${lng}&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms`
    const mUrl = `${MARINE}?latitude=${lat}&longitude=${lng}&current=ocean_current_velocity,ocean_current_direction,wave_height,sea_surface_temperature`
    const [w, m] = await Promise.all([getJson(wUrl, controller.signal), getJson(mUrl, controller.signal)])
    return {
      lat,
      lng,
      windSpeed: num(w?.current?.wind_speed_10m, 5),
      windDir: num(w?.current?.wind_direction_10m, 225),
      currentSpeed: kmhToMs(num(m?.current?.ocean_current_velocity, 1.08)),
      currentDir: num(m?.current?.ocean_current_direction, 20),
      waveHeight: num(m?.current?.wave_height, 1),
      sst: num(m?.current?.sea_surface_temperature, 26),
      onLand: !isFiniteNum(m?.current?.sea_surface_temperature),
      live: true,
    }
  } catch {
    return fallback(lat, lng)
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * 批次抓一整個網格的海象（風場/洋流箭頭用）。
 * Open-Meteo 支援 comma 分隔多座標，一次請求拿回全部。
 */
export async function fetchEnvGrid(points: [number, number][]): Promise<MarineEnv[]> {
  if (points.length === 0) return []
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 9000)
  const lats = points.map((p) => p[0].toFixed(4)).join(',')
  const lngs = points.map((p) => p[1].toFixed(4)).join(',')
  try {
    const wUrl = `${WEATHER}?latitude=${lats}&longitude=${lngs}&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms`
    const mUrl = `${MARINE}?latitude=${lats}&longitude=${lngs}&current=ocean_current_velocity,ocean_current_direction,wave_height,sea_surface_temperature`
    const [w, m] = await Promise.all([getJson(wUrl, controller.signal), getJson(mUrl, controller.signal)])
    const wArr = Array.isArray(w) ? w : [w]
    const mArr = Array.isArray(m) ? m : [m]
    return points.map((p, i) => ({
      lat: p[0],
      lng: p[1],
      windSpeed: num(wArr[i]?.current?.wind_speed_10m, 5),
      windDir: num(wArr[i]?.current?.wind_direction_10m, 225),
      currentSpeed: kmhToMs(num(mArr[i]?.current?.ocean_current_velocity, 1.08)),
      currentDir: num(mArr[i]?.current?.ocean_current_direction, 20),
      waveHeight: num(mArr[i]?.current?.wave_height, 1),
      sst: num(mArr[i]?.current?.sea_surface_temperature, 26),
      onLand: !isFiniteNum(mArr[i]?.current?.sea_surface_temperature),
      live: true,
    }))
  } catch {
    return points.map((p) => fallback(p[0], p[1]))
  } finally {
    clearTimeout(timeout)
  }
}

function num(v: unknown, fallbackVal: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallbackVal
}
function isFiniteNum(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v)
}
function kmhToMs(kmh: number): number {
  return kmh / 3.6
}
