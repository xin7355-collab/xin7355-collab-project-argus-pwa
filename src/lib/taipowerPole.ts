// ── 台電電力座標（電線桿/變電箱編號）→ 經緯度 ──────────────────
//
// 台電電桿/變電箱編號本身就把 TWD67 TM2 座標編進去，離線即可解到 1–10m，
// 不需連網、不需金鑰——最適合「依報案電桿號定位」。
//
// 格式：字母 + 4位數字(圖號) + 2字母(100m格) + 2或4位數字(10m/1m)
//   9碼 例：B8146CC58   （10m 精度）
//   11碼 例：R1998EE7912（1m 精度）
// 解碼流程：電力座標 → TWD67 TM2 →(+828,-207 近似)→ TWD97 TM2 → WGS84 經緯度。
// 換算規則參考公開的「上河文化」電力座標轉換；TWD67→TWD97 用常數位移，
// 全台約數公尺誤差（找電桿夠用；精密作業請以官方為準）。

/** 第一碼字母 → TWD67 TM2 區塊原點（最西 X、最南 Y，公尺）。 */
const TP_ORIGIN: Record<string, { e: number; n: number }> = {
  A: { e: 170000, n: 2750000 },
  B: { e: 250000, n: 2750000 },
  C: { e: 330000, n: 2750000 },
  D: { e: 170000, n: 2700000 },
  E: { e: 250000, n: 2700000 },
  F: { e: 330000, n: 2700000 },
  G: { e: 170000, n: 2650000 },
  H: { e: 250000, n: 2650000 },
  J: { e: 90000, n: 2600000 },
  K: { e: 170000, n: 2600000 },
  L: { e: 250000, n: 2600000 },
  M: { e: 90000, n: 2550000 },
  N: { e: 170000, n: 2550000 },
  O: { e: 250000, n: 2550000 },
  P: { e: 90000, n: 2500000 },
  Q: { e: 170000, n: 2500000 },
  R: { e: 250000, n: 2500000 },
  T: { e: 170000, n: 2450000 },
  U: { e: 250000, n: 2450000 },
  V: { e: 170000, n: 2400000 },
  W: { e: 250000, n: 2400000 },
  X: { e: 275000, n: 2614000 },
  Y: { e: 275000, n: 2564000 },
}

const DEG = 180 / Math.PI

/** TWD97 TM2（GRS80, 中央經線121°, k0=0.9999, 假東250000）→ WGS84 經緯度。 */
function tm2ToWgs84(E: number, N: number): { lat: number; lng: number } {
  const a = 6378137.0
  const f = 1 / 298.257222101
  const k0 = 0.9999
  const lng0 = 121 / DEG
  const dx = 250000
  const e2 = 2 * f - f * f
  const x = E - dx
  const y = N
  const M = y / k0
  const mu = M / (a * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 * e2 * e2) / 256))
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2))
  const fp =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu)
  const e2p = e2 / (1 - e2)
  const cosf = Math.cos(fp)
  const C1 = e2p * cosf * cosf
  const T1 = Math.tan(fp) ** 2
  const sinf = Math.sin(fp)
  const R1 = (a * (1 - e2)) / Math.pow(1 - e2 * sinf * sinf, 1.5)
  const N1 = a / Math.sqrt(1 - e2 * sinf * sinf)
  const D = x / (N1 * k0)
  const lat =
    fp -
    ((N1 * Math.tan(fp)) / R1) *
      ((D * D) / 2 -
        ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * e2p) * D ** 4) / 24 +
        ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 3 * C1 * C1 - 252 * e2p) * D ** 6) / 720)
  const lng =
    lng0 +
    (D -
      ((1 + 2 * T1 + C1) * D ** 3) / 6 +
      ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * e2p + 24 * T1 * T1) * D ** 5) / 120) /
      cosf
  return { lat: lat * DEG, lng: lng * DEG }
}

export interface PoleResult {
  lat: number
  lng: number
  /** 解碼精度（公尺）：9碼≈10m、11碼≈1m。 */
  precisionM: number
  /** 正規化後的電力座標碼。 */
  code: string
}

/**
 * 解碼電力座標（電桿/變電箱編號）→ 經緯度。格式不符或字母超出範圍回 null。
 * 接受大小寫與夾雜空白/符號（會過濾）。
 */
export function decodePowerCode(input: string): PoleResult | null {
  const s = input.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const m = s.match(/^([A-HJ-Z])(\d{4})([A-H])([A-E])(\d{2}|\d{4})$/)
  if (!m) return null
  const [, L, fig, cxL, cyL, tail] = m
  const origin = TP_ORIGIN[L]
  if (!origin) return null
  let e = origin.e + parseInt(fig.slice(0, 2), 10) * 800 + (cxL.charCodeAt(0) - 65) * 100
  let n = origin.n + parseInt(fig.slice(2, 4), 10) * 500 + (cyL.charCodeAt(0) - 65) * 100
  let precisionM = 10
  if (tail.length === 2) {
    e += parseInt(tail[0], 10) * 10
    n += parseInt(tail[1], 10) * 10
  } else {
    e += parseInt(tail.slice(0, 2), 10)
    n += parseInt(tail.slice(2, 4), 10)
    precisionM = 1
  }
  // TWD67 TM2 → TWD97 TM2（近似常數位移）→ WGS84
  const wgs = tm2ToWgs84(e + 828, n - 207)
  if (!Number.isFinite(wgs.lat) || !Number.isFinite(wgs.lng)) return null
  // 台灣範圍粗略合理性檢查（含外島）：超出就視為無效碼
  if (wgs.lat < 20 || wgs.lat > 27 || wgs.lng < 117 || wgs.lng > 123.5) return null
  return { lat: wgs.lat, lng: wgs.lng, precisionM, code: s }
}
