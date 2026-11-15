import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  adsbAnchor,
  altText,
  aircraftName,
  emergencyText,
  fetchAdsb,
  normalizeAircraft,
  snapshotMs,
  trimAdsb,
  AdsbError,
} from './adsb.ts'

test('對齊格點：小範圍 0.25°、中 0.5°、大 1°；附近的請求得到同一個鍵', () => {
  assert.deepEqual(adsbAnchor(25.25, 121.75, 20), { lat: 25.25, lon: 121.75, dist: 25 })
  // 同一格裡的兩個中心（各偏約 4 浬）→ 同一個鍵
  assert.deepEqual(adsbAnchor(25.2, 121.7, 20), { lat: 25.25, lon: 121.75, dist: 25 })
  assert.deepEqual(adsbAnchor(25.3, 121.8, 20), { lat: 25.25, lon: 121.75, dist: 25 })
  assert.deepEqual(adsbAnchor(25.13, 121.74, 120), { lat: 25, lon: 121.5, dist: 150 })
  assert.deepEqual(adsbAnchor(25.13, 121.74, 200), { lat: 25, lon: 122, dist: 250 })
})

test('對齊後中心偏了，半徑要把偏移補回去（畫面邊緣才不會漏）', () => {
  // 中心偏 0.12°（約 7 浬）：要求 22 浬 → 22+7 > 25 → 升到 50
  const a = adsbAnchor(25.12, 121.75, 22)
  assert.ok(a)
  assert.equal(a.dist, 50)
  // 剛好在格點上就不用升
  assert.equal(adsbAnchor(25.25, 121.75, 22)?.dist, 25)
})

test('超過上限就用 250；不合法回 null', () => {
  assert.equal(adsbAnchor(25, 121, 900)?.dist, 250)
  assert.equal(adsbAnchor(95, 121, 20), null)
  assert.equal(adsbAnchor(25, 200, 20), null)
  assert.equal(adsbAnchor(25, 121, 0), null)
  assert.equal(adsbAnchor(Number.NaN, 121, 20), null)
  // 極區、換日線附近對齊後不會超出範圍
  assert.deepEqual(adsbAnchor(89.9, 179.9, 300), { lat: 90, lon: 180, dist: 250 })
})

test('Worker 只轉需要的欄位；沒有 hex 的丟掉；格式不對回 null', () => {
  const t = trimAdsb({
    now: 1790000000000,
    total: 2,
    ctime: 1,
    ac: [{ hex: 'abc123', flight: 'CAL123 ', lat: 25, lon: 121, rssi: -20, messages: 9999, nav_modes: ['autopilot'] }, { lat: 1 }, null],
  })
  assert.deepEqual(t, { now: 1790000000000, ac: [{ hex: 'abc123', flight: 'CAL123 ', lat: 25, lon: 121 }] })
  assert.equal(trimAdsb({}), null)
  assert.equal(trimAdsb('<html>'), null)
})

const ac = (o: Record<string, unknown> = {}) => ({
  hex: '899123',
  flight: 'CAL123  ',
  r: 'B-18901',
  t: 'A359',
  category: 'A5',
  alt_baro: 35000,
  gs: 480.4,
  track: 45.2,
  squawk: '2301',
  emergency: 'none',
  lat: 25.1,
  lon: 121.8,
  seen_pos: 2.5,
  type: 'adsb_icao',
  ...o,
})

