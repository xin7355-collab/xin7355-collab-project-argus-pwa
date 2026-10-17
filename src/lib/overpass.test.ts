import { test } from 'node:test'
import assert from 'node:assert/strict'
import { swathFit, viewWidthKm } from './overpass.ts'

test('畫面寬度：放大一級寬度減半', () => {
  const a = viewWidthKm(24.5, 7, 420)
  const b = viewWidthKm(24.5, 8, 420)
  assert.ok(Math.abs(a / b - 2) < 1e-6, `zoom +1 應減半，實際比值 ${(a / b).toFixed(4)}`)
})

test('畫面寬度：赤道最寬，高緯度收縮（Web Mercator 的尺度隨緯度變）', () => {
  const eq = viewWidthKm(0, 7, 420)
  const tw = viewWidthKm(24.5, 7, 420)
  const hi = viewWidthKm(60, 7, 420)
  assert.ok(eq > tw && tw > hi, `應遞減：赤道 ${eq.toFixed(0)} > 台灣 ${tw.toFixed(0)} > 高緯 ${hi.toFixed(0)}`)
  // 60 度的 cos 剛好 0.5
  assert.ok(Math.abs(hi / eq - 0.5) < 1e-6, '緯度 60 度應剛好是赤道的一半')
})

test('畫面寬度：手機 420px、zoom 7、台灣緯度 → 數百公里量級', () => {
  const w = viewWidthKm(24.5, 7, 420)
  assert.ok(w > 300 && w < 800, `應在數百公里量級，實際 ${w.toFixed(0)}km`)
})

test('掃幅夠寬：一趟蓋得住，並講出倍數', () => {
  const f = swathFit(2330, 500) // MODIS
  assert.equal(f.coversView, true)
  assert.ok(Math.abs(f.ratio - 4.66) < 0.01)
  assert.match(f.text, /一趟蓋得住/)
  assert.match(f.text, /4\.7 倍/)
})

test('掃幅不夠寬：要講出只蓋得住幾成，不能只說「不行」', () => {
  const f = swathFit(290, 1000) // Sentinel-2 在很廣的畫面下
  assert.equal(f.coversView, false)
  assert.match(f.text, /29%/)
  assert.match(f.text, /拼好幾趟|縮小範圍/)
})

test('剛好等寬算蓋得住（邊界條件）', () => {
  assert.equal(swathFit(290, 290).coversView, true)
})

test('畫面寬度異常時不要回 NaN 或亂講', () => {
  for (const bad of [0, -1, NaN, Infinity]) {
    const f = swathFit(290, bad)
    assert.equal(f.coversView, false)
    assert.equal(f.text, '')
  }
})

test('掃幅文字跟著使用者單位走（專案預設浬，不要印 km）', () => {
  const nm = swathFit(2330, 500)
  assert.match(nm.text, /浬/)
  assert.ok(!/km/.test(nm.text), `預設不該出現 km：${nm.text}`)
  assert.match(swathFit(2330, 500, 'km').text, /km/)
})
