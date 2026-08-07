// ── 海拔查詢（免金鑰）────────────────────────────────────────
//
// 用 Open-Meteo Elevation API：免金鑰、支援 CORS、全球 90m DEM。
// 海面/外海回傳 0（陸地數位地形模型），適合看檢查據點、沿岸、地形高程。

/**
 * 查單點海拔（公尺）。查不到回 null。加 8 秒 timeout 避免海上網路卡死。
 */
export async function elevation(lat: number, lng: number): Promise<number | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${lat.toFixed(5)}&longitude=${lng.toFixed(5)}`
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`海拔服務 ${res.status}`)
    const j = (await res.json()) as { elevation?: number[] }
    const v = Array.isArray(j.elevation) ? j.elevation[0] : null
    return Number.isFinite(v as number) ? (v as number) : null
  } finally {
    clearTimeout(timeout)
  }
}
