// ── 無人機禁限航區（民航局圖資）─────────────────────────────────────
//
// 資料來源：交通部民用航空局「遙控無人機管理資訊系統」GIS 圖台背後的 ArcGIS 圖層
// （dronegis.caa.gov.tw），內容是民航局與各縣市政府依民用航空法第 99 條之 13 公告的範圍，
// 另有商港區（商港法）與國家公園（國家公園法）兩層。民航局沒有提供下載檔，
// 所以由 scripts/drone-zones.mjs 每天同步一次，整理成小圖磚放在本站 /drone/，
// 手機只下載地圖看得到的那幾格。
//
// 這個檔案是純函式，同步腳本、App、Worker 共用，可以離線測：
// - 正規化：各圖層欄位不一樣，整理成同一種 DroneZone。
//   **聯絡方式整欄不收**：裡面是承辦人姓名、私人手機與 Email，本 repo 公開，不轉載個資；
//   民航局自己也只給機構帳號登入後查。
// - 幾何簡化（2 公尺容差）＋整數座標差分編碼：原始 25 MB 的 GeoJSON 壓到幾 MB，
//   再切成 0.5° 的格子。
// - 判定：點在不在區內（含挖洞的多邊形）、離邊界多遠、臨時公告只在生效期間算數。
//
// 圖資只供參考：民航局系統也寫「如有與公告資料不同處，以公告資料為準」。
// App 一律附上這句話與官方系統連結。

/** 圖層：主空域（禁限航區＋縣市公告）、臨時公告、商港區、國家公園。 */
export type ZoneLayer = 'airspace' | 'temporary' | 'port' | 'park'
/** 紅區＝禁止；黃區＝有條件（限高、限時、要申請）；國家公園＝另依國家公園法辦理。 */
export type ZoneLevel = 'no' | 'limit' | 'notice'

export interface DroneZone {
  /** 圖層＋民航局 objectid，例：airspace:38790。 */
  id: string
  layer: ZoneLayer
  level: ZoneLevel
  /** 類別（機場四周禁止施放範圍、縣市政府限制使用範圍…）。 */
  kind: string
  name: string
  /** 官方說明原文（有條件開放的條件、限高、時段都寫在這裡）。 */
  desc?: string
  /** 主管機關（公告的機關）。 */
  authority?: string
  /** 會商機關（申請時要它同意的機關）。 */
  consult?: string
  /** 官方罰則原文。 */
  penalty?: string
  /** 生效日（台灣日期 YYYY-MM-DD）；沒有＝已生效。 */
  from?: string
  /** 截止日（含當天）；沒有＝長期有效。 */
  to?: string
  /** 「距地面或水面 N 呎以上禁止」的 N（機場四周 200 呎以上禁止施放範圍）。 */
  ceilingFt?: number
  /** 相關規定網址（國家公園管理處的申請頁）。 */
  link?: string
  /** [西, 南, 東, 北]（度）。 */
  bbox: [number, number, number, number]
  /** 多邊形 → 環（第一個是外框，其餘是洞）→ [經度, 緯度]。 */
  polys: number[][][][]
}

/** 圖磚裡的一筆：幾何改成整數差分編碼，其餘欄位跟 DroneZone 一樣。 */
export type EncodedZone = Omit<DroneZone, 'polys'> & { g: number[][][] }

export interface DroneTile {
  v: 1
  cell: string
  zones: EncodedZone[]
}

export interface DroneIndex {
  v: 1
  /** 內容指紋（前 16 碼）：圖磚網址帶這個，資料一變就是新網址，快取不會拿到舊的。 */
  version: string
  generatedAt: string
  source: {
    /** caa＝直接從民航局抓；mirror＝民航局擋掉時改用 GitHub 上的每日鏡像。 */
    kind: 'caa' | 'mirror' | 'fixture'
    /** 鏡像的版本標籤（kind=mirror 時）。 */
    tag?: string
    /** 原始資料的同步時間（ISO）。 */
    fetchedAt: string
  }
  counts: Record<string, number>
  /** 格子大小（度）。 */
  cellDeg: number
  /** 有資料的格子。 */
  cells: string[]
  /** 範圍太大、放進 wide.json 每次都載入的筆數。 */
  wide: number
  /** 縮小地圖時畫的總覽（機場、限航區、商港、國家公園、臨時公告；不含幾千筆縣市公告）筆數。 */
  overview: number
}

