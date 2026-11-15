// ── 搜尋列找船：打船名或 MMSI，直接找畫面上收到的船 ─────────────
//
// 以前搜尋列只查地名，要找某艘船得在地圖上一艘一艘點。
// 船的資料已經在手機上（AIS 收到的），所以邊打字邊比對、不用連網，也不受地名服務每秒一次的限制。
// 參考 gods-eye-view（MIT，見 docs/licenses/gods-eye-view-MIT.txt）src/ui/search 的「同一個框找所有東西」概念。
// 純函式，可離線測。

/** 搜尋需要的船欄位（aisStore 的 Vessel 有這些）。 */
export interface SearchableVessel {
  mmsi: string
  name: string
  kind: 'ship' | 'aton'
  ageSec: number
}

/** aisStore 在還沒收到船名時放的字，不拿來比對（不然打「無」會跑出一堆）。 */
const NO_NAME = '(無船名)'

const norm = (s: string) => s.toUpperCase().replace(/\s+/g, ' ').trim()
const squash = (s: string) => s.toUpperCase().replace(/[\s\-_.]/g, '')

/**
 * 分數越小越前面：0 完全相同、1 開頭相同、2 某個字的開頭、3 中間含有、4 忽略空白後含有。
 * 不相符回 null。
 */
function nameScore(name: string, q: string): number | null {
  if (!name || name === NO_NAME) return null
  const n = norm(name)
  if (n === q) return 0
  if (n.startsWith(q)) return 1
  if (n.split(' ').some((w) => w.startsWith(q))) return 2
  if (n.includes(q)) return 3
  // 「EVERGIVEN」也要找得到「EVER GIVEN」
  const sq = squash(q)
  return sq.length >= 3 && squash(name).includes(sq) ? 4 : null
}

function mmsiScore(mmsi: string, q: string): number | null {
  if (mmsi === q) return 0
  if (mmsi.startsWith(q)) return 1
  return mmsi.includes(q) ? 3 : null
}

/**
 * 依輸入找船，最多回 limit 艘。
 * 太短（中文 1 字、英數 2 字以下）不找——一打就跳出幾百艘沒有意義。
 * 純數字只比 MMSI（3 碼起）；其他比船名。同分時剛回報的排前面，航標排在船後面。
 */
export function matchVessels<V extends SearchableVessel>(vessels: readonly V[], query: string, limit = 6): V[] {
  const q = norm(query)
  const digits = /^\d+$/.test(q)
  const hasCjk = /[⺀-鿿]/.test(q)
  if (digits ? q.length < 3 : q.length < (hasCjk ? 1 : 2)) return []
  const hits: { v: V; s: number }[] = []
  for (const v of vessels) {
    const s = digits ? mmsiScore(v.mmsi, q) : nameScore(v.name, q)
    if (s !== null) hits.push({ v, s: s + (v.kind === 'aton' ? 0.5 : 0) })
  }
  hits.sort((a, b) => a.s - b.s || a.v.ageSec - b.v.ageSec)
  return hits.slice(0, limit).map((h) => h.v)
}
