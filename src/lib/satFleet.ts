import { findByNamePrefix, parseTle, type TleRecord } from './tle.ts'

// ── 取得要盯的那幾顆衛星的軌道根數 ─────────────────────────
//
// TLE 由自家 Worker 的 /api/celestrak/{group} 代抓——celestrak 沒送 CORS 標頭，
// 瀏覽器直連會被擋（見 worker/index.js）。
//
// 群組歸屬刻意不寫死成「這顆一定在那一組」：celestrak 的分組會變動，猜錯
// 就會變成「這顆永遠找不到」而使用者不知道為什麼。改成把需要的群組全抓下來
// 合併搜尋，找不到就誠實說找不到。

/** 本 App 關心的衛星，以及在 TLE 裡的名稱開頭。 */
export interface FleetMember {
  /** 必須對得上 overpass.ts 的 SatDef.id——UI 靠這個把掃幅/解析度接起來。 */
  id: string
  /**
   * TLE 名稱開頭。給陣列是因為同一個「感測器」常常掛在不只一個平台上：
   * MODIS 在 Terra 與 Aqua 上、VIIRS 在 NOAA-20 與 Suomi NPP 上。
   * 只收一顆會少算一半的過境機會。
   */
  tlePrefix: string[]
}

/** 要抓哪些群組。多抓一組的成本只有一次被邊緣快取 6 小時的請求。 */
export const FLEET_GROUPS = ['resource', 'weather'] as const

export const FLEET: FleetMember[] = [
  { id: 's1', tlePrefix: ['SENTINEL-1'] },
  { id: 's2', tlePrefix: ['SENTINEL-2'] },
  { id: 'landsat', tlePrefix: ['LANDSAT'] },
  { id: 'viirs', tlePrefix: ['NOAA 20', 'SUOMI NPP'] },
  { id: 'modis', tlePrefix: ['TERRA', 'AQUA'] },
]

export interface FleetResult {
  /** 每個 id 對應到找得到的 TLE（同任務可能多顆）。 */
  byId: Map<string, TleRecord[]>
  /** 完全找不到的 id——要讓使用者知道是「找不到」而不是「沒有過境」。 */
  missing: string[]
  /** 全部抓到的筆數，用來判斷是不是整包都失敗。 */
  total: number
}

/** 把抓回來的 TLE 文字分配到各衛星。純函式，好測。 */
export function assignFleet(texts: string[], fleet: FleetMember[] = FLEET): FleetResult {
  const all: TleRecord[] = []
  for (const t of texts) all.push(...parseTle(t))

  const byId = new Map<string, TleRecord[]>()
  const missing: string[] = []
  for (const m of fleet) {
    // 多個前綴可能命中同一筆（前綴互為字首時），用 NORAD 編號去重，
    // 否則同一顆會被算成兩趟過境。
    const seen = new Set<string>()
    const hits: TleRecord[] = []
    for (const p of m.tlePrefix) {
      for (const r of findByNamePrefix(all, p)) {
        if (seen.has(r.noradId)) continue
        seen.add(r.noradId)
        hits.push(r)
      }
    }
    if (hits.length) byId.set(m.id, hits)
    else missing.push(m.id)
  }
  return { byId, missing, total: all.length }
}

/** 記憶體快取：同一次開 App 不要重複抓（Worker 那層另外還有 6 小時邊緣快取）。 */
let cache: { at: number; texts: string[] } | null = null
const MEM_TTL_MS = 30 * 60 * 1000

/**
 * 抓所有需要的群組。
 *
 * 一組失敗不影響另一組；全部失敗才丟錯——部分資料仍然有用，
 * 不該因為氣象那組掛了就連 Sentinel 都不給看。
 */
export async function fetchFleetTle(timeoutMs = 15000): Promise<FleetResult> {
  if (cache && Date.now() - cache.at < MEM_TTL_MS) return assignFleet(cache.texts)

  const texts: string[] = []
  const errs: string[] = []
  for (const g of FLEET_GROUPS) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(`/api/celestrak/${g}`, { signal: ctrl.signal })
      if (!res.ok) {
        // Worker 會把上游狀態帶出來，分得出「沒資料」與「被擋」
        const j = await res.json().catch(() => null)
        throw new Error(j?.error || `HTTP ${res.status}`)
      }
      texts.push(await res.text())
    } catch (e) {
      errs.push(`${g}：${e instanceof Error ? e.message : '連線失敗'}`)
    } finally {
      clearTimeout(timer)
    }
  }

  if (texts.length === 0) {
    throw new Error(`取不到軌道根數 — ${errs.join('；')}`)
  }
  cache = { at: Date.now(), texts }
  return assignFleet(texts)
}