// ── 常數 ────────────────────────────────────────────────────────────

export const CELL_DEG = 0.5
/** 座標整數化的倍數：1e5 度 ≈ 1.1 公尺。 */
export const COORD_SCALE = 1e5
/** 幾何簡化容差（公尺）：比手機 GPS 誤差小得多，判定不受影響，資料少一大半。 */
export const SIMPLIFY_M = 2
/** 一筆跨超過這麼多格就放進 wide.json（每次都載），不要在幾十格裡重複。 */
export const WIDE_CELLS = 16
/** 總覽圖磚再簡化到 30 公尺：縮小看全台時只是示意，點選判定一律用完整圖磚。 */
export const OVERVIEW_SIMPLIFY_M = 30
/** 「附近」的範圍：延伸視距最遠 900 公尺（管理規則第 2 條），取 1 公里。 */
export const NEAR_M = 1000
/** 離邊界這麼近就提醒「以官方系統為準」：簡化 2 公尺＋手機 GPS 誤差。 */
export const EDGE_WARN_M = 50
/** 還沒生效的公告，這麼多天內的才列出來。 */
export const UPCOMING_DAYS = 30

/** 民航局系統（官方查詢與申請）。 */
export const CAA_PORTAL = 'https://drone.caa.gov.tw/'
/** 民航局 GIS 圖台。 */
export const CAA_GIS = 'https://dronegis.caa.gov.tw/portal/apps/webappviewer/index.html?id=807bd21438ba4208b4a7e28569fe41aa'

const AIRSPACE_KIND: Record<string, string> = {
  '4': '機場四周禁止施放範圍',
  '5': '機場四周距地面或水面 200 呎以上禁止施放範圍',
  '6': '飛航情報限航區範圍',
  '7': '縣市政府限制使用範圍',
}

// ── 小工具 ──────────────────────────────────────────────────────────

/** 官方文字：統一換行、去頭尾空白、連續空行收成一行。空字串回 undefined。 */
export function cleanText(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined
  const s = String(v)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return s ? s : undefined
}

