/// <reference lib="webworker" />
import type { SatelliteState, WorkerCommand, WorkerMessage } from '../types'

/**
 * 軌道運算 Worker（背景執行緒）
 *
 * 為了「簡單且開箱即用」，這裡用輕量的圓軌道近似模型，而不是完整 SGP4。
 * 若要接真實 TLE，把 propagate() 換成 satellite.js 的 sgp4 即可，介面不變。
 *
 * 重點：所有三角函數運算都在這條背景執行緒跑，主執行緒只收座標，
 * 手機 UI 因此不會卡。
 */

interface OrbitElements {
  id: string
  name: string
  altKm: number
  inclination: number // 傾角（度）
  raan: number // 升交點赤經（度）
  phase: number // 起始相位（度）
  periodMin: number // 週期（分鐘）
}

// 幾顆示範衛星（近似 LEO 對地觀測衛星）。
const FLEET: OrbitElements[] = [
  { id: 'S2A', name: 'Sentinel-2A', altKm: 786, inclination: 98.6, raan: 20, phase: 0, periodMin: 100 },
  { id: 'S1A', name: 'Sentinel-1A', altKm: 693, inclination: 98.2, raan: 80, phase: 120, periodMin: 99 },
  { id: 'S3A', name: 'Sentinel-3A', altKm: 814, inclination: 98.6, raan: 140, phase: 240, periodMin: 101 },
  { id: 'LS9', name: 'Landsat-9', altKm: 705, inclination: 98.2, raan: 200, phase: 60, periodMin: 99 },
  { id: 'ISS', name: 'ISS (ZARYA)', altKm: 420, inclination: 51.6, raan: 300, phase: 180, periodMin: 93 },
]

const DEG = Math.PI / 180
const trails = new Map<string, [number, number][]>()
const MAX_TRAIL = 40

/**
 * 輕量軌道傳播：給定過去毫秒數，回傳次衛星星下點 (lat, lng)。
 * 用球面幾何，把「沿軌道的角度」投影到地表，並疊加地球自轉造成的經度漂移。
 */
function propagate(el: OrbitElements, tSec: number): [number, number] {
  const meanMotion = 360 / (el.periodMin * 60) // 度/秒
  const u = (el.phase + meanMotion * tSec) * DEG // 軌道內幅角
  const inc = el.inclination * DEG

  // 星下點緯度
  const lat = Math.asin(Math.sin(inc) * Math.sin(u)) / DEG

  // 星下點經度（相對升交點）
  let lng =
    el.raan + Math.atan2(Math.cos(inc) * Math.sin(u), Math.cos(u)) / DEG
  // 地球自轉：每秒 0.0041667 度（360/86400）往西修正
  lng -= (tSec * 360) / 86400
  // 正規化到 [-180, 180]
  lng = ((((lng + 180) % 360) + 360) % 360) - 180

  return [lat, lng]
}

let timer: ReturnType<typeof setInterval> | null = null
let fps = 10 // 預設更新率
const t0 = Date.now()

function tick() {
  const tSec = (Date.now() - t0) / 1000
  const satellites: SatelliteState[] = FLEET.map((el) => {
    const [lat, lng] = propagate(el, tSec)
    const trail = trails.get(el.id) ?? []
    trail.push([lat, lng])
    if (trail.length > MAX_TRAIL) trail.shift()
    trails.set(el.id, trail)
    return { id: el.id, name: el.name, lat, lng, altKm: el.altKm, trail: [...trail] }
  })

  const msg: WorkerMessage = { type: 'positions', epoch: Date.now(), satellites }
  ;(self as DedicatedWorkerGlobalScope).postMessage(msg)
}

function start() {
  stop()
  timer = setInterval(tick, 1000 / fps)
}

function stop() {
  if (timer !== null) {
    clearInterval(timer)
    timer = null
  }
}

self.onmessage = (e: MessageEvent<WorkerCommand>) => {
  const cmd = e.data
  switch (cmd.type) {
    case 'start':
      start()
      break
    case 'stop':
      stop()
      break
    case 'setRate':
      fps = Math.max(1, Math.min(60, cmd.fps))
      if (timer !== null) start() // 用新速率重啟
      break
  }
}
