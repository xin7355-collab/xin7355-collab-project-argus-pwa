// ── 萬用座標解析 / 格式化 ───────────────────────────────────
//
// 海上座標格式很多種，這裡吃「一個輸入框」自動判讀常見寫法，省去手動換算：
//   十進位度   24.5, 122.0     24.5N 122.0E     N24.5 E122.0     -24.5 122
//   度分 DDM   24 30.5N 122 00.0E   24°30.5'N 122°00.0'E
//   度分秒 DMS 24 30 00N 122 00 00E  24°30'00"N 122°00'00"E
// 回傳十進位度 {lat,lng}；並提供三種格式化輸出供顯示/複製。

export interface LatLng {
  lat: number
  lng: number
}

/** 解析單一座標分量（可含 1~3 個數字 + 半球字母）。回傳 {value, axis?}。 */
function parseComponent(chunk: string): { value: number; axis?: 'lat' | 'lng' } | null {
  const up = chunk.toUpperCase()
  let sign = 1
  let axis: 'lat' | 'lng' | undefined
  if (/[NS]/.test(up)) {
    axis = 'lat'
    if (up.includes('S')) sign = -1
  } else if (/[EW]/.test(up)) {
    axis = 'lng'
    if (up.includes('W')) sign = -1
  }
  if (/^\s*-/.test(chunk)) sign = -1 // 明確負號
  const nums = up.match(/\d+(?:\.\d+)?/g)
  if (!nums || nums.length === 0) return null
  const n = nums.map(Number)
  let value: number
  if (n.length >= 3) value = n[0] + n[1] / 60 + n[2] / 3600
  else if (n.length === 2) value = n[0] + n[1] / 60
  else value = n[0]
  return { value: sign * value, axis }
}

/**
 * 萬用解析：回傳十進位度 {lat,lng}，無法解析回 null。
 */
export function parseCoord(input: string): LatLng | null {
  if (!input) return null
  // 統一符號為空白（度分秒符號、各式引號、括號等包裝字元）
  const norm = input
    .replace(/[°ºᵒ]/g, ' ')
    .replace(/['′’`]/g, ' ')
    .replace(/["″”]/g, ' ')
    // 括號/方括號/大括號/角括號（半形＋全形＋中式引號）→ 空白，貼上帶 () 也能吃
    .replace(/[()[\]{}<>（）〔〕［］｛｝「」『』【】]/g, ' ')
    // 全形/中文逗號、頓號、分號 → 半形逗號（當作 lat/lng 分隔）
    .replace(/[，、；;]/g, ',')
    .trim()
  if (!norm) return null

  // 切成兩塊（lat / lng）
  let latChunk: string
  let lngChunk: string
  if (norm.includes(',')) {
    const i = norm.indexOf(',')
    latChunk = norm.slice(0, i)
    lngChunk = norm.slice(i + 1)
  } else {
    const letters = [...norm.toUpperCase().matchAll(/[NSEW]/g)]
      .map((m) => m.index)
      .filter((i): i is number => typeof i === 'number')
    if (letters.length >= 2) {
      const i0 = letters[0]
      const i1 = letters[1]
      if (/\d/.test(norm.slice(0, i0))) {
        // 後綴式（24.5N …）→ 第一個字母後切
        latChunk = norm.slice(0, i0 + 1)
        lngChunk = norm.slice(i0 + 1)
      } else {
        // 前綴式（N24.5 …）→ 第二個字母前切
        latChunk = norm.slice(0, i1)
        lngChunk = norm.slice(i1)
      }
    } else if (letters.length === 1) {
      const i0 = letters[0]
      latChunk = norm.slice(0, i0 + 1)
      lngChunk = norm.slice(i0 + 1)
    } else {
      // 純數字：依 token 數平均分兩半（2/4/6 個）
      const toks = norm.match(/-?\d+(?:\.\d+)?/g)
      if (!toks || toks.length < 2 || toks.length % 2 !== 0) return null
      const half = toks.length / 2
      latChunk = toks.slice(0, half).join(' ')
      lngChunk = toks.slice(half).join(' ')
    }
  }

  const a = parseComponent(latChunk)
  const b = parseComponent(lngChunk)
  if (!a || !b) return null

  // 依半球字母指派 lat/lng；沒字母則第一塊為 lat
  const hadAxis = a.axis === 'lat' || a.axis === 'lng' || b.axis === 'lat' || b.axis === 'lng'
  let lat: number
  let lng: number
  if (a.axis === 'lng' || b.axis === 'lat') {
    lat = b.value
    lng = a.value
  } else {
    lat = a.value
    lng = b.value
  }

  // 純數字無半球字母時，若「緯度」超出 ±90 但「經度」在 ±90 內，
  // 判定其實是「經度,緯度」順序（如 120.865,24.722）→ 自動對調。
  if (!hadAxis && Math.abs(lat) > 90 && Math.abs(lng) <= 90) {
    ;[lat, lng] = [lng, lat]
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return { lat, lng }
}

// ── 格式化輸出 ──────────────────────────────────────────────
export function fmtDecimal(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
}

export function fmtDDM(lat: number, lng: number): string {
  return `${ddm(lat, true)}  ${ddm(lng, false)}`
}
export function fmtDMS(lat: number, lng: number): string {
  return `${dms(lat, true)}  ${dms(lng, false)}`
}

function hemi(v: number, isLat: boolean): string {
  return isLat ? (v >= 0 ? 'N' : 'S') : v >= 0 ? 'E' : 'W'
}
function ddm(v: number, isLat: boolean): string {
  const a = Math.abs(v)
  const d = Math.floor(a)
  const m = (a - d) * 60
  return `${d}°${m.toFixed(3).padStart(6, '0')}'${hemi(v, isLat)}`
}
function dms(v: number, isLat: boolean): string {
  const a = Math.abs(v)
  const d = Math.floor(a)
  const mf = (a - d) * 60
  const m = Math.floor(mf)
  const s = (mf - m) * 60
  return `${d}°${String(m).padStart(2, '0')}'${s.toFixed(1).padStart(4, '0')}"${hemi(v, isLat)}`
}
