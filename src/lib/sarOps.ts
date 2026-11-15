import { parseTle, type TleRecord } from './tle.ts'
import { passesForPoint } from './satTrack.ts'

// ── 其他雷達衛星：「誰能被下單來拍這片海」 ─────────────────────
//
// Sentinel-1 是固定排程、資料免費，主清單用它真實的側視幾何算（passPlan）。
// 其他雷達衛星（ICEYE、Capella、RCM、COSMO-SkyMed…）多半是「有人付費下單才拍」，
// 衛星可以側擺、左右兩邊都能拍。所以這裡回答的不是「會不會拍到」，而是
// 「這段時間有幾次經過、而且這片海在它側擺得到的範圍內」——要申請影像時才知道找誰、什麼時候。
//
// 側擺範圍各家規格不同、也跟取像模式有關；這裡統一用軌跡兩側約 500 公里的概估
// （多數雷達衛星的可取像範圍落在這附近，沒有逐一查證），畫面上要照實講是概估。

/** 概估：軌跡兩側多遠以內能側擺過去取像（公里）。 */
export const SAR_ACCESS_KM = 500

export interface SarOperator {
  name: string
  /** 衛星在 CelesTrak 裡的名稱規則。 */
  match: RegExp
  /** 一句話：誰的、資料怎麼拿。 */
  note: string
}

export const SAR_OPERATORS: SarOperator[] = [
  { name: 'NISAR', match: /^NISAR/, note: '美國 NASA／印度 ISRO，資料免費公開' },
  { name: 'ICEYE', match: /^ICEYE/, note: '芬蘭商業，付費下單' },
  { name: 'Capella', match: /^CAPELLA/, note: '美國商業，付費下單' },
  { name: 'Umbra', match: /^UMBRA/, note: '美國商業，付費下單' },
  { name: 'RCM', match: /^RCM-/, note: '加拿大政府，有船舶偵測模式' },
  { name: 'RADARSAT-2', match: /^RADARSAT-2/, note: '加拿大（MDA），付費' },
  { name: 'COSMO-SkyMed', match: /^(COSMO-SKYMED|CSG-)/, note: '義大利，付費' },
  { name: 'TerraSAR-X／PAZ', match: /^(TERRASAR|TANDEM|PAZ)/, note: '德國／西班牙，付費' },
  { name: 'ALOS', match: /^ALOS/, note: '日本 JAXA' },
  { name: '高分三號', match: /^GAOFEN-3/, note: '中國' },
  { name: '陸地探測', match: /^LUDI TANCE/, note: '中國' },
  { name: 'SAOCOM', match: /^SAOCOM/, note: '阿根廷' },
  { name: 'KOMPSAT-5', match: /KOMPSAT-5/, note: '韓國' },
  { name: 'iQPS', match: /^QPS-SAR/, note: '日本商業' },
  { name: 'StriX', match: /^STRIX/, note: '日本商業（Synspective）' },
  { name: 'RISAT／EOS-4', match: /^(RISAT|EOS-4)/, note: '印度' },
  { name: 'NovaSAR', match: /^NOVASAR/, note: '英國' },
]

/** Sentinel-1 在主清單用真實幾何算，這裡不重複。 */
const EXCLUDE = /^SENTINEL-1/

export interface SarSummary {
  operator: string
  note: string
  /** 時窗內幾次經過（同一家多顆加總）。 */
  count: number
  /** 最早的幾次：哪顆、什麼時候。 */
  next: { craft: string; ms: number }[]
}

/** 把衛星名分到營運商；認不得的歸「其他」。純函式。 */
export function operatorOf(name: string): SarOperator | null {
  if (EXCLUDE.test(name)) return null
  return SAR_OPERATORS.find((o) => o.match.test(name)) ?? { name: '其他', match: /.*/, note: '其他國家或軍方雷達衛星' }
}

/**
 * 算時窗內各家雷達衛星「側擺得到這裡」的經過次數。
 * yieldEvery：每算幾顆讓出一次主執行緒，手機上按鈕才不會卡住。
 */
export async function sarOpportunities(
  tleText: string,
  lat: number,
  lng: number,
  fromMs: number,
  toMs: number,
  opt: { yieldEvery?: number } = {},
): Promise<SarSummary[]> {
  const recs: TleRecord[] = parseTle(tleText)
  const byOp = new Map<string, SarSummary>()
  let k = 0
  for (const r of recs) {
    const op = operatorOf(r.name)
    if (!op) continue
    const res = passesForPoint(r, lat, lng, SAR_ACCESS_KM * 2, fromMs, toMs, { coarseS: 60, fineS: 20 })
    if (res) {
      const s = byOp.get(op.name) ?? { operator: op.name, note: op.note, count: 0, next: [] }
      for (const p of res.passes) {
        s.count++
        s.next.push({ craft: r.name, ms: p.closestMs })
      }
      byOp.set(op.name, s)
    }
    if (opt.yieldEvery && ++k % opt.yieldEvery === 0) await new Promise((ok) => setTimeout(ok, 0))
  }
  const out = [...byOp.values()].filter((s) => s.count > 0)
  for (const s of out) s.next = s.next.sort((a, b) => a.ms - b.ms).slice(0, 3)
  // 最快有機會的排前面
  return out.sort((a, b) => a.next[0].ms - b.next[0].ms)
}
