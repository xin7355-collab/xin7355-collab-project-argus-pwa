import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addShot,
  cleanShot,
  durationText,
  heightText,
  loadShots,
  moveShot,
  persistShots,
  PRESET_SHOTS,
  removeShot,
  SHOTS_MAX,
  tourTimeline,
  updateShot,
  type Shot,
} from './director.ts'

/** 假的 localStorage。 */
function mem(initial?: string, failWrite = false) {
  const m = new Map<string, string>()
  if (initial !== undefined) m.set('argus.director.v1', initial)
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (failWrite) throw new Error('QuotaExceededError')
      m.set(k, v)
    },
    raw: () => m.get('argus.director.v1'),
  }
}

const view = { lon: 121.5, lat: 25.1, height: 20_000, heading: 30, pitch: -45, roll: 0 }

test('修整：角度轉回範圍內、高度夾在 100 公尺～4 萬公里、壞的回 null', () => {
  const s = cleanShot({ id: 'a', name: '  基隆港  ', lon: 121.7, lat: 25.15, height: 5, heading: -90, pitch: 20, roll: 0, flySec: 999, holdSec: -3 })
  assert.ok(s)
  assert.equal(s.name, '基隆港')
  assert.equal(s.height, 100)
  assert.equal(s.heading, 270)
  assert.equal(s.pitch, 0, '不能往天上看到地平線以上')
  assert.equal(s.flySec, 60)
  assert.equal(s.holdSec, 0)
  assert.equal(cleanShot({ id: 'b', lon: 200, lat: 0, height: 1000 }), null, '經度超出範圍')
  assert.equal(cleanShot({ id: 'c', lon: 0, lat: 0, height: 0 }), null, '高度 0')
  assert.equal(cleanShot({ lon: 0, lat: 0, height: 1000 }), null, '沒有 id')
  assert.equal(cleanShot('x'), null)
  assert.equal(cleanShot({ id: 'd', name: '', lon: 0, lat: 0, height: 1000 })?.name, '未命名鏡頭')
})

test('沒存過 → 內建範例；存了再讀回來一樣；壞掉的鏡頭丟掉、其他保留', () => {
  assert.deepEqual(loadShots(mem()).map((s) => s.id), PRESET_SHOTS.map((s) => s.id))
  const st = mem()
  const shots = addShot([], view, 'x1', '我的港口')
  assert.equal(persistShots(shots, st), true)
  assert.deepEqual(loadShots(st), shots)
  const mixed = mem(JSON.stringify([{ id: 'ok', lon: 1, lat: 1, height: 1000 }, { id: 'bad', lon: 999 }, null, { id: 'ok', lon: 2, lat: 2, height: 1000 }]))
  assert.deepEqual(loadShots(mixed).map((s) => s.id), ['ok'], '壞的丟掉、重複的 id 只留第一個')
  assert.deepEqual(loadShots(mem('{not json')).map((s) => s.id), PRESET_SHOTS.map((s) => s.id), '整份壞掉就回範例，不要空白')
})

test('存不了（無痕模式、空間滿）回 false，畫面才講得出「沒存到」', () => {
  assert.equal(persistShots([], mem(undefined, true)), false)
  assert.equal(persistShots([], null), false)
})

test('加鏡頭：預設名稱與秒數；滿了不再加', () => {
  const a = addShot([], view, 'id1')
  assert.equal(a[0].name, '鏡頭 1')
  assert.equal(a[0].flySec, 4)
  assert.equal(a[0].holdSec, 3)
  const full = Array.from({ length: SHOTS_MAX }, (_, i) => ({ ...a[0], id: `s${i}` }))
  assert.equal(addShot(full, view, 'more'), full)
})

test('上移、下移、刪除、改名改秒數；頭尾再移不動', () => {
  let s: Shot[] = ['a', 'b', 'c'].reduce((acc, id) => addShot(acc, view, id), [] as Shot[])
  s = moveShot(s, 'c', -1)
  assert.deepEqual(s.map((x) => x.id), ['a', 'c', 'b'])
  assert.equal(moveShot(s, 'a', -1), s, '第一個不能再往前')
  assert.equal(moveShot(s, 'b', 1), s, '最後一個不能再往後')
  assert.equal(moveShot(s, 'nope', 1), s)
  s = removeShot(s, 'c')
  assert.deepEqual(s.map((x) => x.id), ['a', 'b'])
  s = updateShot(s, 'a', { name: '港口', flySec: 10, holdSec: 999 })
  assert.equal(s[0].name, '港口')
  assert.equal(s[0].flySec, 10)
  assert.equal(s[0].holdSec, 600, '停留秒數有上限')
})

test('播放時間表與全長', () => {
  const s = [
    { ...PRESET_SHOTS[0], flySec: 3, holdSec: 3 },
    { ...PRESET_SHOTS[1], flySec: 5, holdSec: 4 },
  ]
  assert.deepEqual(tourTimeline(s), [
    { id: s[0].id, startSec: 0, arriveSec: 3, leaveSec: 6 },
    { id: s[1].id, startSec: 6, arriveSec: 11, leaveSec: 15 },
  ])
  assert.equal(durationText(s), '15 秒')
  assert.equal(durationText([{ ...s[0], flySec: 60, holdSec: 5 }]), '1 分 05 秒')
  assert.equal(durationText([]), '0 秒')
})

test('高度給人看', () => {
  assert.equal(heightText(1_100_000), '1,100 公里')
  assert.equal(heightText(4_500), '4.5 公里')
  assert.equal(heightText(800), '800 公尺')
})
