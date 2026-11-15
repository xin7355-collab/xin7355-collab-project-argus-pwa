// ── AIS 船位資料庫（手機端）──────────────────────────────────
//
// 船位清洗、靜態資料合併、過期淘汰、航跡稀疏化的規則移植自 gods-eye-view
// （MIT License, Copyright (c) 2026 Bilawal Sidhu；授權全文見 docs/licenses/gods-eye-view-MIT.txt）
// 的 server/providers/vessels/ais-store.js 與 src/data/vesselTypes.js，改寫成 TypeScript、
// 改放在手機上跑（原本在伺服器）。
//
// 以前踩過的坑，這裡各對應一條規則：
//   - AIS 用 102.3 節代表「沒有航速」、360° 代表「沒有航向」、511 代表「沒有船艏向」。
//     當真值用的話，沒回報航速的船會變成 102 節、觸發「航速異常」假警報。
//   - 只訂閱 Class A：台灣很多漁船、遊艇是 Class B，整批看不到。
//   - 船名船種比第一筆船位先到時被丟掉，要等下一次靜態報告（可能好幾分鐘）才有名字。
//   - 船只在移動地圖時才清：關掉 AIS 的船會永遠停在原地，看起來像還在那裡。
// 純函式／純資料結構，不碰 DOM 與網路，可在 Node 離線測。

/** 船（或航標）的目前狀態。畫面、掃描比對、攔截工具都吃這個。 */
export interface Vessel {
  mmsi: string
  name: string
  lat: number
  lng: number
  /** 航向（度）；AIS 沒給（360）時是 null。 */
  cog: number | null
  /** 航速（節）；AIS 沒給（102.3）時是 null。 */
  sog: number | null
  /** 船艏向（度）；AIS 沒給（511）時是 null。畫船頭方向優先用它。 */
  heading: number | null
  /** 船種中文（沒有就是「不明」）。航標放航標種類。 */
  type: string
  /** ship＝船；aton＝航標（浮標、燈塔、虛擬航標），不參與可疑船判斷。 */
  kind: 'ship' | 'aton'
  /** 距最後一筆船位多久（秒）。 */
  ageSec: number
  /** 這個位置是依航向航速推算的（最後回報後最多推 3 分鐘）。 */
  reckoned?: boolean
  length?: number | null
  beam?: number | null
  destination?: string
  /** 虛擬航標：該處沒有實體，只是廣播出來的標記。 */
  virtual?: boolean
}

export interface TrackPoint {
  lat: number
  lng: number
  /** 回報時間（epoch 秒，資料源時鐘）。 */
  t: number
}

/** AISStream 邊界框：[[南,西],[北,東]]。 */
export type BBox = [[number, number], [number, number]]

// ── 常數（數值沿用 gods-eye-view 實測調過的）──
/** 30 分鐘沒新船位就移除。 */
export const STALE_MS = 30 * 60 * 1000
/** 手機上最多記幾艘：極低縮放訂閱大範圍時，記憶體不能無限長。 */
export const MAX_VESSELS = 4000
/** 推算船位最多推幾秒：超過就停在最後位置，不要在斷線時一路「開」下去。 */
export const DEAD_RECKON_MAX_S = 180
/** 航跡：每艘最多 64 點；離上一點不到 30 秒或 25 公尺就不記（錨泊的船只剩一點）。 */
export const TRACK_SAMPLES = 64
export const TRACK_MIN_GAP_S = 30
export const TRACK_MIN_MOVE_M = 25
/** 慢於這個速度不推算（漂著或錨泊，推了只會抖）。 */
const RECKON_MIN_KN = 0.5

/** 要訂閱的訊息類型：Class A／B 船位、兩種靜態資料、航標。 */
export const SUBSCRIBE_TYPES = [
  'PositionReport',
  'StandardClassBPositionReport',
  'ExtendedClassBPositionReport',
  'ShipStaticData',
  'StaticDataReport',
  'AidsToNavigationReport',
] as const

const KNOWN_TYPES = new Set<string>(SUBSCRIBE_TYPES)
const DEG = Math.PI / 180

