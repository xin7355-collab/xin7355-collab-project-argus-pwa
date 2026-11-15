import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyDevice, type DeviceFacts } from './device.ts'

const facts = (o: Partial<DeviceFacts>): DeviceFacts => ({ coarse: false, hover: true, shortSide: 900, memoryGB: null, webgl2: true, ...o })

test('電腦（滑鼠、能懸停）→ 直接開', () => {
  assert.deepEqual(classifyDevice(facts({})), { kind: 'desktop', globe: 'ok', why: '' })
})

test('iPhone（手指、不能懸停、短邊 390）→ 先提醒，講清楚會怎樣', () => {
  const v = classifyDevice(facts({ coarse: true, hover: false, shortSide: 390 }))
  assert.equal(v.kind, 'phone')
  assert.equal(v.globe, 'heavy')
  assert.match(v.why, /2–3 MB/)
  assert.match(v.why, /用電腦開最順/)
})

test('iPad（手指、短邊 820）→ 平板，可以直接開；接了觸控板的 iPad 算電腦', () => {
  assert.deepEqual(classifyDevice(facts({ coarse: true, hover: false, shortSide: 820 })), { kind: 'tablet', globe: 'ok', why: '' })
  assert.equal(classifyDevice(facts({ coarse: true, hover: true, shortSide: 820 })).kind, 'desktop')
})

test('iPad mini（短邊 744）仍是平板；短邊 599 算手機', () => {
  assert.equal(classifyDevice(facts({ coarse: true, hover: false, shortSide: 744 })).kind, 'tablet')
  assert.equal(classifyDevice(facts({ coarse: true, hover: false, shortSide: 599 })).kind, 'phone')
})

test('記憶體只有 2 GB（瀏覽器有給的話）→ 就算是電腦也先提醒', () => {
  const v = classifyDevice(facts({ memoryGB: 2 }))
  assert.equal(v.kind, 'desktop')
  assert.equal(v.globe, 'heavy')
  assert.match(v.why, /2 GB/)
  assert.equal(classifyDevice(facts({ memoryGB: 8 })).globe, 'ok')
})

test('不支援 WebGL 2 → 開不了，並講可以怎麼做', () => {
  const v = classifyDevice(facts({ webgl2: false }))
  assert.equal(v.globe, 'unsupported')
  assert.match(v.why, /Chrome、Edge 或 Safari/)
})
