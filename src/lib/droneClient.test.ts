import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DroneDataError, DroneZoneStore, MAX_DETAIL_CELLS, sourceText } from './droneClient.ts'
import { encodeZone, polysBbox, type DroneIndex, type DroneZone } from './droneZones.ts'

const sq = (lat: number, lng: number, d = 0.01): number[][][][] => [[[[lng - d, lat - d], [lng + d, lat - d], [lng + d, lat + d], [lng - d, lat + d], [lng - d, lat - d]]]]
const z = (id: string, lat: number, lng: number): DroneZone => {
  const polys = sq(lat, lng)
  return { id, layer: 'airspace', level: 'no', kind: '測試', name: id, bbox: polysBbox(polys), polys }
}

const INDEX: DroneIndex = {
  v: 1,
  version: 'abc123',
  generatedAt: '2026-11-27T00:00:00Z',
  source: { kind: 'caa', fetchedAt: '2026-11-27T00:00:00Z' },
  counts: { airspace: 2 },
  cellDeg: 0.5,
  cells: ['50_242', '50_243'],
  wide: 1,
  overview: 1,
}
const TILES: Record<string, DroneZone[]> = {
  '50_242': [z('a', 25.1, 121.2)],
  '50_243': [z('b', 25.1, 121.6)],
  wide: [z('w', 11, 115)],
  overview: [z('o', 25.08, 121.23)],
}

const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function fakeServer(over: Partial<Record<string, () => Response | Promise<Response>>> = {}) {
  const calls: string[] = []
  const fetchImpl = async (url: string) => {
    calls.push(url)
    const path = url.split('?')[0]
    if (over[path]) return over[path]!()
    if (path === '/drone/index.json') return jsonRes(INDEX)
    const m = path.match(/^\/drone\/tiles\/(.+)\.json$/)
    if (m && TILES[m[1]]) return jsonRes({ v: 1, cell: m[1], zones: TILES[m[1]].map(encodeZone) })
    return jsonRes({ error: 'x', code: 'not_ready' }, 404)
  }
  return { fetchImpl, calls }
}

const kindOf = async (p: Promise<unknown>) => {
  try {
    await p
    return 'ok'
  } catch (e) {
    return e instanceof DroneDataError ? e.kind : 'other'
  }
}

test('索引：缺檔 404、SPA 回了 HTML → 還沒準備好；連不上 → network；500、格式不對 → server', async () => {
  const notReady = fakeServer({ '/drone/index.json': () => jsonRes({ code: 'not_ready' }, 404) })
  assert.equal(await kindOf(new DroneZoneStore(notReady.fetchImpl).ensureIndex()), 'not_ready')
  const html = fakeServer({ '/drone/index.json': () => new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } }) })
  assert.equal(await kindOf(new DroneZoneStore(html.fetchImpl).ensureIndex()), 'not_ready')
  const down = async () => {
    throw new TypeError('Failed to fetch')
  }
  assert.equal(await kindOf(new DroneZoneStore(down).ensureIndex()), 'network')
  const err = fakeServer({ '/drone/index.json': () => jsonRes({}, 500) })
  assert.equal(await kindOf(new DroneZoneStore(err.fetchImpl).ensureIndex()), 'server')
  const bad = fakeServer({ '/drone/index.json': () => jsonRes({ v: 2 }) })
  assert.equal(await kindOf(new DroneZoneStore(bad.fetchImpl).ensureIndex()), 'server')
})

test('點判定：只抓那一格＋wide；同時問同一格只抓一次；沒資料的格子不抓', async () => {
  const srv = fakeServer()
  const st = new DroneZoneStore(srv.fetchImpl)
  const [a, b] = await Promise.all([st.zonesAt(25.1, 121.2), st.zonesAt(25.12, 121.21)])
  assert.deepEqual(a.map((x) => x.id).sort(), ['a', 'w'])
  assert.deepEqual(b.map((x) => x.id).sort(), ['a', 'w'])
  assert.equal(srv.calls.filter((c) => c.startsWith('/drone/tiles/50_242.json')).length, 1)
  assert.equal(srv.calls.filter((c) => c.startsWith('/drone/index.json')).length, 1)
  assert.ok(srv.calls.some((c) => c === '/drone/tiles/50_242.json?v=abc123'), '圖磚網址帶版本號')
  const before = srv.calls.length
  const sea = await st.zonesAt(24.0, 123.0) // 這格沒有資料
  assert.deepEqual(sea.map((x) => x.id), ['w'])
  assert.equal(srv.calls.length, before, '沒資料的格子不打伺服器，wide 已經有了')
})

test('地圖畫面：格子少載完整圖磚；縮很小只載總覽（detail=false）', async () => {
  const srv = fakeServer()
  const st = new DroneZoneStore(srv.fetchImpl)
  const near = await st.zonesForView([121.1, 25.01, 121.7, 25.2])
  assert.equal(near.detail, true)
  assert.deepEqual(near.zones.map((x) => x.id).sort(), ['a', 'b', 'w'])
  const wide = await st.zonesForView([119, 21.5, 123, 26])
  assert.ok((4 / 0.5 + 1) * (4.5 / 0.5 + 1) > MAX_DETAIL_CELLS)
  assert.equal(wide.detail, false)
  assert.deepEqual(wide.zones.map((x) => x.id), ['o'])
})

test('版本換了：舊圖磚丟掉重抓', async () => {
  let version = 'v1'
  const srv = fakeServer({ '/drone/index.json': () => jsonRes({ ...INDEX, version }) })
  let clock = Date.parse('2026-11-27T00:00:00Z')
  const st = new DroneZoneStore(srv.fetchImpl, () => clock)
  await st.ensureIndex()
  await st.zonesAt(25.1, 121.2)
  version = 'v2'
  clock += 60_000
  await st.ensureIndex() // 6 小時內不重問
  assert.equal(st.currentIndex!.version, 'v1')
  clock += 7 * 3600_000
  await st.ensureIndex()
  assert.equal(st.currentIndex!.version, 'v2')
  await st.zonesAt(25.1, 121.2)
  assert.ok(srv.calls.includes('/drone/tiles/50_242.json?v=v2'))
})

test('資料日期文字', () => {
  assert.equal(sourceText(INDEX), '民航局圖資 2026-11-27（直接從民航局同步）')
  assert.equal(sourceText({ ...INDEX, source: { kind: 'mirror', tag: 'v1', fetchedAt: '2026-11-26T16:10:00Z' } }), '民航局圖資 2026-11-26（經 GitHub 每日鏡像同步）')
})
