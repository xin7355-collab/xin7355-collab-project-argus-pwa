import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pushRecentTool, RECENT_MAX } from './recentTools.ts'

// localStorage 在 Node 裡不存在；pushRecentTool 內部已用 try/catch 包起來，
// 所以這裡測的是純粹的排序邏輯。

test('新用的排最前面', () => {
  assert.deepEqual(pushRecentTool('radar', ['radio', 'coord']), ['radar', 'radio', 'coord'])
})

test('已經在清單裡的要往前提，不是變成兩筆', () => {
  assert.deepEqual(pushRecentTool('coord', ['radio', 'coord', 'radar']), ['coord', 'radio', 'radar'])
})

test('超過上限要裁掉最舊的', () => {
  const r = pushRecentTool('new', ['a', 'b', 'c', 'd'])
  assert.equal(r.length, RECENT_MAX)
  assert.equal(r[0], 'new')
  assert.ok(!r.includes('d'), '最舊的要被擠掉')
})

test('從空清單開始也要正常', () => {
  assert.deepEqual(pushRecentTool('layers', []), ['layers'])
})

test('重複推同一個不會變長', () => {
  let r = pushRecentTool('x', [])
  r = pushRecentTool('x', r)
  r = pushRecentTool('x', r)
  assert.deepEqual(r, ['x'])
})
