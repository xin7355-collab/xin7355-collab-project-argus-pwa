// 測試用的 TLE 產生器。
//
// 為什麼獨立一個檔：手算 TLE 的模 10 檢查碼已經錯過兩次（每次 parseTle 都
// 正確地把整組丟掉，反過來證明檢查有效，但也浪費了兩輪）。欄位位置同樣容易
// 數錯一格——TLE 是固定欄寬格式，差一格 SGP4 就讀到別的數字，而且不會報錯。
//
// 所以做法是：拿一組「已知合法」的真實 TLE 當模板，只把要改的欄位整段換掉，
// 再重算檢查碼。這樣欄位位置不可能錯。
//
// 只有測試會用到。放在 src/lib 是因為 npm test 只掃這個目錄。

/** 模 10 檢查碼：前 68 碼的數字相加（減號算 1），取個位數。 */
export function tleChecksum(l68: string): string {
  let sum = 0
  for (const c of l68) {
    if (c >= '0' && c <= '9') sum += c.charCodeAt(0) - 48
    else if (c === '-') sum += 1
  }
  return l68 + String(sum % 10)
}

// ISS 的真實 TLE，只當欄位模板用（欄寬與位置都是對的）。
const T1 = '1 25544U 98067A   24015.50000000  .00000100  00000-0  10270-4 0  9004'
const T2 = '2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.49514900 10008'

export interface TleElements {
  /** NORAD 編號。 */
  satnum: number
  /** 軌道傾角（度）。太陽同步約 98.6，ISS 約 51.6。 */
  inclination: number
  /** 升交點赤經（度）。 */
  raan: number
  /** 離心率（0~1，會寫成 7 位小數點後數字）。 */
  eccentricity?: number
  /** 近地點幅角（度）。 */
  argPerigee?: number
  /** 平近點角（度）。 */
  meanAnomaly?: number
  /** 平均運動（每日圈數）。太陽同步約 14.3，ISS 約 15.5。 */
  meanMotion: number
  /** epoch 的兩位年份。 */
  epochYear?: number
  /** epoch 的日序（含小數）。 */
  epochDay?: number
}

function put(line: string, start: number, end: number, value: string): string {
  const w = end - start
  if (value.length !== w) {
    throw new Error(`欄位 ${start}-${end} 需要 ${w} 碼，給了 ${value.length}：「${value}」`)
  }
  return line.slice(0, start) + value + line.slice(end)
}

/** 造一組欄位位置正確、檢查碼正確的 TLE（名稱 + 兩行）。 */
export function makeTle(name: string, e: TleElements): string {
  const id = String(e.satnum).padStart(5, '0')
  const yy = String(e.epochYear ?? 24).padStart(2, '0')
  const doy = (e.epochDay ?? 15.5).toFixed(8).padStart(12, '0')

  let l1 = T1
  l1 = put(l1, 2, 7, id)
  l1 = put(l1, 18, 20, yy)
  l1 = put(l1, 20, 32, doy)

  let l2 = T2
  l2 = put(l2, 2, 7, id)
  l2 = put(l2, 8, 16, e.inclination.toFixed(4).padStart(8))
  l2 = put(l2, 17, 25, e.raan.toFixed(4).padStart(8))
  l2 = put(l2, 26, 33, Math.round((e.eccentricity ?? 0.0001) * 1e7).toString().padStart(7, '0'))
  l2 = put(l2, 34, 42, (e.argPerigee ?? 90).toFixed(4).padStart(8))
  l2 = put(l2, 43, 51, (e.meanAnomaly ?? 270).toFixed(4).padStart(8))
  l2 = put(l2, 52, 63, e.meanMotion.toFixed(8).padStart(11))

  return `${name}\n${tleChecksum(l1.slice(0, 68))}\n${tleChecksum(l2.slice(0, 68))}\n`
}

/** epoch 欄位對應的毫秒時間（UTC）。 */
export function fixtureEpochMs(e: TleElements): number {
  const yy = e.epochYear ?? 24
  const doy = e.epochDay ?? 15.5
  return Date.UTC(yy < 57 ? 2000 + yy : 1900 + yy, 0, 1) + (doy - 1) * 86400000
}
