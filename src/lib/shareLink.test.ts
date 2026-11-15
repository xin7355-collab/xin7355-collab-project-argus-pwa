import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildShareUrl, parseShareHash } from './shareLink.ts'

const ALLOWED = { modes: ['basic', 'ais', 'optical'], bases: ['street', 'hybrid'] }

test('來回：組出來的連結讀得回同樣的位置、模式、船、底圖', () => {
  const url = buildShareUrl('https://argus-app.xin7355.workers.dev/', { lat: 25.123456, lng: 121.765432, zoom: 11.4, mode: 'ais', mmsi: '416000001', base: 'hybrid' })
  assert.equal(url, 'https://argus-app.xin7355.workers.dev/#v=1&c=25.12346%2C121.76543%2C11&m=ais&s=416000001&b=hybrid')
  assert.deepEqual(parseShareHash(new URL(url).hash, ALLOWED), { lat: 25.12346, lng: 121.76543, zoom: 11, mode: 'ais', mmsi: '416000001', base: 'hybrid' })
})

test('只換掉 # 與 ?，保留子路徑', () => {
  assert.equal(
    buildShareUrl('https://example.org/argus/?debug=1#v=1&c=1,2,3', { lat: 1, lng: 2, zoom: 3 }),
    'https://example.org/argus/#v=1&c=1.00000%2C2.00000%2C3',
  )
})

test('只有位置也可以', () => {
  assert.deepEqual(parseShareHash('#v=1&c=24,121,8', ALLOWED), { lat: 24, lng: 121, zoom: 8 })
})

test('任何一項不合法就整個不採用（不要只套一半）', () => {
  assert.equal(parseShareHash('', ALLOWED), null)
  assert.equal(parseShareHash('#v=2&c=24,121,8', ALLOWED), null, '不認得的版本')
  assert.equal(parseShareHash('#v=1&c=95,121,8', ALLOWED), null, '緯度超出範圍')
  assert.equal(parseShareHash('#v=1&c=24,121', ALLOWED), null)
  assert.equal(parseShareHash('#v=1&c=24,121,30', ALLOWED), null, '縮放超出範圍')
  assert.equal(parseShareHash('#v=1&c=24,121,8&m=hack', ALLOWED), null, 'App 沒有的模式')
  assert.equal(parseShareHash('#v=1&c=24,121,8&s=12345', ALLOWED), null, 'MMSI 不是 9 碼')
  assert.equal(parseShareHash('#v=1&c=24,121,8&b=evil', ALLOWED), null, 'App 沒有的底圖')
  assert.equal(parseShareHash('#v=1&c=a,b,c', ALLOWED), null)
})
