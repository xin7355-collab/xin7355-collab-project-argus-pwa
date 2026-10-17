import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  chooseRoute,
  diagnose,
  frameText,
  isPositionMessage,
  keyTestVerdict,
  runKeyTest,
  type AisRoute,
  type ConnAttempt,
  type ProbeSocket,
} from './aisRoute.ts'

const a = (route: 'relay' | 'direct', opened: boolean, aliveMs: number | null, msgs = 0): ConnAttempt => ({
  route, opened, aliveMs, msgs, code: 1006, reason: '',
})

test('先走本站轉接；測試金鑰測出哪條通就從那條開始', () => {
  assert.equal(chooseRoute([]), 'relay')
  assert.equal(chooseRoute([], 'direct'), 'direct')
})

test('轉接連續兩次都沒收到東西 → 換直連；直連也兩次失敗 → 換回轉接', () => {
  assert.equal(chooseRoute([a('relay', false, null)]), 'relay', '一次可能只是網路抖動')
  assert.equal(chooseRoute([a('relay', false, null), a('relay', true, 900)]), 'direct')
  assert.equal(chooseRoute([a('relay', false, null), a('relay', false, null), a('direct', false, null), a('direct', true, 800)]), 'relay')
})

test('哪條路收過資料就一直用它', () => {
  assert.equal(chooseRoute([a('direct', true, 60000, 30), a('relay', false, null), a('relay', false, null)]), 'direct')
})

test('診斷：只在轉接上秒斷 → 先換直連確認，不急著怪金鑰（可能是轉接被擋）', () => {
  const d = diagnose([a('relay', true, 1100), a('relay', true, 1200)])
  assert.equal(d.verdict, 'pending')
  assert.match(d.text, /換另一條路線/)
})

test('診斷：兩條路都秒斷 → 金鑰無效', () => {
  assert.equal(diagnose([a('relay', true, 1100), a('relay', true, 1200), a('direct', true, 900)]).verdict, 'badKey')
})

test('診斷：轉接秒斷、直連根本連不上 → 也判金鑰（兩條都試過了）', () => {
  assert.equal(diagnose([a('relay', true, 1100), a('relay', true, 1200), a('direct', false, null)]).verdict, 'badKey')
})

test('診斷：握手全失敗 → 連不到', () => {
  assert.equal(diagnose([a('relay', false, null), a('relay', false, null), a('direct', false, null)]).verdict, 'unreachable')
})

test('診斷：連得上、活很久、一筆都沒有 → 這片海沒資料（不能誤判成金鑰壞）', () => {
  const d = diagnose([a('relay', true, 300000), a('relay', true, 300000)])
  assert.equal(d.verdict, 'silent')
  assert.match(d.text, /接收站/)
})

test('診斷：收到過資料就是正常', () => {
  assert.equal(diagnose([a('relay', true, 1000), a('direct', true, 90000, 12)]).verdict, 'ok')
})

test('診斷：一條連線活了很久都沒資料 → 一次就能說是這片海沒資料', () => {
  assert.equal(diagnose([a('relay', true, 15000)]).verdict, 'silent')
})

test('只有一次紀錄時不要急著下結論', () => {
  assert.equal(diagnose([a('relay', true, 900)]).verdict, 'pending')
})

test('測試金鑰的結論', () => {
  assert.match(keyTestVerdict(40, true), /金鑰有效/)
  assert.match(keyTestVerdict(0, true), /金鑰多半無效/)
  assert.match(keyTestVerdict(0, false), /連不上/)
  assert.match(keyTestVerdict(0, true, 'Api Key Is Not Valid'), /Api Key Is Not Valid/)
})

test('二進位幀（瀏覽器收到 ArrayBuffer）也要讀得懂', () => {
  const json = '{"MessageType":"PositionReport","MetaData":{"MMSI":1}}'
  const buf = new TextEncoder().encode(json)
  assert.equal(frameText(buf.buffer), json)
  assert.equal(frameText(buf), json)
  assert.equal(isPositionMessage(buf.buffer), true)
  assert.equal(frameText(null), '')
})

test('只有船位訊息算「收到資料」，錯誤訊息不算', () => {
  assert.equal(isPositionMessage('{"MessageType":"PositionReport","MetaData":{"MMSI":1}}'), true)
  assert.equal(isPositionMessage('{"error":"Api Key Is Not Valid"}'), false)
  assert.equal(isPositionMessage('not json'), false)
})

// 假 socket：依劇本決定握手成不成功、送幾筆、多快斷。
type Script = { open: boolean; msgs?: string[]; closeAfterMs?: number }
function fakeFactory(scripts: Record<AisRoute, Script>, log: AisRoute[]) {
  return (route: AisRoute): ProbeSocket => {
    log.push(route)
    const sc = scripts[route]
    const s: ProbeSocket = {
      onopen: null, onmessage: null, onclose: null, onerror: null,
      send: () => {
        for (const m of sc.msgs ?? []) setTimeout(() => s.onmessage?.({ data: m }), 1)
        if (sc.closeAfterMs !== undefined) setTimeout(() => s.onclose?.({ code: 1006, reason: '' }), sc.closeAfterMs)
      },
      close: () => {},
    }
    if (sc.open) setTimeout(() => s.onopen?.({}), 1)
    else setTimeout(() => s.onclose?.({ code: 1006, reason: '' }), 1)
    return s
  }
}
const POS = '{"MessageType":"PositionReport","MetaData":{"MMSI":1}}'
const fast = { openTimeoutMs: 200, listenMs: 60 }

test('測試金鑰：轉接收得到 → 只試轉接、判定有效', async () => {
  const log: AisRoute[] = []
  const r = await runKeyTest(fakeFactory({ relay: { open: true, msgs: [POS, POS] }, direct: { open: false } }, log), '{}', fast)
  assert.deepEqual(log, ['relay'])
  assert.equal(r.result.msgs, 2)
  assert.match(r.text, /金鑰有效/)
})

test('測試金鑰：轉接連不上、直連收得到 → 用直連的結果', async () => {
  const log: AisRoute[] = []
  const r = await runKeyTest(fakeFactory({ relay: { open: false }, direct: { open: true, msgs: [POS] } }, log), '{}', fast)
  assert.deepEqual(log, ['relay', 'direct'])
  assert.equal(r.result.route, 'direct')
  assert.match(r.text, /金鑰有效/)
})

test('測試金鑰：兩條都秒斷 → 金鑰多半無效', async () => {
  const r = await runKeyTest(
    fakeFactory({ relay: { open: true, closeAfterMs: 5 }, direct: { open: true, closeAfterMs: 5 } }, []),
    '{}',
    fast,
  )
  assert.equal(r.result.opened, true)
  assert.match(r.text, /金鑰多半無效/)
  assert.match(r.text, /一連上就被切斷/, '秒斷不能說成「15 秒都沒收到」')
})

test('測試金鑰：兩條都連不上 → 說是網路，不怪金鑰', async () => {
  const r = await runKeyTest(fakeFactory({ relay: { open: false }, direct: { open: false } }, []), '{}', fast)
  assert.match(r.text, /連不上/)
})

test('測試金鑰：aisstream 給了錯誤文字就照實顯示', async () => {
  const r = await runKeyTest(
    fakeFactory({ relay: { open: true, msgs: ['{"error":"Api Key Is Not Valid"}'], closeAfterMs: 5 }, direct: { open: false } }, []),
    '{}',
    fast,
  )
  assert.match(r.text, /Api Key Is Not Valid/)
})
