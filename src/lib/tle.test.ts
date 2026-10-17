import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findByNamePrefix, parseTle, tleChecksumOk } from './tle.ts'

// 一組「格式自洽」的 TLE：檢查碼算得出來，但不是真實的軌道資料，
// 只用來驗解析流程。（第一版我隨手捏的檢查碼是錯的，被自己的驗證擋下來——
// 那正好證明這個檢查有在做事。）
const ISS_L1 = '1 25544U 98067A   24001.50000000  .00016717  00000-0  10270-3 0  9009'
const ISS_L2 = '2 25544  51.6400 208.9163 0002571  70.4612 289.6650 15.49309239 10004'

test('檢查碼：正確的要過', () => {
  assert.equal(tleChecksumOk(ISS_L1), true)
  assert.equal(tleChecksumOk(ISS_L2), true)
})

test('檢查碼：改一個數字就要被抓出來（傳輸截斷/竄改）', () => {
  const broken = ISS_L1.slice(0, 20) + '9' + ISS_L1.slice(21)
  assert.equal(tleChecksumOk(broken), false)
})

test('檢查碼：太短的行一律不過（截斷）', () => {
  assert.equal(tleChecksumOk('1 25544U'), false)
  assert.equal(tleChecksumOk(''), false)
})

test('解析三行一組', () => {
  const r = parseTle(`ISS (ZARYA)\n${ISS_L1}\n${ISS_L2}\n`)
  assert.equal(r.length, 1)
  assert.equal(r[0].name, 'ISS (ZARYA)')
  assert.equal(r[0].noradId, '25544')
  assert.equal(r[0].line1, ISS_L1)
})

test('多顆衛星連續排列都要解析得出來', () => {
  const text = `ISS (ZARYA)\n${ISS_L1}\n${ISS_L2}\nISS (ZARYA)\n${ISS_L1}\n${ISS_L2}\n`
  assert.equal(parseTle(text).length, 2)
})

test('HTML 錯誤頁要解析成空陣列，不能當成軌道根數', () => {
  // celestrak 故障時會回 HTML 而且仍然是 200。這種東西餵給 SGP4 不會爆炸，
  // 只會算出看起來正常但完全錯誤的位置——那比拿不到資料危險得多。
  const html = '<!DOCTYPE html>\n<html><body>Service Unavailable</body></html>'
  assert.deepEqual(parseTle(html), [])
})

test('檢查碼錯的那一組要整組丟掉，不是帶壞資料往下走', () => {
  const bad = ISS_L2.slice(0, 30) + '0' + ISS_L2.slice(31)
  assert.deepEqual(parseTle(`SAT\n${ISS_L1}\n${bad}\n`), [])
})

test('截斷到一半（只有第一行）不能炸', () => {
  assert.deepEqual(parseTle(`SAT\n${ISS_L1}\n`), [])
  assert.deepEqual(parseTle(''), [])
  assert.deepEqual(parseTle('SAT\n'), [])
})

test('依名稱找：忽略大小寫與空白，且會回傳同任務的多顆星', () => {
  const text =
    `SENTINEL-2A\n${ISS_L1}\n${ISS_L2}\n` +
    `SENTINEL-2B\n${ISS_L1}\n${ISS_L2}\n` +
    `LANDSAT 9\n${ISS_L1}\n${ISS_L2}\n`
  const recs = parseTle(text)
  assert.equal(recs.length, 3)
  const s2 = findByNamePrefix(recs, 'sentinel-2')
  assert.equal(s2.length, 2, '同任務兩顆星都要回傳——只取一顆會漏掉更早的那趟')
  assert.deepEqual(s2.map((r) => r.name), ['SENTINEL-2A', 'SENTINEL-2B'])
  assert.equal(findByNamePrefix(recs, 'LANDSAT9').length, 1, '空白差異要忽略')
  assert.equal(findByNamePrefix(recs, 'NOPE').length, 0)
})