// ── 數值清洗 ──
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v).trim()
}
/** AIS 文字欄位補滿 20 字用 '@' 或空白；去掉補位、合併多餘空白。 */
function cleanName(v: unknown): string {
  return v === null || v === undefined ? '' : String(v).replace(/@+/g, ' ').replace(/\s+/g, ' ').trim()
}
/** 航速：0 ≤ v < 102.3（1023×0.1 節＝沒給）。 */
export function cleanSog(v: unknown): number | null {
  const n = num(v)
  return n !== null && n >= 0 && n < 102.3 ? n : null
}
/** 航向：0 ≤ v < 360（3600×0.1 度＝沒給）。 */
export function cleanCog(v: unknown): number | null {
  const n = num(v)
  return n !== null && n >= 0 && n < 360 ? n : null
}
/** 船艏向：0–359（511＝沒給）。 */
export function cleanHeading(v: unknown): number | null {
  const n = num(v)
  return n !== null && n >= 0 && n < 360 ? n : null
}
/** AIS 用 0 表示「沒有」（船種、IMO、尺寸），不是真的 0。 */
function code(v: unknown): number | null {
  const n = num(v)
  return n !== null && Number.isInteger(n) && n > 0 ? n : null
}
function dims(d: unknown): { length: number | null; beam: number | null } {
  const o = (d ?? {}) as Record<string, unknown>
  const part = (x: unknown) => {
    const n = num(x)
    return n !== null && n > 0 ? n : 0
  }
  const length = part(o.A) + part(o.B)
  const beam = part(o.C) + part(o.D)
  return { length: length > 0 ? length : null, beam: beam > 0 ? beam : null }
}

/** AISStream 的時間「2026-11-15 08:23:45.123 +0000 UTC」→ epoch 秒；讀不懂回 null。 */
export function aisEpochSec(v: unknown): number | null {
  const t = str(v)
  if (!t) return null
  // 「+0000 UTC」不是標準格式；毫秒以下的位數 Date 也吃不下，一起修掉
  const iso = t
    .replace(/\s*\+0000 UTC$/, 'Z')
    .replace(/\s*UTC$/, 'Z')
    .replace(' ', 'T')
    .replace(/(\.\d{3})\d+/, '$1')
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null
}

// ── 船種 ──
const TYPE_SPECIAL: Record<number, string> = {
  30: '漁船',
  31: '拖帶船',
  32: '拖帶船',
  33: '挖泥船',
  34: '潛水作業',
  35: '軍艦',
  36: '帆船',
  37: '遊艇',
  50: '引水船',
  51: '搜救船',
  52: '拖船',
  53: '港勤船',
  54: '防污船',
  55: '執法船',
  58: '醫療船',
}
const TYPE_FAMILY: Record<number, string> = {
  2: '地效翼船',
  4: '高速船',
  5: '特種船',
  6: '客船',
  7: '貨船',
  8: '油輪',
  9: '其他',
}

/** AIS 船種代碼（ITU-R M.1371）→ 中文；0、1x、100 以上沒有定義，回「不明」。 */
export function shipTypeText(t: unknown): string {
  const n = num(t)
  if (n === null || !Number.isInteger(n) || n <= 0 || n >= 100) return '不明'
  return TYPE_SPECIAL[n] ?? TYPE_FAMILY[Math.floor(n / 10)] ?? '不明'
}

const ATON_TYPES = [
  '航標',
  '參考點',
  '雷達信標',
  '離岸固定結構',
  '沉船緊急標示浮標',
  '燈（無光弧）',
  '燈（有光弧）',
  '導航前燈',
  '導航後燈',
  '立標：北方位',
  '立標：東方位',
  '立標：南方位',
  '立標：西方位',
  '立標：左舷',
  '立標：右舷',
  '立標：主航道在左',
  '立標：主航道在右',
  '立標：孤立危險',
  '立標：安全水域',
  '立標：特殊',
  '浮標：北方位',
  '浮標：東方位',
  '浮標：南方位',
  '浮標：西方位',
  '浮標：左舷',
  '浮標：右舷',
  '浮標：主航道在左',
  '浮標：主航道在右',
  '浮標：孤立危險',
  '浮標：安全水域',
  '浮標：特殊',
  '燈船／大型浮標／平台',
]
/** AIS 航標種類（0–31，IALA）→ 中文。 */
export function atonTypeText(t: unknown): string {
  const n = num(t)
  return n !== null && Number.isInteger(n) && n >= 0 && n < ATON_TYPES.length ? ATON_TYPES[n] : ATON_TYPES[0]
}
/** MMSI 99xxxxxxx 是航標台。 */
const ATON_MMSI = /^99\d{7}$/

