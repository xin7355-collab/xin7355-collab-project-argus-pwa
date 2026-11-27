// ── 無人機禁限航區：App 端讀資料（本站 /drone/ 的靜態圖磚）─────────────────
//
// 圖層與 🛸 面板共用同一份已載入的圖磚（模組層級的 DroneZoneStore），同一格不重抓。
// 錯誤分三種：還沒準備好（資料還沒同步過，灰色、安靜）、連不上（海上訊號不穩）、伺服器有問題（紅色）。

import {
  cellKey,
  cellsForBbox,
  decodeZone,
  uniqueZones,
  type DroneIndex,
  type DroneTile,
  type DroneZone,
} from './droneZones.ts'

export type DroneErrorKind = 'not_ready' | 'network' | 'server'

export class DroneDataError extends Error {
  readonly kind: DroneErrorKind
  constructor(message: string, kind: DroneErrorKind) {
    super(message)
    this.name = 'DroneDataError'
    this.kind = kind
  }
}

const NOT_READY = '無人機禁限航區資料還沒準備好：每日同步跑過一次、重新部署後就有（GitHub → Actions →「無人機禁限航區資料」→ Run workflow）'

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** 圖層畫完整圖磚的上限（格）：超過就只畫總覽，避免縮小看全台時一次下載好幾 MB。 */
export const MAX_DETAIL_CELLS = 12
/** 索引多久重新問一次有沒有新版（每日同步，6 小時夠了）。 */
const INDEX_TTL_MS = 6 * 3600_000
/** 同時最多抓幾格。 */
const CONCURRENCY = 4

async function getJson(fetchImpl: FetchLike, url: string, signal?: AbortSignal, cache: RequestCache = 'default'): Promise<unknown> {
  let res: Response
  try {
    res = await fetchImpl(url, { signal, cache })
  } catch (e) {
    if (signal?.aborted) throw e
    throw new DroneDataError('連不上本站伺服器，拿不到禁限航區資料（海上訊號不穩時常見），稍後再試', 'network')
  }
  const type = res.headers.get('content-type') ?? ''
  if (res.status === 404 || (res.ok && !type.includes('json'))) throw new DroneDataError(NOT_READY, 'not_ready')
  if (!res.ok) throw new DroneDataError(`禁限航區資料讀取失敗（伺服器回 ${res.status}），稍後再試`, 'server')
  try {
    return await res.json()
  } catch {
    throw new DroneDataError('禁限航區資料格式不對（可能是部署到一半），稍後再試', 'server')
  }
}

function isIndex(v: unknown): v is DroneIndex {
  const o = v as DroneIndex
  return !!o && o.v === 1 && typeof o.version === 'string' && Array.isArray(o.cells) && !!o.source && !!o.counts
}

function isTile(v: unknown): v is DroneTile {
  const o = v as DroneTile
  return !!o && o.v === 1 && Array.isArray(o.zones)
}

export class DroneZoneStore {
  private fetchImpl: FetchLike
  private index: DroneIndex | null = null
  private indexAt = 0
  private indexPending: Promise<DroneIndex> | null = null
  private cellSet = new Set<string>()
  /** 'overview'、'wide' 與各格 → 解開的區域。 */
  private tiles = new Map<string, DroneZone[]>()
  private pending = new Map<string, Promise<DroneZone[]>>()

  private now: () => number

  constructor(fetchImpl: FetchLike = (u, i) => fetch(u, i), now: () => number = () => Date.now()) {
    this.fetchImpl = fetchImpl
    this.now = now
  }

  get currentIndex(): DroneIndex | null {
    return this.index
  }

  /** 讀索引（6 小時內用記住的）。版本變了就把舊圖磚丟掉。 */
  async ensureIndex(signal?: AbortSignal): Promise<DroneIndex> {
    const nowMs = this.now()
    if (this.index && nowMs - this.indexAt < INDEX_TTL_MS) return this.index
    if (this.indexPending) return this.indexPending
    this.indexPending = (async () => {
      try {
        // 索引每次都問伺服器有沒有新版（資料每天可能變）；圖磚網址帶版本號，照一般快取
        const j = await getJson(this.fetchImpl, '/drone/index.json', signal, 'no-cache')
        if (!isIndex(j)) throw new DroneDataError('禁限航區資料格式不對，稍後再試', 'server')
        if (this.index && this.index.version !== j.version) {
          this.tiles.clear()
          this.pending.clear()
        }
        this.index = j
        this.indexAt = nowMs
        this.cellSet = new Set(j.cells)
        return j
      } finally {
        this.indexPending = null
      }
    })()
    return this.indexPending
  }