/** 機關名稱：資料裡有把名稱斷成兩行的（「參山國家風景區\n管理處」），接回去。 */
function cleanName(v: unknown): string | undefined {
  const s = cleanText(v)
  return s ? s.replace(/\s*\n\s*/g, '') : undefined
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/**
 * 民國日期「114/12/24」→「2025-12-24」。民國 900 年以後（資料用 999/12/31 表示長期）回 undefined；
 * 格式不對也回 undefined（寧可當成沒有期限，也不要算錯日期）。
 */
export function rocDate(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined
  const m = String(v).trim().match(/^(\d{2,3})[./-](\d{1,2})[./-](\d{1,2})$/)
  if (!m) return undefined
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (y >= 900 || mo < 1 || mo > 12 || d < 1 || d > 31) return undefined
  return `${y + 1911}-${pad2(mo)}-${pad2(d)}`
}

/** 台灣日期（UTC+8）的 YYYY-MM-DD。 */
export function twDate(ms: number): string {
  const d = new Date(ms + 8 * 3600_000)
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}

/** ArcGIS 的毫秒時間戳 → 台灣日期；西元 2200 年以後（資料用來表示長期）回 undefined。 */
export function epochDate(v: unknown): string | undefined {
  if (v === null || v === undefined || v === '') return undefined
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return undefined
  const s = twDate(n)
  return Number(s.slice(0, 4)) >= 2200 ? undefined : s
}

/** 只收 https 網址（資料是外部來的，不讓 javascript: 之類的東西變成可以點的連結）。 */
function safeUrl(v: unknown): string | undefined {
  const s = cleanText(v)
  if (!s) return undefined
  try {
    const u = new URL(s)
    return u.protocol === 'https:' ? u.toString() : undefined
  } catch {
    return undefined
  }
}

// ── 幾何 ────────────────────────────────────────────────────────────

type Pt = [number, number]

/** GeoJSON Polygon／MultiPolygon → 多邊形陣列；其他型別回空陣列。 */
export function geometryPolys(geom: unknown): number[][][][] {
  const g = geom as { type?: string; coordinates?: unknown } | null
  if (!g || !Array.isArray(g.coordinates)) return []
  if (g.type === 'Polygon') return [g.coordinates as number[][][]]
  if (g.type === 'MultiPolygon') return g.coordinates as number[][][][]
  return []
}

/** Douglas–Peucker（經度乘 cos(緯度)，容差用公尺換算）。頭尾一定留著。 */
function douglasPeucker(pts: Pt[], tolM: number): Pt[] {
  if (pts.length < 3) return pts
  const k = Math.cos((pts[0][1] * Math.PI) / 180)
  const tol = tolM / 111_320
  const tol2 = tol * tol
  const keep = new Uint8Array(pts.length)
  keep[0] = 1
  keep[pts.length - 1] = 1
  const stack: [number, number][] = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    const ax = pts[a][0] * k
    const ay = pts[a][1]
    const dx = pts[b][0] * k - ax
    const dy = pts[b][1] - ay
    const len2 = dx * dx + dy * dy
    let best = -1
    let bi = -1
    for (let i = a + 1; i < b; i++) {
      const px = pts[i][0] * k - ax
      const py = pts[i][1] - ay
      let d2: number
      if (len2 === 0) d2 = px * px + py * py
      else {
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2))
        const qx = px - t * dx
        const qy = py - t * dy
        d2 = qx * qx + qy * qy
      }
      if (d2 > best) {
        best = d2
        bi = i
      }
    }
    if (bi > 0 && best > tol2) {
      keep[bi] = 1
      stack.push([a, bi], [bi, b])
    }
  }
  return pts.filter((_, i) => keep[i] === 1)
}

/** 四捨五入到 1e-5 度並拿掉連續重複點。 */
function roundRing(ring: Pt[]): Pt[] {
  const out: Pt[] = []
  for (const [x, y] of ring) {
    const p: Pt = [Math.round(x * COORD_SCALE) / COORD_SCALE, Math.round(y * COORD_SCALE) / COORD_SCALE]
    const last = out[out.length - 1]
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p)
  }
  return out
}

/**
 * 簡化一個環：先簡化、再四捨五入；結果要是封閉、至少 4 點（3 個不同點）。
 * 簡化後太少點（很小的圓被收成一條線）就退回只四捨五入的原環；連原環都不成形就丟掉（回 null）。
 */
export function simplifyRing(ring: number[][], tolM = SIMPLIFY_M): number[][] | null {
  const pts = ring.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])).map((p) => [p[0], p[1]] as Pt)
  if (pts.length < 4) return null
  const close = (r: Pt[]): Pt[] => {
    if (r.length && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1])) r.push([r[0][0], r[0][1]])
    return r
  }
  const simple = close(roundRing(douglasPeucker(close(pts.slice()), tolM)))
  if (simple.length >= 4) return simple
  const plain = close(roundRing(pts))
  return plain.length >= 4 ? plain : null
}

export function polysBbox(polys: number[][][][]): [number, number, number, number] {
  let w = Infinity
  let s = Infinity
  let e = -Infinity
  let n = -Infinity
  for (const poly of polys)
    for (const ring of poly)
      for (const [x, y] of ring) {
        if (x < w) w = x
        if (x > e) e = x
        if (y < s) s = y
        if (y > n) n = y
      }
  return [w, s, e, n]
}

