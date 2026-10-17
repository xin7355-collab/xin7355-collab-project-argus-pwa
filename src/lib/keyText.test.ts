import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanKey, keyHint } from './keyText.ts'

test('拿掉手機貼上常多帶的隱形字元、換行、引號', () => {
  assert.equal(cleanKey(' ab12cd​34ef\n'), 'ab12cd34ef')
  assert.equal(cleanKey('﻿“abc123def456” '), 'abc123def456')
  assert.equal(cleanKey('「abc-123」'), 'abc-123')
  assert.equal(cleanKey(undefined), '')
})

test('金鑰摘要：長度＋頭尾，不整把露出', () => {
  const h = keyHint('0123456789abcdef0123456789abcdef01234567')
  assert.equal(h.odd, false)
  assert.match(h.text, /長度 40/)
  assert.match(h.text, /開頭 0123…結尾 4567/)
  assert.doesNotMatch(h.text, /89abcdef/)
})

test('貼成網址或說明文字 → 標成可疑', () => {
  assert.equal(keyHint('https://aisstream.io/apikeys').odd, true)
  assert.equal(keyHint('').odd, true)
})
