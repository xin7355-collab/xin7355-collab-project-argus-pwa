import L from 'leaflet'
import { getConfig, isSentinelConfigured } from './config'
import { layerFor } from './sentinel'
import { BASE_STYLES, DEFAULT_BASE, type BaseLayerId, type TileSpec } from './basemaps'
import { classifyTile, shouldHide, type HideRule, type TileSample } from './tileFilter'

export type { BaseLayerId } from './basemaps'

// ── 把 basemaps.ts 的樣式描述組成 Leaflet 圖層 ──────────────────

/** 需要 Sentinel Instance ID 才能用的底圖。 */
export const SENTINEL_BASES: BaseLayerId[] = ['sentinel2', 'sentinel1']

/** 近 N 天的 ISO 時間區間（Sentinel Hub WMS 會回傳區間內最新影像鑲嵌）。 */
function recentRange(days: number): string {
  const end = new Date()
  const start = new Date(end.valueOf() - days * 86400000)
  const f = (d: Date) => d.toISOString().slice(0, 10)
  return `${f(start)}/${f(end)}`
}

/** Sentinel Hub WMS 「近期最新」底圖（不透明，當主底圖用）。 */
function sentinelBase(layer: string, opts: { days: number; maxcc?: number }): L.TileLayer {
  const cfg = getConfig()
  const url = `${cfg.sentinelWmsUrl}/${cfg.sentinelInstanceId || 'MISSING_INSTANCE_ID'}`
  const params: Record<string, string | number | boolean> = {
    layers: layer,
    format: 'image/jpeg',
    transparent: false,
    version: '1.3.0',
    time: recentRange(opts.days),
  }
  if (typeof opts.maxcc === 'number') params.maxcc = opts.maxcc
  return L.tileLayer.wms(url, { ...params, maxZoom: 20, attribution: '© Copernicus / Sentinel Hub' } as L.WMSOptions)
}

// ── 假圖磚過濾 ──────────────────────────────────────────────
//
// 共用一張 16×16 的小畫布：把剛載入的圖磚縮小畫上去、讀回 256 個像素，
// 交給 tileFilter 判斷。每張圖磚約 0.1 ms，一個畫面二三十張不到 5 ms。

let sampler: CanvasRenderingContext2D | null | undefined
const SAMPLE = 16

function sampleTile(img: HTMLImageElement): TileSample | null {
  if (sampler === undefined) {
    const c = document.createElement('canvas')
    c.width = SAMPLE
    c.height = SAMPLE
    // willReadFrequently：讓畫布留在 CPU，iPhone 上每次讀像素不用從 GPU 搬回來
    sampler = c.getContext('2d', { willReadFrequently: true })
  }
  if (!sampler) return null
  sampler.clearRect(0, 0, SAMPLE, SAMPLE)
  sampler.drawImage(img, 0, 0, SAMPLE, SAMPLE)
  // 伺服器若沒回 CORS 標頭，這行會丟 SecurityError——由呼叫端吞掉、保留圖磚
  const d = sampler.getImageData(0, 0, SAMPLE, SAMPLE).data
  return { data: d, w: SAMPLE, h: SAMPLE }
}

function attachHide(layer: L.TileLayer, rule: HideRule) {
  layer.on('tileload', (e: L.TileEvent) => {
    const img = e.tile as HTMLImageElement
    try {
      const s = sampleTile(img)
      if (s && shouldHide(classifyTile(s), rule)) img.style.visibility = 'hidden'
    } catch {
      // 讀不到像素就不判斷——寧可多一張空白，也不要把真的地圖藏掉
    }
  })
}

function buildSpec(spec: TileSpec): L.TileLayer {
  const layer = L.tileLayer(spec.url, {
    maxNativeZoom: spec.maxNativeZoom,
    maxZoom: spec.maxZoom ?? 20,
    minZoom: spec.minZoom ?? 0,
    bounds: spec.bounds ? L.latLngBounds(spec.bounds) : undefined,
    opacity: spec.opacity ?? 1,
    attribution: spec.attribution,
    // 要讀像素才能判斷假圖磚。只對實測有 CORS 的主機開（basemaps.test.ts 有守門）——
    // 對沒 CORS 的主機開這個，圖磚會整個載不出來。
    crossOrigin: spec.hide ? 'anonymous' : undefined,
    detectRetina: false,
  })
  if (spec.hide) attachHide(layer, spec.hide)
  return layer
}

/** Sentinel 底圖用不了（沒金鑰，或組態裡沒有對應圖層）。 */
function sentinelUnavailable(id: BaseLayerId): boolean {
  if (id !== 'sentinel2' && id !== 'sentinel1') return false
  return !isSentinelConfigured() || !layerFor(id === 'sentinel1' ? 'sar' : 'optical')
}

/**
 * 組出某個底圖樣式的所有圖層（由下往上）。
 * Sentinel 用不了時退回預設地圖——不然會整片空白，使用者以為 App 壞了。
 */
export function buildBaseStyle(id: BaseLayerId): L.TileLayer[] {
  if (id === 'sentinel2' || id === 'sentinel1') {
    if (sentinelUnavailable(id)) return buildBaseStyle(DEFAULT_BASE)
    return [
      id === 'sentinel1'
        ? sentinelBase(layerFor('sar')!, { days: 30 })
        : sentinelBase(layerFor('optical')!, { days: 120, maxcc: 40 }),
    ]
  }
  return BASE_STYLES[id].layers.map(buildSpec)
}

/** 這個樣式實際會畫的背景色（Sentinel 用不了時跟著退回的樣式走）。 */
export function styleBackground(id: BaseLayerId): string {
  if (sentinelUnavailable(id)) return BASE_STYLES[DEFAULT_BASE].background
  return BASE_STYLES[id].background
}
