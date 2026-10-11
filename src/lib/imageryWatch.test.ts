import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCatalogUrl, decideNotify, parseBbox, parseScenes, type Scene } from './imageryWatch.ts'

// ── 範圍解析 ──────────────────────────────────────────────

test('合法範圍解析得出來', () => {
  const b = parseBbox('121.0,23.5,122.5,25.0')
  assert.deepEqual(b, { west: 121, south: 23.5, east: 122.5, north: 25 })
  assert.deepEqual(parseBbox(' 121 , 23.5 , 122.5 , 25 '), b, '前後空白要容忍')
})

test('壞掉的範圍要丟錯，不能默默查一個空範圍（那樣看起來像壞掉卻不報錯）', () => {
  for (const bad of ['', '1,2,3', '1,2,3,4,5', 'a,b,c,d', '121,25,122,23.5', '122,23,121,25']) {
    assert.throws(() => parseBbox(bad), `這個應該被拒絕：${bad}`)
  }
  assert.throws(() => parseBbox('200,23,201,25'), /經度/)
  assert.throws(() => parseBbox('121,-95,122,25'), /緯度/)
})

// ── 查詢網址 ──────────────────────────────────────────────

test('查詢網址帶齊必要參數', () => {
  const u = buildCatalogUrl('Sentinel2', { west: 121, south: 23.5, east: 122.5, north: 25 }, 0, 86400000)
  assert.match(u, /collections\/Sentinel2\/search\.json/)
  assert.match(u, /box=121\.0000%2C23\.5000%2C122\.5000%2C25\.0000/)
  assert.match(u, /startDate=1970-01-01T00%3A00%3A00\.000Z/)
  assert.match(u, /sortOrder=descending/)
})

// ── 解析回傳 ──────────────────────────────────────────────

test('解析正常回傳', () => {
  const s = parseScenes({
    features: [
      { properties: { startDate: '2026-10-10T02:30:00.000Z', cloudCover: 12.4 } },
      { properties: { startDate: '2026-10-09T02:30:00.000Z', cloudCover: 88 } },
    ],
  }, 'Sentinel-2')
  assert.equal(s.length, 2)
  assert.equal(s[0].collection, 'Sentinel-2')
  assert.equal(s[0].cloudPct, 12.4)
  assert.equal(s[0].sensed, Date.parse('2026-10-10T02:30:00.000Z'))
})

test('沒有雲量欄位（雷達）要給 null，不要變成 0 讓人以為是晴天', () => {
  const s = parseScenes({ features: [{ properties: { startDate: '2026-10-10T02:30:00Z' } }] }, 'Sentinel-1')
  assert.equal(s[0].cloudPct, null)
})

test('壞資料一律略過，不炸也不產生假資料', () => {
  for (const bad of [null, undefined, 'x', 42, {}, { features: 'nope' }, { features: [null, 1, {}] }]) {
    assert.deepEqual(parseScenes(bad, 'S'), [], `這筆應該回空陣列：${JSON.stringify(bad)}`)
  }
  // 時間解析不出來的那筆要被丟掉，好的那筆要留著
  const mixed = parseScenes({
    features: [{ properties: { startDate: '壞時間' } }, { properties: { startDate: '2026-10-10T00:00:00Z' } }],
  }, 'S')
  assert.equal(mixed.length, 1)
})

// ── 通知內容：絕對不能洩漏位置 ─────────────────────────────

const scene = (iso: string, coll: string, cloud: number | null = null): Scene =>
  ({ sensed: Date.parse(iso), collection: coll, cloudPct: cloud })

test('沒有新影像就不通知', () => {
  const v = decideNotify([], Date.now())
  assert.equal(v.notify, false)
  assert.equal(v.count, 0)
})

test('有新影像：講得出幾筆、哪些感測器、多久以前', () => {
  const now = Date.parse('2026-10-10T06:00:00Z')
  const v = decideNotify(
    [scene('2026-10-10T03:00:00Z', 'Sentinel-2', 12), scene('2026-10-10T01:00:00Z', 'Sentinel-1')],
    now,
  )
  assert.equal(v.notify, true)
  assert.equal(v.count, 2)
  assert.match(v.body, /Sentinel-2 1 筆/)
  assert.match(v.body, /Sentinel-1 1 筆/)
  assert.match(v.body, /3 小時前/)
  assert.match(v.body, /最少雲 12%/)
})

test('通知內容不得含座標或場景編號（repo 是公開的，通知也會經過第三方）', () => {
  const now = Date.parse('2026-10-10T06:00:00Z')
  const v = decideNotify([scene('2026-10-10T02:30:00Z', 'Sentinel-2', 5)], now)
  const text = v.title + ' ' + v.body
  // 不可出現 Sentinel 磚位編號（T + 2數字 + 3大寫字母）
  assert.doesNotMatch(text, /\bT\d{2}[A-Z]{3}\b/, '不可出現磚位編號')
  // 不可出現看起來像經緯度的數字對
  assert.doesNotMatch(text, /\d{2,3}\.\d+\s*,\s*-?\d{1,2}\.\d+/, '不可出現座標')
  assert.doesNotMatch(text, /[NSEW]\s*\d{2,3}°/, '不可出現度分座標')
  assert.match(text, /開 App/, '要告訴使用者去哪看細節')
})

test('全是雷達（無雲量）時不要硬講雲量', () => {
  const now = Date.parse('2026-10-10T06:00:00Z')
  const v = decideNotify([scene('2026-10-10T05:00:00Z', 'Sentinel-1')], now)
  assert.doesNotMatch(v.body, /雲/, '取不到雲量就不要提雲量')
})

test('時間講法：分鐘/小時/天各自正確', () => {
  const now = Date.parse('2026-10-10T12:00:00Z')
  assert.match(decideNotify([scene('2026-10-10T11:30:00Z', 'S')], now).body, /30 分鐘前/)
  assert.match(decideNotify([scene('2026-10-10T07:00:00Z', 'S')], now).body, /5 小時前/)
  assert.match(decideNotify([scene('2026-10-07T12:00:00Z', 'S')], now).body, /3 天前/)
})
