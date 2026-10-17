import { test } from 'node:test'
import assert from 'node:assert/strict'
import { roundNice, chooseScale } from './scaleBar.ts'

test('整數挑法：只會是 1/2/3/5 開頭，而且不超過上限', () => {
  for (const n of [0.7, 1, 1.9, 2.5, 4.9, 7, 12, 37, 99, 120, 5000]) {
    const r = roundNice(n)
    assert.ok(r <= n + 1e-9, `${r} 超過 ${n}`)
    assert.match(String(r), /^(1|2|3|5)0*(\.\d+)?$|^0\.0*(1|2|3|5)$/, `${n} → ${r}`)
  }
})

test('預設用浬（專案規則：距離預設浬，不要印 km）', () => {
  const c = chooseScale(30 * 1852, 'nm')
  assert.ok(c)
  assert.match(c.text, /浬$/)
  assert.equal(c.text, '30 浬')
  assert.ok(c.ratio > 0 && c.ratio <= 1)
})

test('不到 1 浬改用公尺（港內靠泊時沒人唸 0.2 浬）', () => {
  const c = chooseScale(600, 'nm')
  assert.ok(c)
  assert.equal(c.text, '500 m')
})

test('使用者選公里時就用公里', () => {
  assert.equal(chooseScale(45000, 'km')?.text, '30 km')
})

test('異常輸入不畫，不要畫出 NaN 浬', () => {
  for (const bad of [0, -1, NaN, Infinity]) assert.equal(chooseScale(bad, 'nm'), null)
})