/** 環 → 整數差分 [x0, y0, dx1, dy1, …]（x、y 是度 × 1e5）。 */
export function encodeRing(ring: number[][]): number[] {
  const out: number[] = []
  let px = 0
  let py = 0
  ring.forEach(([x, y], i) => {
    const ix = Math.round(x * COORD_SCALE)
    const iy = Math.round(y * COORD_SCALE)
    if (i === 0) out.push(ix, iy)
    else out.push(ix - px, iy - py)
    px = ix
    py = iy
  })
  return out
}

export function decodeRing(flat: number[]): number[][] {
  const out: number[][] = []
  let x = 0
  let y = 0
  for (let i = 0; i + 1 < flat.length; i += 2) {
    x += flat[i]
    y += flat[i + 1]
    out.push([x / COORD_SCALE, y / COORD_SCALE])
  }
  return out
}

export function encodeZone(z: DroneZone): EncodedZone {
  const { polys, ...rest } = z
  return { ...rest, g: polys.map((p) => p.map(encodeRing)) }
}

export function decodeZone(e: EncodedZone): DroneZone {
  const { g, ...rest } = e
  return { ...rest, polys: g.map((p) => p.map(decodeRing)) }
}

// ── 正規化（各圖層欄位 → DroneZone）──────────────────────────────────

type Props = Record<string, unknown>

/** 把幾何整理好（簡化、丟掉不成形的環、沒有外框的多邊形）。全部不成形回 null。 */
function cleanPolys(geom: unknown): number[][][][] | null {
  const out: number[][][][] = []
  for (const poly of geometryPolys(geom)) {
    if (!Array.isArray(poly) || !poly.length) continue
    const outer = simplifyRing(poly[0])
    if (!outer) continue
    const holes = poly
      .slice(1)
      .map((r) => simplifyRing(r))
      .filter((r): r is number[][] => !!r)
    out.push([outer, ...holes])
  }
  return out.length ? out : null
}

function levelOf(cond: unknown, color: unknown): ZoneLevel {
  const c = String(cond ?? '')
  if (c.includes('禁止')) return 'no'
  if (c.includes('限制') || c.includes('管制')) return 'limit'
  const col = String(color ?? '')
  if (col.includes('紅')) return 'no'
  return 'limit'
}

/** 主空域與臨時空域（欄位相同）。 */
export function normalizeAirspace(f: { properties?: Props | null; geometry?: unknown }, layer: 'airspace' | 'temporary'): DroneZone | null {
  const p = f.properties ?? {}
  const polys = cleanPolys(f.geometry)
  const oid = p.objectid
  if (!polys || oid === undefined || oid === null) return null
  const typ = String(p['空域類型'] ?? p['空域類別'] ?? '')
  const kind = cleanName(p['空域類別名稱']) ?? AIRSPACE_KIND[typ] ?? '公告範圍'
  const z: DroneZone = {
    id: `${layer}:${oid}`,
    layer,
    level: levelOf(p['條件'], p['空域顏色']),
    kind,
    name: cleanName(p['空域名稱']) ?? kind,
    desc: cleanText(p['空域說明']),
    authority: cleanName(p['主管機關名稱']),
    consult: cleanName(p['會商機關名稱']),
    penalty: cleanText(p['罰則']),
    from: rocDate(p['有效日期起']),
    to: rocDate(p['有效日期迄']),
    bbox: polysBbox(polys),
    polys,
  }
  // 類別本身就寫明「200 呎以上禁止」：限高是確定的，不必從說明文字猜
  if (typ === '5' || /200\s*呎以上禁止/.test(kind)) z.ceilingFt = 200
  return prune(z)
}