// ── 資料庫 ──
interface Row {
  mmsi: string
  name: string
  lat: number
  lng: number
  cog: number | null
  sog: number | null
  heading: number | null
  typeCode: number | null
  kind: 'ship' | 'aton'
  atonType?: string
  virtual?: boolean
  length: number | null
  beam: number | null
  destination: string
  /** 手機收到這筆船位的時間（單調時鐘 ms）。 */
  receivedAt: number
  /** 收到當下這筆回報落後資料源最新回報幾秒（資料源時鐘比資料源時鐘，不受手機時間影響）。 */
  lagSec: number
  /** 回報時間（epoch 秒，資料源時鐘）；拿來排航跡。 */
  fixSec: number | null
}
interface Static {
  name: string
  typeCode: number | null
  destination: string
  length: number | null
  beam: number | null
  at: number
}
interface Track {
  pts: TrackPoint[]
}

export class AisStore {
  private rows = new Map<string, Row>()
  private statics = new Map<string, Static>()
  private tracks = new Map<string, Track>()
  /** 只有一筆、等第二筆才配航跡（多數 MMSI 只出現一次，不要每艘都配）。 */
  private pending = new Map<string, TrackPoint>()
  /** 資料源目前看到最新的回報時間（epoch 秒）。 */
  private feedNewest = 0

  get size(): number {
    return this.rows.size
  }

  /**
   * 收一則 AISStream 訊息。回傳 true＝真的是 AIS 資料（看門狗用它判斷「有資料」）。
   * 錯誤訊息、伺服器提示、沒有 MMSI 的東西都回 false。
   */
  ingest(msg: unknown, nowMs: number): boolean {
    if (!msg || typeof msg !== 'object') return false
    const m = msg as Record<string, any>
    const type = m.MessageType
    if (typeof type !== 'string' || !KNOWN_TYPES.has(type)) return false
    const body = m.Message?.[type]
    if (!body || typeof body !== 'object') return false
    const meta = m.MetaData ?? m.Metadata ?? {}
    const mmsi = str(meta.MMSI ?? body.UserID ?? body.UserId)
    if (!mmsi) return false
    const fixSec = aisEpochSec(meta.time_utc ?? meta.TimeUtc)
    if (fixSec !== null && fixSec > this.feedNewest) this.feedNewest = fixSec

    if (type === 'ShipStaticData' || type === 'StaticDataReport' || type === 'ExtendedClassBPositionReport') {
      this.mergeStatic(mmsi, type, body, meta, nowMs)
      // 靜態報告的 MetaData 會附上最後已知位置，但沒有航速航向、也不是新的定位：
      // 拿它重建船位會把動態洗掉、時間也被改成現在。只合併靜態欄位。
      if (type !== 'ExtendedClassBPositionReport') return true
    }

    const lat = num(body.Latitude ?? meta.latitude ?? meta.Latitude)
    const lng = num(body.Longitude ?? meta.longitude ?? meta.Longitude)
    // 經緯度 91／181 是 AIS 的「沒有位置」
    if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return true

    const st = this.statics.get(mmsi)
    const prev = this.rows.get(mmsi)
    const aton = type === 'AidsToNavigationReport'
    const metaName = cleanName(meta.ShipName)
    const prevName = prev && prev.name !== '(無船名)' ? prev.name : ''
    const row: Row = {
      mmsi,
      name: aton
        ? // 航標名前 20 字在 Name、其餘接在 NameExtension：先接起來再清，免得中間的空白被吃掉
          cleanName(String(body.Name ?? '') + String(body.NameExtension ?? '')) || metaName || `MMSI ${mmsi}`
        : st?.name || prevName || metaName || '(無船名)',
      lat,
      lng,
      cog: aton ? null : cleanCog(body.Cog),
      sog: aton ? null : cleanSog(body.Sog),
      heading: aton ? null : cleanHeading(body.TrueHeading),
      typeCode: aton ? null : (st?.typeCode ?? prev?.typeCode ?? null),
      kind: aton || ATON_MMSI.test(mmsi) ? 'aton' : 'ship',
      atonType: aton ? atonTypeText(body.Type) : prev?.atonType,
      virtual: aton ? body.VirtualAtoN === true : prev?.virtual,
      length: st?.length ?? prev?.length ?? null,
      beam: st?.beam ?? prev?.beam ?? null,
      destination: st?.destination || prev?.destination || '',
      receivedAt: nowMs,
      lagSec: fixSec === null ? 0 : Math.max(0, this.feedNewest - fixSec),
      fixSec,
    }
    this.rows.set(mmsi, row)
    if (!aton) this.addTrackPoint(mmsi, lat, lng, fixSec ?? Math.floor(nowMs / 1000))
    return true
  }

