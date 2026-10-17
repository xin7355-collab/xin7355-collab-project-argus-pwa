import { test } from 'node:test'
import assert from 'node:assert/strict'
import { snapHeights, nearestSnap, tapCycle, FLICK_SPEED } from './sheet.ts'

// iPhone 14/15 的可用高度約 844，標題列（含安全區）約 120
const HS = snapHeights(844, 120, 76)

test('三段由低到高，而且全開不會蓋到搜尋列', () => {
  assert.ok(HS.peek < HS.half && HS.half < HS.full, JSON.stringify(HS))
  assert.ok(HS.full <= 844 - 76)
})

test('收起時地圖要看得到八成以上（舊版只有 38%）', () => {
  assert.ok((844 - HS.peek) / 844 >= 0.8, `只剩 ${Math.round(((844 - HS.peek) / 844) * 100)}%`)
})

test('小手機（iPhone SE 667 高）三段仍分得開', () => {
  const hs = snapHeights(667, 120, 76)
  assert.ok(hs.half - hs.peek >= 100, '一半跟收起太接近，拖起來分不出差別')
  assert.ok(hs.full > hs.half)
})

test('慢慢放手：停在最近的那一段', () => {
  assert.equal(nearestSnap(HS.peek + 20, 0, HS), 'peek')
  assert.equal(nearestSnap(HS.half - 15, 0, HS), 'half')
  assert.equal(nearestSnap(HS.full - 10, 0.1, HS), 'full')
})

test('往上甩：從收起只跳到一半，不會一口氣衝到全開', () => {
  // 甩到半路（已經比較靠近 half），舊的「找最近下一段」會跳到 full
  assert.equal(nearestSnap(HS.peek + 60, FLICK_SPEED + 0.5, HS), 'half')
  assert.equal(nearestSnap(HS.half + 10, FLICK_SPEED + 0.5, HS), 'full')
})

test('往下甩：從全開只降到一半；從一半降到收起', () => {
  assert.equal(nearestSnap(HS.full - 60, -(FLICK_SPEED + 0.5), HS), 'half')
  assert.equal(nearestSnap(HS.half - 10, -(FLICK_SPEED + 0.5), HS), 'peek')
})

test('已經在最頂／最底再甩，不會跑出範圍', () => {
  assert.equal(nearestSnap(HS.full, 5, HS), 'full')
  assert.equal(nearestSnap(HS.peek, -5, HS), 'peek')
})

test('點把手的循環', () => {
  assert.equal(tapCycle('peek'), 'half')
  assert.equal(tapCycle('half'), 'full')
  assert.equal(tapCycle('full'), 'half')
})
