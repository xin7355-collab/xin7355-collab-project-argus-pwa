// ── 時間格式化（搜救時間軸/漂流標籤用）─────────────────────

/** epoch → 「M/D HH:mm」。 */
export function fmtClock(epoch: number): string {
  const d = new Date(epoch)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`
}

/** epoch → 「M/D HH時」（地圖標籤用，較短）。 */
export function fmtClockShort(epoch: number): string {
  const d = new Date(epoch)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}時`
}

const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六']

/** epoch → 「M/D 週X」（颱風/預報標籤：日期＋星期）。 */
export function fmtDay(epoch: number): string {
  const d = new Date(epoch)
  return `${d.getMonth() + 1}/${d.getDate()} 週${WEEKDAY[d.getDay()]}`
}

/** epoch → 「M/D(週X) HH時」（含星期與時刻）。 */
export function fmtDayHour(epoch: number): string {
  const d = new Date(epoch)
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAY[d.getDay()]}) ${String(d.getHours()).padStart(2, '0')}時`
}

/**
 * 漂流時刻換算（以 datum=回報/落海時間為基準）：
 * forward=datum + hours；reverse(來源)=datum − hours。
 */
export function driftEpoch(incidentTime: number, hours: number, reverse: boolean): number {
  return incidentTime + (reverse ? -1 : 1) * hours * 3600000
}