test('整理飛機：呼號去空白、在地面、軍機旗標、位置太舊的不畫、重複的只留一架', () => {
  const r = normalizeAircraft({
    ac: [
      ac(),
      ac({ hex: '899124', alt_baro: 'ground', flight: undefined, r: 'B-55555' }),
      ac({ hex: 'ae1234', dbFlags: 1, flight: 'RCH123' }),
      ac({ hex: '899125', seen_pos: 75 }),
      ac({ hex: '899126', lat: 91 }),
      ac({ hex: 'zzzzzz' }),
      ac(),
    ],
  })
  assert.ok(r)
  assert.deepEqual(r.map((a) => a.hex), ['899123', '899124', 'ae1234'])
  assert.equal(r[0].callsign, 'CAL123')
  assert.equal(r[0].emergency, null, '"none" 不算緊急')
  assert.equal(r[1].onGround, true)
  assert.equal(r[1].altFt, null)
  assert.equal(aircraftName(r[1]), 'B-55555')
  assert.equal(r[2].military, true)
  assert.equal(r[0].military, false)
  assert.equal(normalizeAircraft({ nope: 1 }), null)
})

test('緊急：詢答碼與緊急欄位任一個有就算；同一件事不講兩次', () => {
  assert.equal(emergencyText({ squawk: '2301', emergency: null }), null)
  assert.equal(emergencyText({ squawk: '7700', emergency: null }), '詢答碼 7700（一般緊急）')
  assert.equal(emergencyText({ squawk: '7700', emergency: 'general' }), '詢答碼 7700（一般緊急）')
  assert.equal(emergencyText({ squawk: '7600', emergency: 'nordo' }), '詢答碼 7600（無線電失效）')
  assert.equal(emergencyText({ squawk: '7500', emergency: 'unlawful' }), '非法干擾（劫機）、詢答碼 7500（劫機）')
  assert.equal(emergencyText({ squawk: '1200', emergency: 'minfuel' }), '燃油不足')
  assert.equal(emergencyText({ squawk: null, emergency: 'weird' }), '緊急（weird）')
})

test('高度：呎為主附公尺；地面；沒給', () => {
  assert.equal(altText({ altFt: 35000, onGround: false }), '35,000 ft（10,668 m）')
  assert.equal(altText({ altFt: null, onGround: true }), '地面')
  assert.equal(altText({ altFt: null, onGround: false }), '—')
})

test('快照時間：毫秒、秒都認得；不合法回 null', () => {
  assert.equal(snapshotMs(1790000000000), 1790000000000)
  assert.equal(snapshotMs(1790000000), 1790000000000)
  assert.equal(snapshotMs(0), null)
  assert.equal(snapshotMs('1790000000'), null)
})

const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  (async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers })) as unknown as typeof fetch

test('抓資料：成功時帶回伺服器算的資料年齡與「舊資料」標記', async () => {
  const s = await fetchAdsb({ lat: 25, lon: 121.5, dist: 50 }, { fetchImpl: reply(200, { now: 1, ac: [{ hex: 'abc123' }] }, { 'x-adsb-age': '7', 'x-adsb-stale': '1' }) })
  assert.equal(s.ac.length, 1)
  assert.equal(s.ageSec, 7)
  assert.equal(s.stale, true)
})

test('抓資料：限流帶回幾秒後再試；伺服器的中文錯誤原樣給使用者；不是 JSON 也講得出原因', async () => {
  await assert.rejects(fetchAdsb({ lat: 25, lon: 121, dist: 50 }, { fetchImpl: reply(429, { error: 'adsb.lol 限流中，稍後再試' }, { 'retry-after': '40' }) }), (e: unknown) => {
    return e instanceof AdsbError && e.status === 429 && e.retryAfterSec === 40 && /限流/.test(e.message)
  })
  await assert.rejects(fetchAdsb({ lat: 25, lon: 121, dist: 50 }, { fetchImpl: reply(502, '<html>bad gateway</html>') }), /伺服器回應 502/)
  await assert.rejects(fetchAdsb({ lat: 25, lon: 121, dist: 50 }, { fetchImpl: reply(200, '<html>SPA</html>') }), /格式不對/)
  const down = (async () => {
    throw new TypeError('Failed to fetch')
  }) as unknown as typeof fetch
  await assert.rejects(fetchAdsb({ lat: 25, lon: 121, dist: 50 }, { fetchImpl: down }), /連不上/)
})