  private loadTile(name: string, signal?: AbortSignal): Promise<DroneZone[]> {
    const have = this.tiles.get(name)
    if (have) return Promise.resolve(have)
    const p0 = this.pending.get(name)
    if (p0) return p0
    const version = this.index?.version ?? ''
    const p = (async () => {
      try {
        const j = await getJson(this.fetchImpl, `/drone/tiles/${name}.json?v=${encodeURIComponent(version)}`, signal)
        if (!isTile(j)) throw new DroneDataError('禁限航區圖磚格式不對，稍後再試', 'server')
        const zones = j.zones.map(decodeZone)
        // 載入期間版本換了：這份是舊的，不要存
        if ((this.index?.version ?? '') === version) this.tiles.set(name, zones)
        return zones
      } finally {
        this.pending.delete(name)
      }
    })()
    this.pending.set(name, p)
    return p
  }

  /** 一次抓好幾格（同時最多 4 格）。 */
  private async loadMany(names: string[], signal?: AbortSignal): Promise<DroneZone[]> {
    const out: DroneZone[][] = []
    let i = 0
    const worker = async () => {
      while (i < names.length) {
        const n = names[i++]
        out.push(await this.loadTile(n, signal))
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, names.length) }, worker))
    return uniqueZones(out.flat())
  }

  /** 這個範圍有資料的格子（沒資料的格子不抓：大部分海面沒有任何公告）。 */
  cellsIn(bbox: [number, number, number, number]): string[] {
    if (!this.index) return []
    return cellsForBbox(bbox, this.index.cellDeg).filter((c) => this.cellSet.has(c))
  }

  /**
   * 地圖畫面用：格子不多就載完整圖磚，太多（縮得很小）就只載總覽。
   * 回傳 detail=false 時，縣市政府的幾千筆小範圍沒有畫（面板與圖例要講）。
   */
  async zonesForView(bbox: [number, number, number, number], signal?: AbortSignal): Promise<{ zones: DroneZone[]; detail: boolean }> {
    const idx = await this.ensureIndex(signal)
    const allCells = cellsForBbox(bbox, idx.cellDeg)
    if (allCells.length > MAX_DETAIL_CELLS) {
      return { zones: await this.loadMany(['overview'], signal), detail: false }
    }
    const names = allCells.filter((c) => this.cellSet.has(c))
    if (idx.wide > 0) names.push('wide')
    return { zones: names.length ? await this.loadMany(names, signal) : [], detail: true }
  }

  /** 判定一個點用：那一格的完整圖磚＋跨很多格的。 */
  async zonesAt(lat: number, lng: number, signal?: AbortSignal): Promise<DroneZone[]> {
    const idx = await this.ensureIndex(signal)
    const names: string[] = []
    const cell = cellKey(lat, lng, idx.cellDeg)
    if (this.cellSet.has(cell)) names.push(cell)
    if (idx.wide > 0) names.push('wide')
    return names.length ? this.loadMany(names, signal) : []
  }
}

/** App 共用的一份（圖層與面板看到同樣的資料、不重抓）。 */
export const droneStore = new DroneZoneStore()

/** 資料日期的一句話：「民航局圖資 2026-11-27 同步」＋來源。 */
export function sourceText(idx: Pick<DroneIndex, 'source' | 'generatedAt'>): string {
  const day = (idx.source.fetchedAt || idx.generatedAt || '').slice(0, 10)
  const via = idx.source.kind === 'caa' ? '直接從民航局同步' : idx.source.kind === 'mirror' ? '經 GitHub 每日鏡像同步' : '測試資料'
  return `民航局圖資 ${day}（${via}）`
}