/** 商港區（商港法第 36 條之 1）。 */
export function normalizePort(f: { properties?: Props | null; geometry?: unknown }): DroneZone | null {
  const p = f.properties ?? {}
  const polys = cleanPolys(f.geometry)
  const oid = p.objectid
  if (!polys || oid === undefined || oid === null) return null
  const name = cleanName(p['名稱']) ?? cleanName(p['name']) ?? '商港區域'
  return prune({
    id: `port:${oid}`,
    layer: 'port',
    level: levelOf(p['條件'], null),
    kind: '商港區域特定範圍（商港法）',
    name,
    desc: cleanText(p['說明']),
    authority: cleanName(p['管理_及會商_機關']),
    from: epochDate(p['有效日期起']),
    to: epochDate(p['有效日期迄']),
    bbox: polysBbox(polys),
    polys,
  })
}

/** 國家公園（國家公園法：在園區內飛要另外向管理處申請）。 */
export function normalizePark(f: { properties?: Props | null; geometry?: unknown }): DroneZone | null {
  const p = f.properties ?? {}
  const polys = cleanPolys(f.geometry)
  const oid = p.objectid
  if (!polys || oid === undefined || oid === null) return null
  const name = cleanName(p['name_full']) ?? '國家公園'
  return prune({
    id: `park:${oid}`,
    layer: 'park',
    level: 'notice',
    kind: '國家公園（國家公園法）',
    name,
    link: safeUrl(p['相關規']),
    bbox: polysBbox(polys),
    polys,
  })
}

/** 拿掉值是 undefined 的欄位（圖磚少幾個字、測試比對也乾淨）。 */
function prune(z: DroneZone): DroneZone {
  for (const k of Object.keys(z) as (keyof DroneZone)[]) if (z[k] === undefined) delete z[k]
  return z
}

// ── 切格 ────────────────────────────────────────────────────────────

export function cellKey(lat: number, lng: number, deg = CELL_DEG): string {
  return `${Math.floor(lat / deg)}_${Math.floor(lng / deg)}`
}

/** 一個範圍蓋到的所有格子。 */
export function cellsForBbox(bbox: [number, number, number, number], deg = CELL_DEG): string[] {
  const [w, s, e, n] = bbox
  const out: string[] = []
  for (let y = Math.floor(s / deg); y <= Math.floor(n / deg); y++)
    for (let x = Math.floor(w / deg); x <= Math.floor(e / deg); x++) out.push(`${y}_${x}`)
  return out
}

/** 分到格子：一筆跨好幾格就每格都放一份（點選判定只看自己那格就夠）；跨太多格的另外放。 */
export function tileZones(zones: DroneZone[], deg = CELL_DEG): { tiles: Map<string, DroneZone[]>; wide: DroneZone[] } {
  const tiles = new Map<string, DroneZone[]>()
  const wide: DroneZone[] = []
  for (const z of zones) {
    const cells = cellsForBbox(z.bbox, deg)
    if (cells.length > WIDE_CELLS) {
      wide.push(z)
      continue
    }
    for (const c of cells) {
      const arr = tiles.get(c)
      if (arr) arr.push(z)
      else tiles.set(c, [z])
    }
  }
  return { tiles, wide }
}

/** 縣市政府公告的（幾千筆、多是市區的小範圍）不放進總覽，其餘都放。 */
export function isOverviewZone(z: Pick<DroneZone, 'layer' | 'kind'>): boolean {
  return !(z.layer === 'airspace' && z.kind === AIRSPACE_KIND['7'])
}

/** 總覽用：幾何再簡化（30 公尺）；簡化不動的環照舊。 */
export function coarsenZone(z: DroneZone, tolM = OVERVIEW_SIMPLIFY_M): DroneZone {
  const polys = z.polys
    .map((poly) => poly.map((r) => simplifyRing(r, tolM) ?? r))
    .filter((poly) => poly.length > 0)
  return { ...z, polys }
}

// ── 判定 ────────────────────────────────────────────────────────────

/** 射線法（偶奇規則）：點在環內？ */
function inRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0]
    const yi = ring[i][1]
    const xj = ring[j][0]
    const yj = ring[j][1]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** 點在區內？（任一個多邊形：在外框內、且不在洞裡） */
