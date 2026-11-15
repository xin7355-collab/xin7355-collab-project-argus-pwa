import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchVessels, type SearchableVessel } from './vesselSearch.ts'

const ship = (mmsi: string, name: string, ageSec = 10, kind: 'ship' | 'aton' = 'ship'): SearchableVessel => ({ mmsi, name, kind, ageSec })

const FLEET = [
  ship('416000001', 'EVER GIVEN'),
  ship('416000002', 'GIVEN STAR'),
  ship('416123456', 'HAI XUN 01'),
  ship('477000003', 'NEVER GIVE UP'),
  ship('416000009', '(無船名)'),
  ship('994161234', 'KEELUNG HBR LT', 5, 'aton'),
  ship('416555555', '海巡 05'),
]
const names = (vs: SearchableVessel[]) => vs.map((v) => v.name)

test('船名：完全相同 > 開頭相同 > 某個字開頭 > 中間含有', () => {
  assert.deepEqual(names(matchVessels(FLEET, 'given')), ['GIVEN STAR', 'EVER GIVEN'], 'NEVER GIVE UP 不含 GIVEN')
  assert.deepEqual(names(matchVessels(FLEET, 'GIVE')), ['GIVEN STAR', 'EVER GIVEN', 'NEVER GIVE UP'])
  assert.deepEqual(names(matchVessels(FLEET, 'ever given')), ['EVER GIVEN'])
})

test('忽略空白也找得到（EVERGIVEN → EVER GIVEN）', () => {
  assert.deepEqual(names(matchVessels(FLEET, 'evergiven')), ['EVER GIVEN'])
  assert.deepEqual(names(matchVessels(FLEET, 'haixun')), ['HAI XUN 01'])
})

test('純數字比 MMSI：完全相同 > 開頭 > 中間含有；船名裡的數字不算', () => {
  assert.deepEqual(matchVessels(FLEET, '416000001').map((v) => v.mmsi), ['416000001'])
  assert.deepEqual(matchVessels(FLEET, '4161').map((v) => v.mmsi), ['416123456', '994161234'], '開頭的船在前、中間含有的航標在後')
  assert.deepEqual(matchVessels(FLEET, '01'), [], '太短')
})

test('中文船名一個字就能找；沒有船名的不會被「無」找出來', () => {
  assert.deepEqual(names(matchVessels(FLEET, '海巡')), ['海巡 05'])
  assert.deepEqual(matchVessels(FLEET, '無'), [])
})

test('太短、空白不找；最多回 limit 艘；同分時剛回報的在前', () => {
  assert.deepEqual(matchVessels(FLEET, 'e'), [])
  assert.deepEqual(matchVessels(FLEET, '   '), [])
  const many = Array.from({ length: 20 }, (_, i) => ship(`41600${String(i).padStart(4, '0')}`, `ALPHA ${i}`, 100 - i))
  const r = matchVessels(many, 'alpha', 3)
  assert.equal(r.length, 3)
  assert.deepEqual(names(r), ['ALPHA 19', 'ALPHA 18', 'ALPHA 17'])
})
