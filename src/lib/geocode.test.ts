import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { geocode, resetGeocodeCache } from './geocode.ts'

beforeEach(() => resetGeocodeCache())

type Reply = { status: number; body: unknown } | 'down'
/** 假的 fetch：依網址決定哪一家回什麼，並記錄打了誰。 */
function fakeFetch(nomi: Reply, pho: Reply) {
  const calls: string[] = []
  const f = (async (input: RequestInfo | URL) => {
    const url = String(input)
    const host = new URL(url).host
    calls.push(host)
    const r = host.startsWith('nominatim') ? nomi : pho
    if (r === 'down') throw new TypeError('Failed to fetch')
    return new Response(JSON.stringify(r.body), { status: r.status })
  }) as typeof fetch
  return { f, calls }
}

const NOMI_KEELUNG = [{ name: '基隆港', lat: '25.1300', lon: '121.7400', addresstype: 'harbour' }]
const PHOTON_KEELUNG = {
  features: [
    { geometry: { coordinates: [121.741, 25.131] }, properties: { name: '基隆港', city: '基隆市', osm_value: 'harbour' } },
    { geometry: { coordinates: [121.5, 25.0] }, properties: { street: '中正路', housenumber: '1號', city: '台北市' } },
  ],
}

test('Nominatim 有結果就用它，不打 Photon', async () => {
  const { f, calls } = fakeFetch({ status: 200, body: NOMI_KEELUNG }, 'down')
  const r = await geocode('基隆港', { fetchImpl: f })
  assert.deepEqual(r, [{ label: '基隆港', lat: 25.13, lng: 121.74, kind: 'harbour' }])
  assert.deepEqual(calls, ['nominatim.openstreetmap.org'])
})

test('Nominatim 限流或連不上 → 改問 Photon；標籤補上城市', async () => {
  for (const nomi of [{ status: 429, body: {} }, 'down'] as Reply[]) {
    resetGeocodeCache()
    const { f, calls } = fakeFetch(nomi, { status: 200, body: PHOTON_KEELUNG })
    const r = await geocode('基隆港', { fetchImpl: f, near: { lat: 25, lng: 121.5 } })
    assert.deepEqual(calls, ['nominatim.openstreetmap.org', 'photon.komoot.io'])
    assert.equal(r[0].label, '基隆港（基隆市）')
    assert.equal(r[1].label, '中正路1號（台北市）')
    assert.equal(r[0].lat, 25.131)
  }
})

test('Nominatim 沒結果 → 問 Photon；兩家都沒有才是真的沒有（回空、不丟錯）', async () => {
  const a = fakeFetch({ status: 200, body: [] }, { status: 200, body: PHOTON_KEELUNG })
  assert.equal((await geocode('基龍港', { fetchImpl: a.f })).length, 2, '打錯字 Photon 常找得到')
  resetGeocodeCache()
  const b = fakeFetch({ status: 200, body: [] }, { status: 200, body: { features: [] } })
  assert.deepEqual(await geocode('不存在的地方', { fetchImpl: b.f }), [])
  resetGeocodeCache()
  const c = fakeFetch({ status: 200, body: [] }, 'down')
  assert.deepEqual(await geocode('不存在的地方', { fetchImpl: c.f }), [], 'Nominatim 已明確說沒有')
})

test('兩家都連不上：丟錯，訊息講原因與可以怎麼做（輸入座標）', async () => {
  const { f } = fakeFetch('down', { status: 503, body: {} })
  await assert.rejects(geocode('基隆港', { fetchImpl: f }), (e: unknown) => {
    const m = (e as Error).message
    return /連不上/.test(m) && /Photon HTTP 503/.test(m) && /25\.13, 121\.74/.test(m)
  })
})

test('快取：找到的留 5 分鐘、找不到的只留 30 秒；連不上不快取', async () => {
  let t = 0
  const now = () => t
  const hit = fakeFetch({ status: 200, body: NOMI_KEELUNG }, 'down')
  await geocode('基隆港', { fetchImpl: hit.f, now })
  t = 4 * 60_000
  await geocode(' 基隆港 ', { fetchImpl: hit.f, now })
  assert.equal(hit.calls.length, 1, '5 分鐘內同一個字（前後空白不算）不再連網')
  t = 6 * 60_000
  await geocode('基隆港', { fetchImpl: hit.f, now })
  assert.equal(hit.calls.length, 2, '過期再查')

  const miss = fakeFetch({ status: 200, body: [] }, { status: 200, body: { features: [] } })
  await geocode('新地名', { fetchImpl: miss.f, now })
  t += 31_000
  await geocode('新地名', { fetchImpl: miss.f, now })
  assert.equal(miss.calls.length, 4, '找不到的 30 秒後就重查（兩家各一次 × 2）')

  const down = fakeFetch('down', 'down')
  await assert.rejects(geocode('離線', { fetchImpl: down.f, now }))
  await assert.rejects(geocode('離線', { fetchImpl: down.f, now }))
  assert.equal(down.calls.length, 4, '失敗不快取，下一次馬上重試')
})

test('快取最多 64 筆，超過丟最舊的', async () => {
  const { f, calls } = fakeFetch({ status: 200, body: NOMI_KEELUNG }, 'down')
  for (let i = 0; i < 65; i++) await geocode(`地名${i}`, { fetchImpl: f })
  assert.equal(calls.length, 65)
  await geocode('地名64', { fetchImpl: f })
  assert.equal(calls.length, 65, '最新的還在')
  await geocode('地名0', { fetchImpl: f })
  assert.equal(calls.length, 66, '最舊的被丟掉，要重查')
})
