import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  OVERPASS_ENDPOINTS,
  OverpassError,
  bodyProblem,
  cooldownMs,
  overpassQuery,
  parseRetryAfter,
  resetOverpassCooldowns,
} from './overpassClient.ts'

beforeEach(() => resetOverpassCooldowns())

type Reply = { status: number; body: string; headers?: Record<string, string> } | 'network' | 'hang'
/** 依鏡像回應劇本；記下打了哪幾台。 */
function fakeFetch(script: Record<number, Reply>, hits: number[]) {
  return (async (url: string, init?: RequestInit) => {
    const i = OVERPASS_ENDPOINTS.indexOf(String(url))
    hits.push(i)
    const r = script[i] ?? { status: 200, body: '{"elements":[]}' }
    if (r === 'network') throw new TypeError('Failed to fetch')
    if (r === 'hang') {
      return new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
    }
    return new Response(r.body, { status: r.status, headers: r.headers })
  }) as unknown as typeof fetch
}
const OK = (n: number) => ({ status: 200, body: JSON.stringify({ elements: Array.from({ length: n }, (_, i) => ({ type: 'way', id: i })) }) })

test('第一台限流、第二台成功：拿第二台的資料；之後第一台冷卻中不再去撞', async () => {
  let t = 1_000_000
  const hits: number[] = []
  const f = fakeFetch({ 0: { status: 429, body: 'rate_limited', headers: { 'retry-after': '120' } }, 1: OK(3) }, hits)
  const els = await overpassQuery('q', { fetchImpl: f, now: () => t })
  assert.equal(els.length, 3)
  assert.deepEqual(hits, [0, 1])
  hits.length = 0
  t += 60_000
  await overpassQuery('q', { fetchImpl: f, now: () => t })
  assert.deepEqual(hits, [1], '冷卻（120 秒）還沒過，跳過第一台')
  hits.length = 0
  t += 61_000
  await overpassQuery('q', { fetchImpl: fakeFetch({ 0: OK(1) }, hits), now: () => t })
  assert.deepEqual(hits, [0], '冷卻過了又會先試第一台')
})

test('HTTP 200 但內容是錯誤（remark: runtime error）：當成失敗、換下一台', async () => {
  const hits: number[] = []
  const f = fakeFetch({ 0: { status: 200, body: '{"elements":[],"remark":"runtime error: Query timed out in \\"query\\" at line 1"}' }, 1: OK(2) }, hits)
  assert.equal((await overpassQuery('q', { fetchImpl: f })).length, 2)
  assert.deepEqual(hits, [0, 1])
})

test('真的沒有資料（空陣列）就回空陣列，不會再去問別台', async () => {
  const hits: number[] = []
  assert.deepEqual(await overpassQuery('q', { fetchImpl: fakeFetch({ 0: OK(0) }, hits) }), [])
  assert.deepEqual(hits, [0])
})

test('全部失敗：丟錯，而且講清楚「這不代表沒有資料」（以前回空陣列，畫面說此區無資料）', async () => {
  const f = fakeFetch({ 0: 'network', 1: { status: 504, body: 'gateway' }, 2: { status: 200, body: '<html>error</html>' } }, [])
  await assert.rejects(overpassQuery('q', { fetchImpl: f }), (e: unknown) => {
    assert.ok(e instanceof OverpassError)
    assert.match(e.message, /不代表這裡沒有資料/)
    assert.equal(e.reasons.length, 3)
    return true
  })
})

test('逾時算失敗並換下一台', async () => {
  const hits: number[] = []
  const els = await overpassQuery('q', { fetchImpl: fakeFetch({ 0: 'hang', 1: OK(1) }, hits), timeoutMs: 20 })
  assert.equal(els.length, 1)
  assert.deepEqual(hits, [0, 1])
})

test('呼叫端取消（圖層關掉）不算鏡像的錯、不記冷卻', async () => {
  const ctrl = new AbortController()
  const hits: number[] = []
  const p = overpassQuery('q', { fetchImpl: fakeFetch({ 0: 'hang' }, hits), signal: ctrl.signal })
  setTimeout(() => ctrl.abort(), 10)
  await assert.rejects(p, (e: unknown) => e instanceof DOMException && e.name === 'AbortError')
  hits.length = 0
  await overpassQuery('q', { fetchImpl: fakeFetch({ 0: OK(1) }, hits) })
  assert.deepEqual(hits, [0], '第一台沒有被冷卻')
})

test('冷卻時間：有 Retry-After 照它（至少 1 秒），沒有就 30 秒起跳加倍、最多 5 分鐘', () => {
  assert.equal(cooldownMs(1, 120_000), 120_000)
  assert.equal(cooldownMs(1, 0), 1000)
  assert.equal(cooldownMs(1, null), 60_000)
  assert.equal(cooldownMs(2, null), 120_000)
  assert.equal(cooldownMs(9, null), 300_000)
  assert.equal(parseRetryAfter('30', 0), 30_000)
  assert.equal(parseRetryAfter('Sun, 15 Nov 2026 12:00:30 GMT', Date.parse('Sun, 15 Nov 2026 12:00:00 GMT')), 30_000)
  assert.equal(parseRetryAfter('garbage', 0), null)
})

test('認得各種「看起來成功其實不是」的回應', () => {
  assert.equal(bodyProblem('{"elements":[]}'), null)
  assert.match(bodyProblem('{"elements":[],"remark":"runtime error: out of memory"}')!, /忙/)
  assert.equal(bodyProblem('Error: rate_limited'), '限流')
  assert.match(bodyProblem('<html>502</html>')!, /錯誤頁/)
  assert.match(bodyProblem('{"foo":1}')!, /格式/)
})

test('三台都在冷卻時，錯誤講多久後會再試（不是只說「冷卻中」）', async () => {
  const t = 5_000_000
  const f = fakeFetch({ 0: 'network', 1: 'network', 2: 'network' }, [])
  await assert.rejects(overpassQuery('q', { fetchImpl: f, now: () => t }))
  await assert.rejects(overpassQuery('q', { fetchImpl: f, now: () => t + 10_000 }), (e: unknown) => {
    assert.ok(e instanceof OverpassError)
    assert.match(e.message, /三台剛剛都失敗過，約 50 秒後會再試/)
    return true
  })
})