  private mergeStatic(mmsi: string, type: string, body: Record<string, any>, meta: Record<string, any>, nowMs: number) {
    const prev = this.statics.get(mmsi)
    const live = this.rows.get(mmsi)
    // Class B 的靜態資料分 A、B 兩半：A 有船名、B 有船種與尺寸，各自有 Valid
    const f =
      type === 'StaticDataReport'
        ? {
            Name: body.ReportA?.Valid === false ? undefined : body.ReportA?.Name,
            Type: body.ReportB?.Valid === false ? undefined : body.ReportB?.ShipType,
            Dimension: body.ReportB?.Valid === false ? undefined : body.ReportB?.Dimension,
          }
        : body
    const d = dims(f.Dimension)
    const liveName = live && live.name !== '(無船名)' ? live.name : ''
    const s: Static = {
      // 只有真的帶船名的報告才換掉已知的名字（Class B 只帶船種的那一半，MetaData 也會重複舊名）
      name: cleanName(f.Name) || liveName || prev?.name || cleanName(meta.ShipName),
      typeCode: code(f.Type) ?? live?.typeCode ?? prev?.typeCode ?? null,
      destination: str(f.Destination) || live?.destination || prev?.destination || '',
      length: d.length ?? live?.length ?? prev?.length ?? null,
      beam: d.beam ?? live?.beam ?? prev?.beam ?? null,
      at: nowMs,
    }
    this.statics.set(mmsi, s)
    if (live) {
      if (s.name) live.name = s.name
      if (s.typeCode !== null) live.typeCode = s.typeCode
      if (s.destination) live.destination = s.destination
      if (s.length !== null) live.length = s.length
      if (s.beam !== null) live.beam = s.beam
    }
  }

  private addTrackPoint(mmsi: string, lat: number, lng: number, t: number) {
    const tr = this.tracks.get(mmsi)
    const last = tr ? tr.pts[tr.pts.length - 1] : this.pending.get(mmsi)
    if (!last) {
      this.pending.set(mmsi, { lat, lng, t })
      return
    }
    if (t - last.t < TRACK_MIN_GAP_S) return
    if (approxMeters(last.lat, last.lng, lat, lng) < TRACK_MIN_MOVE_M) return
    if (!tr) {
      this.tracks.set(mmsi, { pts: [last, { lat, lng, t }] })
      this.pending.delete(mmsi)
      return
    }
    tr.pts.push({ lat, lng, t })
    if (tr.pts.length > TRACK_SAMPLES) tr.pts.shift()
  }

  /** 某艘船的航跡（舊到新）。 */
  track(mmsi: string): TrackPoint[] {
    return this.tracks.get(mmsi)?.pts.slice() ?? []
  }

  /**
   * 清掉太久沒回報的、框外太遠的，總數超過上限先丟最舊的。
   * box 給了才清框外（跟著地圖視野訂閱，框外的船不會再更新，留著只會變殘影）。
   */
  prune(nowMs: number, box?: BBox): void {
    const cutoff = nowMs - STALE_MS
    for (const [k, r] of this.rows) {
      if (r.receivedAt < cutoff || (box && !inBox(r.lat, r.lng, box, 0.5))) this.drop(k)
    }
    for (const [k, s] of this.statics) if (s.at < cutoff && !this.rows.has(k)) this.statics.delete(k)
    const cutSec = Math.floor(cutoff / 1000)
    for (const [k, p] of this.pending) if (p.t < cutSec && !this.rows.has(k)) this.pending.delete(k)
    if (this.rows.size > MAX_VESSELS) {
      const oldest = [...this.rows.values()].sort((a, b) => a.receivedAt - b.receivedAt)
      for (const r of oldest.slice(0, this.rows.size - MAX_VESSELS)) this.drop(r.mmsi)
    }
  }

  private drop(mmsi: string) {
    this.rows.delete(mmsi)
    this.tracks.delete(mmsi)
    this.pending.delete(mmsi)
  }

