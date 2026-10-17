// ── 離線地圖包 ──────────────────────────────────────────────
//
// 把目前畫面範圍的底圖圖磚預抓進瀏覽器快取（透過 Service Worker 的
// CacheFirst 規則），之後沒訊號也能看這塊海域。
//
// 為了讓「下載的 URL」與「地圖顯示時請求的 URL」完全一致（才會命中快取），
// 網址一律由 basemaps.ts 的同一份樣板填出來，而且只抓「目前這個底圖樣式」
// 真的會請求的那幾層——底圖是好幾家疊起來的，抓錯一家等於白抓。

import { fillTemplate, specActiveAt, type BaseStyle } from './basemaps.ts'

export interface TileCoord {
  z: number
  x: number
  y: number
}

function lon2tile(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z)
}
function lat2tile(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z)
}

/** 算出涵蓋 bounds、從 zMin 到 zMax 的所有圖磚（含上限保護）。 */
export function tilesForBounds(
  bounds: { west: number; south: number; east: number; north: number },
  zMin: number,
  zMax: number,
  cap = 500,
): TileCoord[] {
  const tiles: TileCoord[] = []
  for (let z = zMin; z <= zMax; z++) {
    const xMin = lon2tile(bounds.west, z)
    const xMax = lon2tile(bounds.east, z)
    const yMin = lat2tile(bounds.north, z) // 北在上，y 較小
    const yMax = lat2tile(bounds.south, z)
    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        tiles.push({ z, x, y })
        if (tiles.length >= cap) return tiles
      }
    }
  }
  return tiles
}

/** 圖磚中心點（判斷這張圖磚在不在某一層的範圍內）。 */
function tileCenter({ z, x, y }: TileCoord): { lat: number; lng: number } {
  const n = 2 ** z
  const lng = ((x + 0.5) / n) * 360 - 180
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n))) * 180) / Math.PI
  return { lat, lng }
}

/**
 * 某個底圖樣式在這批圖磚上「實際會請求」的網址。
 *
 * 超過原生層級的那幾層，Leaflet 顯示時用的是原生層級的圖磚放大，
 * 所以要改抓原生層級那一張（不然下載了一堆永遠不會被用到的網址）。
 */
export function urlsForStyle(style: BaseStyle, tiles: TileCoord[]): string[] {
  const out = new Set<string>()
  for (const t of tiles) {
    const c = tileCenter(t)
    for (const spec of style.layers) {
      // 先用原始層級判斷這一層「此時有沒有在畫」（minZoom/maxZoom/範圍）
      const shown =
        (spec.minZoom === undefined || t.z >= spec.minZoom) &&
        (spec.maxZoom === undefined || t.z <= spec.maxZoom)
      if (!shown) continue
      // 超過原生層級：換成原生層級那張（父圖磚）
      const nz = Math.min(t.z, spec.maxNativeZoom)
      const shift = t.z - nz
      const pt = { z: nz, x: t.x >> shift, y: t.y >> shift }
      if (!specActiveAt(spec, pt.z, c.lat, c.lng)) continue
      out.add(fillTemplate(spec.url, pt.z, pt.x, pt.y))
    }
  }
  return [...out]
}

/**
 * 下載圖磚（並行度受控）。fetch 會經過 SW 被 CacheFirst 快取。
 * onProgress(done, total) 回報進度。
 */
export async function downloadTiles(
  urls: string[],
  onProgress: (done: number, total: number) => void,
  concurrency = 6,
): Promise<{ ok: number; fail: number }> {
  let done = 0
  let ok = 0
  let fail = 0
  let idx = 0

  async function worker() {
    while (idx < urls.length) {
      const u = urls[idx++]
      try {
        // cors：跟地圖上 crossOrigin 的 <img> 請求同一種，快取才對得上
        const res = await fetch(u, { mode: 'cors' })
        if (res.ok) ok++
        else fail++
      } catch {
        fail++
      }
      done++
      onProgress(done, urls.length)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker))
  return { ok, fail }
}
