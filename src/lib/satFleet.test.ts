import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assignFleet, FLEET } from './satFleet.ts'
import { SATS } from './overpass.ts'

// 測試資料自己算檢查碼。前兩次手算都算錯（而且 parseTle 正確地把整組丟掉），
// 與其再賭一次，不如讓夾具自己補——要驗檢查碼邏輯本身的在 tle.test.ts。
function ck(l68: string): string {
  let sum = 0
  for (const c of l68) {
    if (c >= '0' && c <= '9') sum += c.charCodeAt(0) - 48
    else if (c === '-') sum += 1
  }
  return l68 + String(sum % 10)
}

/** 造一組名稱不同、NORAD 編號不同的 TLE。 */
function sat(name: string, norad: number): string {
  const id = String(norad).padStart(5, '0')
  const l1 = ck(`1 ${id}U 98067A   24015.50000000  .00016717  00000-0  10270-3 0  900`)
  const l2 = ck(`2 ${id}  51.6416 247.4627 0006703 130.5360 325.0288 15.49514900 1000`)
  return `${name}\n${l1}\n${l2}\n`
}

test('夾具本身要是合法 TLE（否則後面每一條都在驗空集合）', () => {
  const r = assignFleet([sat('SENTINEL-2A', 41001)])
  assert.equal(r.total, 1, '夾具的檢查碼算錯了')
})

test('分配：各衛星拿到自己的 TLE，同任務多顆一起收', () => {
  const r = assignFleet([
    sat('SENTINEL-1A', 39634) + sat('SENTINEL-2A', 40697) + sat('SENTINEL-2B', 42063),
    sat('NOAA 20', 43013) + sat('TERRA', 25994),
  ])
  assert.equal(r.byId.get('s2')?.length, 2, '2A 與 2B 都要收——只取一顆會漏掉更早的那趟')
  assert.equal(r.byId.get('s1')?.length, 1)
  assert.equal(r.byId.get('viirs')?.length, 1)
  assert.equal(r.total, 5)
})

test('一個感測器掛在兩個平台上：兩顆都要收（MODIS 在 Terra 與 Aqua）', () => {
  const r = assignFleet([sat('TERRA', 25994) + sat('AQUA', 27424)])
  assert.equal(r.byId.get('modis')?.length, 2, '只收 Terra 會少算一半的過境機會')
})

test('同一顆被兩個前綴命中時只算一次（否則同一趟會重複出現）', () => {
  // 'NOAA 20' 與 'NOAA 2' 互為字首的情境：用同一顆的編號餵兩次名稱前綴。
  const fleet = [{ id: 'dup', tlePrefix: ['NOAA 20', 'NOAA'] }]
  const r = assignFleet([sat('NOAA 20', 43013)], fleet)
  assert.equal(r.byId.get('dup')?.length, 1)
})

test('找不到的要列進 missing，不能靜悄悄當成「沒有過境」', () => {
  const r = assignFleet([sat('SENTINEL-2A', 40697)])
  assert.equal(r.byId.get('s2')?.length, 1)
  assert.ok(r.missing.includes('s1'), 'celestrak 分組會變動，找不到要講出來')
  assert.ok(r.missing.includes('landsat'))
})

test('整包都拿不到：missing 要是全部，total 為 0', () => {
  const r = assignFleet([])
  assert.equal(r.total, 0)
  assert.equal(r.missing.length, FLEET.length)
  assert.equal(r.byId.size, 0)
})

test('夾雜 HTML 錯誤頁不影響其他群組（部分資料仍然有用）', () => {
  const r = assignFleet(['<html>Service Unavailable</html>', sat('SENTINEL-2A', 40697)])
  assert.equal(r.byId.get('s2')?.length, 1)
  assert.equal(r.total, 1, 'HTML 不該被算成一筆 TLE')
})

test('FLEET 的 id 不可重複（重複會讓 UI 接錯掃幅）', () => {
  assert.equal(new Set(FLEET.map((f) => f.id)).size, FLEET.length)
})

// 這兩份清單是分開維護的：FLEET 管「TLE 裡叫什麼名字」，SATS 管「掃幅/解析度」。
// id 對不起來的話 UI 會拿不到掃幅，過境就算不出來——而且是安靜地算不出來。
test('FLEET 的每個 id 都要在 SATS 裡找得到（掃幅才接得上）', () => {
  const known = new Set(SATS.map((s) => s.id))
  for (const f of FLEET) {
    assert.ok(known.has(f.id), `FLEET 的 ${f.id} 在 overpass.ts 的 SATS 裡沒有對應`)
  }
})
