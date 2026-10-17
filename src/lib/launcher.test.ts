import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GROUPS, PEEK_IDS, visibleGroups, findItem, modeMeta } from './launcher.ts'
import type { TacticalMode } from '../types'

// 跟 types/index.ts 的 TacticalMode 同步。漏一個模式＝那個功能從 App 上消失。
const ALL_MODES: TacticalMode[] = ['orbit', 'sar', 'optical', 'ais', 'rescue', 'seastate', 'envanim', 'typhoon']

// 跟 App.tsx 掛載的工具面板（openTool）同步。
const ALL_TOOLS = [
  'layers', 'coord', 'measure', 'rings', 'intercept', 'dr', 'fieldops',
  'nightops', 'radio', 'lookout', 'radar', 'microwave', 'offline',
]

const all = GROUPS.flatMap((g) => g.items)

test('每個模式都有入口，而且只有一個', () => {
  for (const mode of ALL_MODES) {
    const hits = all.filter((i) => i.kind === 'mode' && i.id === mode)
    assert.equal(hits.length, 1, `模式 ${mode} 有 ${hits.length} 個入口`)
  }
})

test('每個工具都有入口（舊版 🧰 裡的 13 個一個都不能少）', () => {
  for (const tool of ALL_TOOLS) {
    assert.ok(all.some((i) => i.kind === 'tool' && i.id === tool), `工具 ${tool} 沒有入口`)
  }
})

test('id 不重複（模式 sar 與工具 radar 都叫「雷達」，但 id 不能撞）', () => {
  const ids = all.map((i) => i.id)
  assert.equal(new Set(ids).size, ids.length, `重複：${ids.filter((x, i) => ids.indexOf(x) !== i)}`)
})

test('不會把 basic 當成一個可以點的模式', () => {
  assert.ok(!all.some((i) => i.id === 'basic'))
})

/** 顯示寬度：中文字算 1，英數與空白算半個（「AIS 船位」＝4）。 */
const width = (s: string) => [...s].reduce((w, c) => w + (c.charCodeAt(0) < 0x2e80 ? 0.5 : 1), 0)

test('格子上的字夠短（一排四格，超過 5 個中文字寬就會換行或被截掉）', () => {
  for (const i of all) assert.ok(width(i.label) <= 5, `「${i.label}」太長（寬 ${width(i.label)}）`)
})

test('收起時那一排：都找得到、不超過五格', () => {
  assert.ok(PEEK_IDS.length <= 5)
  for (const id of PEEK_IDS) assert.ok(findItem(id), `${id} 不在功能清單裡`)
})

test('機敏鎖上鎖：雷達涵蓋整格不見，其他照常', () => {
  const locked = visibleGroups({ radarLocked: true }).flatMap((g) => g.items)
  assert.ok(!locked.some((i) => i.id === 'radar'))
  assert.ok(locked.some((i) => i.id === 'sar'), '雷達盲搜（模式）不歸機敏鎖管')
  const open = visibleGroups({ radarLocked: false }).flatMap((g) => g.items)
  assert.ok(open.some((i) => i.id === 'radar'))
})

test('模式標題列拿得到圖示與名稱；工具不算模式', () => {
  assert.equal(modeMeta('ais')?.label, 'AIS 船位')
  assert.equal(modeMeta('basic'), undefined)
})
