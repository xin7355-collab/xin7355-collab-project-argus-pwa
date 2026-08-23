// ── 海拔查詢（免金鑰）────────────────────────────────────────
//
// 用 Open-Meteo Elevation API：免金鑰、支援 CORS、全球 90m DEM。
// 海面/外海回傳 0，適合看檢查據點、沿岸、地形高程。
//
// ⚠️ 資料性質（動到「建築高度」之前必讀）
//
// Open-Meteo 使用 Copernicus DEM GLO-90，屬於 **DSM（地表模型）而非 DTM（裸地模型）**：
// 它量到的是「地表最上緣」，**本來就含建築與植被**，只是被抹平在 90m 網格裡——
// 單棟大樓會被鄰近地面平均掉，整片市區則會整體略為抬高。
//
// 因此若日後要加 OSM 的 building:height／building:levels，**不能直接疊加**，
// 否則同一棟建築會被算兩次：DSM 已抬高的地面 + 又加一次建物高。
// 要做的話必須先確定基準（例如改用真正的 DTM 當地面，再疊建物），
// 不能只是把兩個數字相加。
//
// 註：本專案開發沙箱的網路政策擋掉 api.open-meteo.com，無法就地實證比對，
// 上述性質依 Open-Meteo 與 Copernicus DEM 的公開資料規格。要在自己的網路
// 驗證的話：查一處高樓密集區與相鄰空曠地（同一地面高程）的回傳值，
// DSM 會有明顯落差，DTM 則幾乎相同。

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
