// ── TLE（兩行軌道根數）解析 ────────────────────────────────
//
// celestrak 的 FORMAT=tle 回傳的是「三行一組」：名稱 + 兩行數字。
// 這裡只負責「把文字切成一顆一顆」與「挑出想要的那顆」，
// 實際的軌道推算交給 satellite.js（SGP4）。
//
// 為什麼要自己驗 checksum：上游故障時會回 HTML 錯誤頁、或者截斷到一半，
// 而那些東西餵給 SGP4 不會爆炸，只會算出看起來很正常但完全錯誤的位置。
// 寧可在這裡擋掉說「拿不到」，也不要在地圖上畫一條有自信的錯誤軌跡。

export interface TleRecord {
  name: string
  line1: string
  line2: string
  /** NORAD 編號（從 line1 取）。 */
  noradId: string
}

/**
 * TLE 每行最後一碼是模 10 檢查碼：
 * 前 68 碼的數字相加（減號算 1，其餘非數字算 0）取個位數。
 */
export function tleChecksumOk(line: string): boolean {
  if (line.length < 69) return false
  let sum = 0
  for (let i = 0; i < 68; i++) {
    const c = line[i]
    if (c >= '0' && c <= '9') sum += c.charCodeAt(0) - 48
    else if (c === '-') sum += 1
  }
  const want = line.charCodeAt(68) - 48
  return want >= 0 && want <= 9 && sum % 10 === want
}

/**
 * 把 celestrak 的回傳切成一組一組。
 * 任何一行檢查碼不對就整組丟掉——半筆資料比沒有資料更危險。
 */
export function parseTle(text: string): TleRecord[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.length > 0)

  const out: TleRecord[] = []
  for (let i = 0; i + 2 < lines.length + 1; i++) {
    const a = lines[i]
    const b = lines[i + 1]
    const c = lines[i + 2]
    if (!b || !c) break
    if (!b.startsWith('1 ') || !c.startsWith('2 ')) continue
    if (!tleChecksumOk(b) || !tleChecksumOk(c)) continue
    out.push({
      name: a.trim(),
      line1: b,
      line2: c,
      noradId: b.slice(2, 7).trim(),
    })
    i += 2
  }
  return out
}

/**
 * 依名稱找衛星。比對忽略大小寫與空白差異。
 *
 * 回傳全部符合的（例如 SENTINEL-2 會同時命中 2A/2B）——同一個任務有多顆星，
 * 「下一趟什麼時候」要看全部，只取一顆會漏掉另一顆更早的過境。
 */
export function findByNamePrefix(records: TleRecord[], prefix: string): TleRecord[] {
  const p = prefix.toUpperCase().replace(/\s+/g, '')
  return records.filter((r) => r.name.toUpperCase().replace(/\s+/g, '').startsWith(p))
}