  /**
   * 目前的船（框內），附上「多久沒回報」與推算位置。
   * 推算：有航速航向、比 0.5 節快、最後回報 3 分鐘內 → 依航向航速往前推，標 reckoned。
   */
  snapshot(nowMs: number, box?: BBox): Vessel[] {
    const out: Vessel[] = []
    for (const r of this.rows.values()) {
      if (box && !inBox(r.lat, r.lng, box, 0.5)) continue
      const ageSec = Math.max(0, (nowMs - r.receivedAt) / 1000) + r.lagSec
      let lat = r.lat
      let lng = r.lng
      let reckoned = false
      if (r.kind === 'ship' && r.sog !== null && r.cog !== null && r.sog >= RECKON_MIN_KN && ageSec > 1) {
        const dt = Math.min(ageSec, DEAD_RECKON_MAX_S)
        ;[lat, lng] = advance(r.lat, r.lng, r.cog, r.sog, dt)
        reckoned = true
      }
      out.push({
        mmsi: r.mmsi,
        name: r.name,
        lat,
        lng,
        cog: r.cog,
        sog: r.sog,
        heading: r.heading,
        type: r.kind === 'aton' ? (r.atonType ?? ATON_TYPES[0]) : shipTypeText(r.typeCode),
        kind: r.kind,
        ageSec,
        ...(reckoned && { reckoned }),
        length: r.length,
        beam: r.beam,
        ...(r.destination && { destination: r.destination }),
        ...(r.virtual && { virtual: true }),
      })
    }
    return out
  }
}

/** 框內（含邊界 margin 度）。 */
export function inBox(lat: number, lng: number, box: BBox, margin = 0): boolean {
  const [[s, w], [n, e]] = box
  return lat >= s - margin && lat <= n + margin && lng >= w - margin && lng <= e + margin
}

/** 等距長方投影近似距離（公尺）——航跡 25 公尺稀疏化夠用。 */
export function approxMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = (lat2 - lat1) * 111320
  const dLng = (lng2 - lng1) * 111320 * Math.cos(((lat1 + lat2) / 2) * DEG)
  return Math.hypot(dLat, dLng)
}

/** 每度緯度幾公尺：用 1 浬＝1 分緯度（1852×60），跟全 App 的浬換算一致。 */
const M_PER_DEG = 1852 * 60

/** 依航向（度）、航速（節）走 dtSec 秒後的位置。3 分鐘內用平面近似就夠準。 */
export function advance(lat: number, lng: number, cogDeg: number, sogKn: number, dtSec: number): [number, number] {
  const m = sogKn * 1852 / 3600 * dtSec
  const dN = m * Math.cos(cogDeg * DEG)
  const dE = m * Math.sin(cogDeg * DEG)
  const nLat = lat + dN / M_PER_DEG
  const nLng = lng + dE / (M_PER_DEG * Math.max(1e-6, Math.cos(lat * DEG)))
  return [nLat, nLng]
}

/** 畫船頭方向：船艏向優先，沒有就用航向，都沒有就 null（畫成不旋轉的圓點）。 */
export function bowDeg(v: Pick<Vessel, 'heading' | 'cog'>): number | null {
  return v.heading ?? v.cog
}

/** 航速文字：沒回報顯示「—」，不顯示 0 或 102。 */
export function sogText(sog: number | null, digits = 0): string {
  return sog === null ? '—' : sog.toFixed(digits)
}
/** 航向文字（度，取整）；沒回報顯示「—」。 */
export function cogText(cog: number | null): string {
  return cog === null ? '—' : String(Math.round(cog) % 360)
}

/** 鎖定目標後的提示：航向或航速沒回報時講清楚，要使用者手動填（不能偷偷當 0）。 */
export function lockText(prefix: string, v: { name: string; cog: number | null; sog: number | null }): string {
  const miss = [v.cog === null && '航向', v.sog === null && '航速'].filter(Boolean).join('、')
  return miss ? `${prefix}「${v.name}」——這艘船沒回報${miss}，請手動填` : `${prefix}「${v.name}」`
}

/** 「3 分鐘前」這類文字。 */
export function ageText(sec: number): string {
  if (sec < 60) return '剛剛'
  const min = Math.round(sec / 60)
  if (min < 60) return `${min} 分鐘前`
  return `${Math.round(min / 60)} 小時前`
}
