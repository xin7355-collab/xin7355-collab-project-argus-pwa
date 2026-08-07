// ── 離線地圖包 ──────────────────────────────────────────────
//
// 把目前畫面範圍的底圖圖磚預抓進瀏覽器快取（透過 Service Worker 的
// CacheFirst 規則），之後沒訊號也能看這塊海域。
//
// 為了讓「下載的 URL」與「地圖顯示時請求的 URL」完全一致（才會命中快取），
// 底圖固定用單一 subdomain 'a'、非 retina（見 MapContainer 設定）。

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

/** CARTO 深色底圖 URL（與 MapContainer 顯示用一致）。 */
export function tileUrl({ z, x, y }: TileCoord): string {
  return `https://a.basemaps.cartocdn.com/dark_all/${z}/${x}/${y}.png`
}

/**
 * 下載圖磚（並行度受控）。fetch 會經過 SW 被 CacheFirst 快取。
 * onProgress(done, total) 回報進度。
 */
export async function downloadTiles(
  tiles: TileCoord[],
  onProgress: (done: number, total: number) => void,
  concurrency = 6,
): Promise<{ ok: number; fail: number }> {
  let done = 0
  let ok = 0
  let fail = 0
  let idx = 0

  async function worker() {
    while (idx < tiles.length) {
      const t = tiles[idx++]
      try {
        const res = await fetch(tileUrl(t), { mode: 'cors' })
        if (res.ok) ok++
        else fail++
      } catch {
        fail++
      }
      done++
      onProgress(done, tiles.length)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tiles.length) }, worker))
  return { ok, fail }
}
