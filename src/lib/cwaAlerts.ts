// ── CWA 天氣警特報 W-C0033-002（目前各縣市天氣警特報）──────────
//
// 透過既有 Worker 代理呼叫 CWA Open Data，取「目前正在生效」的天氣警特報
// （濃霧、強風、大雨、豪雨、長浪、雷雨…）。對海上：強風/濃霧/長浪/大雨直接
// 影響出勤與海面能見度。防禦性遞迴解析：欄位對不上就回 null，UI 自動不顯示。

import { fetchCwaJson } from './cwa'

export interface CwaAlert {
  /** 現象：濃霧 / 大雨 / 強風 / 長浪… */
  phenomena: string
  /** 等級：特報 / 警報。 */
  significance: string
  /** 影響縣市／海域。 */
  areas: string[]
  /** 是否與海上/沿海作業直接相關（排序/標色用）。 */
  sea: boolean
}

// 海上關注（海面能見度/風浪/登陸）：這些現象標為「海上相關」排前面。
const SEA_RE = /海|港|濃霧|霧|強風|陣風|長浪|大浪|風浪|雷雨|豪雨|大雨|低溫|寒/

/**
 * 取目前生效的天氣警特報清單（依海上相關優先）。
 * 回 null＝連不上或無資料；回 []＝已連上但目前無警特報。
 */
export async function fetchCwaAlerts(): Promise<CwaAlert[] | null> {
  let data: any
  try {
    data = await fetchCwaJson('W-C0033-002')
  } catch {
    return null
  }
  try {
    // 遞迴走訪，沿途記住最近的 locationName 當作「影響地區」，
    // 遇到 phenomena 節點就記一筆（相容大小寫命名）。
    const found: { phenomena: string; significance: string; location: string }[] = []
    const walk = (node: any, curLoc: string) => {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) {
        for (const x of node) walk(x, curLoc)
        return
      }
      const locRaw = node.locationName ?? node.LocationName ?? node.countyName ?? node.CountyName
      const nextLoc = typeof locRaw === 'string' && locRaw.trim() ? locRaw.trim() : curLoc
      const ph = node.phenomena ?? node.Phenomena
      if (typeof ph === 'string' && ph.trim()) {
        const sig = String(node.significance ?? node.Significance ?? '').trim()
        found.push({ phenomena: ph.trim(), significance: sig, location: nextLoc })
      }
      for (const k in node) walk(node[k], nextLoc)
    }
    walk(data?.records ?? data, '')
    if (!found.length) return null

    // 聚合：同一「現象＋等級」合併影響地區。
    const map = new Map<string, CwaAlert>()
    for (const f of found) {
      const key = `${f.phenomena}｜${f.significance}`
      let a = map.get(key)
      if (!a) {
        a = { phenomena: f.phenomena, significance: f.significance, areas: [], sea: SEA_RE.test(f.phenomena) }
        map.set(key, a)
      }
      if (f.location && !a.areas.includes(f.location)) a.areas.push(f.location)
    }
    // 海上相關排前面；其餘維持出現順序。
    return [...map.values()].sort((a, b) => Number(b.sea) - Number(a.sea))
  } catch {
    return null
  }
}