export function zoneContains(z: Pick<DroneZone, 'bbox' | 'polys'>, lat: number, lng: number): boolean {
  const [w, s, e, n] = z.bbox
  if (lng < w || lng > e || lat < s || lat > n) return false
  for (const poly of z.polys) {
    if (!poly.length || !inRing(lng, lat, poly[0])) continue
    if (!poly.slice(1).some((h) => inRing(lng, lat, h))) return true
  }
  return false
}

/** 點到區域邊界的最短距離（公尺；局部平面近似，幾公里內誤差很小）。 */
export function distanceToEdgeM(z: Pick<DroneZone, 'polys'>, lat: number, lng: number): number {
  const kx = 111_320 * Math.cos((lat * Math.PI) / 180)
  const ky = 110_574
  let best = Infinity
  for (const poly of z.polys)
    for (const ring of poly)
      for (let i = 1; i < ring.length; i++) {
        const ax = (ring[i - 1][0] - lng) * kx
        const ay = (ring[i - 1][1] - lat) * ky
        const bx = (ring[i][0] - lng) * kx
        const by = (ring[i][1] - lat) * ky
        const dx = bx - ax
        const dy = by - ay
        const len2 = dx * dx + dy * dy
        const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2))
        const d = Math.hypot(ax + t * dx, ay + t * dy)
        if (d < best) best = d
      }
  return best
}

/** 這個公告在 nowMs 那天有沒有效（台灣日期，含頭含尾）。 */
export function zoneActive(z: Pick<DroneZone, 'from' | 'to'>, nowMs: number): boolean {
  const today = twDate(nowMs)
  if (z.from && today < z.from) return false
  if (z.to && today > z.to) return false
  return true
}

/** 還沒生效、但 UPCOMING_DAYS 天內會生效。 */
export function zoneUpcoming(z: Pick<DroneZone, 'from' | 'to'>, nowMs: number): boolean {
  if (!z.from) return false
  const today = twDate(nowMs)
  if (today >= z.from) return false
  return z.from <= twDate(nowMs + UPCOMING_DAYS * 86_400_000)
}

export type Verdict = 'no' | 'limit' | 'notice' | 'clear'

export interface PointCheck {
  verdict: Verdict
  /** 點所在、目前有效的公告（禁止的排前面）。 */
  inside: DroneZone[]
  /** 1 公里內、目前有效的（不含已經在裡面的），近的在前。 */
  near: { zone: DroneZone; distM: number }[]
  /** 點所在、但還沒生效（30 天內會生效）的。 */
  upcoming: DroneZone[]
  /** 離某個邊界不到 50 公尺：GPS 誤差＋簡化誤差都可能讓判定相反。 */
  nearEdge: boolean
  /** 機場四周的「N 呎以上禁止」：點在那種範圍內時的最低限高。 */
  ceilingFt?: number
}

const LEVEL_RANK: Record<ZoneLevel, number> = { no: 0, limit: 1, notice: 2 }

/**
 * 同樣是禁止時誰排前面：民航局公告的（機場四周、限航區；罰 30–150 萬元）＞臨時公告＞商港＞
 * 縣市公告（罰 3–15 萬元）＞國家公園。結論那一句講最重的那個。
 */
function severityRank(z: Pick<DroneZone, 'layer' | 'kind'>): number {
  if (z.layer === 'airspace') return z.kind === AIRSPACE_KIND['7'] ? 3 : 0
  if (z.layer === 'temporary') return 1
  if (z.layer === 'port') return 2
  return 4
}

/** 去掉重複（同一筆在好幾格都有）。 */
export function uniqueZones(zones: Iterable<DroneZone>): DroneZone[] {
  const seen = new Map<string, DroneZone>()
  for (const z of zones) if (!seen.has(z.id)) seen.set(z.id, z)
  return [...seen.values()]
}

