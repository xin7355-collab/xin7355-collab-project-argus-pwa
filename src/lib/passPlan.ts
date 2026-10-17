import { FLEET, type FleetResult } from './satFleet.ts'
import { passesForPoint, trackFromTle } from './satTrack.ts'
import { SATS, type SatDef } from './overpass.ts'
import type { TrackPoint } from './groundTrack'

// ── 「下一趟會不會拍到我這片海」──────────────────────────
//
// 把三份東西接起來：
//   FLEET（哪顆衛星叫什麼名字）× TLE（它在哪）× SATS（它的掃幅多寬）
// 得到一份「幾點到幾點、哪顆、最近多少浬」的清單。
//
// 設計上最重要的一件事：**「沒有過境」和「算不出來」必須分開**。
// 使用者會拿這個決定要不要派船。把「TLE 抓不到」顯示成一片空白，
// 等於告訴他「這三天沒有衛星會經過」——那是錯的，而且錯得很貴。
// 所以每顆衛星都回報自己的狀態，UI 必須原樣顯示。

export type SatState =
  /** 算得出來，而且有過境。 */
  | 'passes'
  /** 算得出來，這段時間內真的沒有掃到。 */
  | 'none'
  /** TLE 清單裡找不到這顆（celestrak 分組變動／衛星退役）。 */
  | 'noTle'
  /** 有 TLE 但 SGP4 推不動（根數壞掉或已脫軌）。 */
  | 'badTle'

export interface PlannedPass {
  satId: string
  /** 給人看的任務名稱，例如「Sentinel-2」。 */
  satName: string
  /** 實際那顆星在 TLE 裡的名字，例如 SENTINEL-2A——2A 與 2B 是不同趟。 */
  craft: string
  emoji: string
  kind: SatDef['kind']
  resText: string
  swathKm: number
  use: string
  startMs: number
  endMs: number
  /** 這一趟最接近目標的距離（公里）。越接近畫質越好、越不會被掃幅邊緣切掉。 */
  closestKm: number
  closestMs: number
  /** 這一趟所依據的 TLE epoch。離現在越遠越不可信。 */
  epochMs: number
  /** 原始根數。要在地圖上畫這一趟的軌跡時得重算一次，不另外存一大串座標。 */
  line1: string
  line2: string
}

export interface SatStatus {
  satId: string
  satName: string
  emoji: string
  state: SatState
  /** 這顆在時窗內的過境趟數。 */
  count: number
}

export interface PassPlan {
  /** 全部過境，依開始時間排序。 */
  passes: PlannedPass[]
  /** 每顆衛星的狀態，含「找不到」與「推不動」——UI 必須顯示，不可以吃掉。 */
  status: SatStatus[]
  /** 用到的 TLE 裡最舊的 epoch（毫秒）。null 代表一筆都沒用到。 */
  oldestEpochMs: number | null
  windowHours: number
}

export interface PlanOpts {
  /** 往後看幾小時。預設 48——再長 SGP4 誤差開始明顯，而且算很久。 */
  windowHours?: number
  coarseS?: number
  fineS?: number
}

const SAT_BY_ID = new Map(SATS.map((s) => [s.id, s]))

/**
 * 算出時窗內所有會掃到 (lat, lng) 的過境。
 *
 * 純函式（TLE 由呼叫端先抓好），所以離線測得到。
 */