/** 這個點能不能飛：紅區在內＝禁止；黃區＝有條件；國家公園＝另依國家公園法；都沒有＝不在公告範圍內。 */
export function checkPoint(lat: number, lng: number, zones: Iterable<DroneZone>, nowMs: number): PointCheck {
  const inside: DroneZone[] = []
  const upcoming: DroneZone[] = []
  const near: { zone: DroneZone; distM: number }[] = []
  let edge = Infinity
  // 先用 bbox 粗篩：1 公里外的不必算距離
  const padLat = NEAR_M / 110_574
  const padLng = NEAR_M / (111_320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)))
  for (const z of uniqueZones(zones)) {
    const [w, s, e, n] = z.bbox
    if (lng < w - padLng || lng > e + padLng || lat < s - padLat || lat > n + padLat) continue
    const active = zoneActive(z, nowMs)
    const inZone = zoneContains(z, lat, lng)
    if (!active) {
      if (inZone && zoneUpcoming(z, nowMs)) upcoming.push(z)
      continue
    }
    const d = distanceToEdgeM(z, lat, lng)
    if (inZone) {
      inside.push(z)
      edge = Math.min(edge, d)
    } else if (d <= NEAR_M) {
      near.push({ zone: z, distM: d })
      edge = Math.min(edge, d)
    }
  }
  inside.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || severityRank(a) - severityRank(b) || a.name.localeCompare(b.name, 'zh-Hant'))
  near.sort((a, b) => a.distM - b.distM)
  const verdict: Verdict = inside.length ? inside[0].level : 'clear'
  const ceilings = inside.map((z) => z.ceilingFt).filter((v): v is number => typeof v === 'number')
  const out: PointCheck = { verdict, inside, near, upcoming, nearEdge: edge <= EDGE_WARN_M }
  if (ceilings.length) out.ceilingFt = Math.min(...ceilings)
  return out
}

// ── 給畫面用的文字 ──────────────────────────────────────────────────

export const LEVEL_TEXT: Record<ZoneLevel, string> = {
  no: '禁止',
  limit: '有條件',
  notice: '另有規定',
}

/** 一筆公告的類別標籤：類別本身就講得清楚（機場四周、縣市政府、商港、國家公園），臨時公告另外標出來。 */
export function zoneTag(z: Pick<DroneZone, 'layer' | 'kind'>): string {
  return z.layer === 'temporary' ? `臨時公告・${z.kind}` : z.kind
}

/** 官方說明跟名稱一模一樣時（機場範圍常這樣）不再重複顯示。 */
export function zoneDesc(z: Pick<DroneZone, 'desc' | 'name'>): string | undefined {
  return z.desc && z.desc !== z.name ? z.desc : undefined
}

/** 呎 → 公尺（顯示用，四捨五入到整數）。 */
export const ftToM = (ft: number) => Math.round(ft * 0.3048)

/** 生效期間的文字：長期、到哪天、從哪天起。 */
export function periodText(z: Pick<DroneZone, 'from' | 'to'>): string {
  if (z.from && z.to) return z.from === z.to ? `${z.from} 當天` : `${z.from} 到 ${z.to}`
  if (z.to) return `到 ${z.to} 為止`
  if (z.from) return `${z.from} 起`
  return '長期'
}

/** 一句話結論（面板大字、語音助理）。 */
export function verdictText(c: Pick<PointCheck, 'verdict' | 'inside' | 'ceilingFt'>): string {
  const more = c.inside.length > 1 ? `等 ${c.inside.length} 個` : ''
  if (c.verdict === 'no') return `禁止飛航：在「${c.inside[0].name}」${more}範圍內`
  if (c.verdict === 'limit') {
    if (c.ceilingFt !== undefined && c.inside.every((z) => z.level !== 'limit' || z.ceilingFt !== undefined)) {
      return `有條件：${c.ceilingFt} 呎（約 ${ftToM(c.ceilingFt)} 公尺）以上禁止`
    }
    return `有條件：在「${c.inside[0].name}」${more}範圍內，照說明的條件才能飛`
  }
  if (c.verdict === 'notice') return `在「${c.inside[0].name}」內，要另外向管理處申請`
  return '不在公告的禁限航區內（仍要遵守 400 呎、日出到日落、目視範圍等規定）'
}