export function planPasses(
  fleet: FleetResult,
  lat: number,
  lng: number,
  fromMs: number,
  opt: PlanOpts = {},
): PassPlan {
  const windowHours = Math.max(1, opt.windowHours ?? 48)
  const toMs = fromMs + windowHours * 3600_000

  const passes: PlannedPass[] = []
  const status: SatStatus[] = []
  let oldestEpochMs: number | null = null

  for (const m of FLEET) {
    const def = SAT_BY_ID.get(m.id)
    // FLEET 與 SATS 對不起來的話沒有掃幅可用，算不出範圍。
    // 有守門測試擋這件事（satFleet.test.ts），真的發生就跳過而不是亂猜。
    if (!def) continue

    const recs = fleet.byId.get(m.id)
    if (!recs || recs.length === 0) {
      status.push({ satId: m.id, satName: def.name, emoji: def.emoji, state: 'noTle', count: 0 })
      continue
    }

    let usable = 0
    let count = 0
    for (const rec of recs) {
      const r = passesForPoint(rec, lat, lng, def.swathKm, fromMs, toMs, {
        coarseS: opt.coarseS,
        fineS: opt.fineS,
      })
      if (!r) continue
      usable++
      if (oldestEpochMs === null || r.epochMs < oldestEpochMs) oldestEpochMs = r.epochMs
      for (const p of r.passes) {
        count++
        passes.push({
          satId: m.id,
          satName: def.name,
          craft: r.name,
          emoji: def.emoji,
          kind: def.kind,
          resText: def.resText,
          swathKm: def.swathKm,
          use: def.use,
          startMs: p.startMs,
          endMs: p.endMs,
          closestKm: p.closestKm,
          closestMs: p.closestMs,
          epochMs: r.epochMs,
          line1: rec.line1,
          line2: rec.line2,
        })
      }
    }

    status.push({
      satId: m.id,
      satName: def.name,
      emoji: def.emoji,
      // 有 TLE 卻一顆都推不動 → 是壞掉，不是沒有過境
      state: usable === 0 ? 'badTle' : count > 0 ? 'passes' : 'none',
      count,
    })
  }

  passes.sort((a, b) => a.startMs - b.startMs)
  return { passes, status, oldestEpochMs, windowHours }
}

/** 每顆衛星只留最早的 n 趟，避免寬掃幅的 VIIRS 把清單洗版。 */
export function topPerSat(passes: PlannedPass[], n = 2): PlannedPass[] {
  const seen = new Map<string, number>()
  const out: PlannedPass[] = []
  for (const p of passes) {
    const c = seen.get(p.satId) ?? 0
    if (c >= n) continue
    seen.set(p.satId, c + 1)
    out.push(p)
  }
  return out
}

/** 一趟過境持續多久，講成人話。 */
export function passDurationText(p: PlannedPass): string {
  const s = Math.round((p.endMs - p.startMs) / 1000)
  if (s < 90) return `約 ${s} 秒`
  return `約 ${Math.round(s / 60)} 分`
}

/**
 * 把一趟過境重算成可以畫在地圖上的軌跡。
 *
 * 前後各留一段（padS），否則畫出來只有掃幅正中間那一小截，
 * 看不出它是從哪個方向飛過來的。
 */
export function passTrack(p: PlannedPass, padS = 300, stepS = 10): TrackPoint[] {
  const t = trackFromTle(
    { name: p.craft, line1: p.line1, line2: p.line2, noradId: '' },
    p.startMs - padS * 1000,
    p.endMs + padS * 1000,
    stepS,
  )
  return t ? t.points : []
}

/** 地圖上要畫的那一趟過境。store 存這個，圖層照著畫。 */
export interface SatPassOverlay {
  /** 唯一識別一趟（同一顆同一時間只會有一趟），用來做「再點一次收起來」。 */
  key: string
  /** 圖例文字，例如「SENTINEL-2A 10/18 10:32」。 */
  label: string
  craft: string
  swathKm: number
  startMs: number
  endMs: number
  closestMs: number
  points: TrackPoint[]
}

/** 一趟過境的唯一鍵。 */
export function passKey(p: PlannedPass): string {
  return `${p.craft}@${p.startMs}`
}

/**
 * 把一趟過境包成地圖疊層。
 *
 * points 為空代表根數重算不出來——呼叫端要當成「畫不出來」處理，
 * 不要放一個空疊層上去讓使用者以為「這趟沒掃到任何地方」。
 */
export function toOverlay(p: PlannedPass, label: string): SatPassOverlay {
  return {
    key: passKey(p),
    label,
    craft: p.craft,
    swathKm: p.swathKm,
    startMs: p.startMs,
    endMs: p.endMs,
    closestMs: p.closestMs,
    points: passTrack(p),
  }
}

/**
 * 這一趟是不是擦邊過。
 *
 * 最接近距離貼近掃幅半寬，代表目標落在掃描帶的最外緣——那裡解析度最差、
 * 幾何變形最大，而且軌道推算本身就有幾公里誤差，很可能根本沒掃到。
 * 使用者要拿這個決定派不派船，邊緣和正中間的意義完全不同，必須標出來。
 */
export function isGrazing(p: PlannedPass, frac = 0.8): boolean {
  return p.closestKm > (p.swathKm / 2) * frac
}
