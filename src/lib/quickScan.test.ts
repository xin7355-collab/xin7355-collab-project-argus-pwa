import { test } from 'node:test'
import assert from 'node:assert/strict'
import { daysBefore, planQuickScan, summarizeScan } from './quickScan.ts'
import type { Detection } from './detection'

function target(p: Partial<Detection> & Pick<Detection, 'ais'>): Detection {
  return {
    lat: 24, lng: 122, score: 5,
    south: 24, west: 122, north: 24.01, east: 122.01,
    sizeM: 40, cls: '中型目標（疑似漁船/快艇）',
    ...p,
  }
}

// ── 挑來源 ────────────────────────────────────────────────

test('日期一律退一天（衛星影像有數小時延遲，當天多半還沒好）', () => {
  assert.equal(daysBefore('2026-10-11', 1), '2026-10-10')
  assert.equal(daysBefore('2026-01-01', 1), '2025-12-31') // 跨年
  assert.equal(daysBefore('2026-03-01', 1), '2026-02-28') // 非閏年 2 月
  assert.equal(daysBefore('壞日期', 1), '壞日期', '解析失敗要原樣回傳，不能回 NaN')
})

test('有 Sentinel 金鑰：走 Sentinel，且提醒「不是此刻」', () => {
  const p = planQuickScan({ hasSentinel: true, today: '2026-10-11' })
  assert.equal(p.usesSentinel, true)
  assert.equal(p.date, '2026-10-10')
  assert.match(p.caveat, /不是此刻/)
})

test('沒有金鑰：用高解析空拍，而且必須明講「看不到今天的船」', () => {
  const p = planQuickScan({ hasSentinel: false, today: '2026-10-11' })
  assert.equal(p.usesSentinel, false)
  assert.equal(p.source, 'esri')
  // 這是最容易讓人誤會的地方：沒有紅框 ≠ 海上沒船
  assert.match(p.caveat, /看不到「今天」的船/)
  assert.match(p.caveat, /Sentinel 金鑰/)
})

test('不挑每日 VIIRS／MODIS——250–375m 解析度掃小艇等於做白工', () => {
  for (const hasSentinel of [true, false]) {
    const p = planQuickScan({ hasSentinel, today: '2026-10-11' })
    assert.notEqual(p.source, 'nasa', '不該選每日低解析來源')
  }
})

// ── 講成人話 ──────────────────────────────────────────────

test('沒有目標：要給下一步建議，不是只說「沒有」', () => {
  const s = summarizeScan([], true)
  assert.equal(s.severity, 'none')
  assert.ok(s.lines.length > 0, '要有下一步建議')
  assert.equal(s.suspicious.length, 0)
})

test('沒有 AIS 金鑰：不能把目標講成可疑', () => {
  const s = summarizeScan([target({ ais: 'na' }), target({ ais: 'na' })], false)
  assert.equal(s.severity, 'info')
  assert.match(s.headline, /分不出/)
  assert.match(s.lines.join(''), /不等於可疑/)
  assert.equal(s.suspicious.length, 0, '沒比對過就不能列進可疑清單')
})

test('全部對得到 AIS：不該報警', () => {
  const s = summarizeScan([target({ ais: 'known' }), target({ ais: 'known' })], true)
  assert.equal(s.severity, 'info')
  assert.match(s.headline, /全部對得到 AIS/)
  assert.equal(s.suspicious.length, 0)
})

test('有無 AIS 的目標：報警、排序，且附上「沒 AIS 不等於違法」', () => {
  const s = summarizeScan(
    [
      target({ ais: 'known' }),
      target({ ais: 'none', score: 3 }),
      target({ ais: 'none', score: 9 }),
      target({ ais: 'none', score: 6 }),
    ],
    true,
  )
  assert.equal(s.severity, 'alert')
  assert.match(s.headline, /3 個目標沒有 AIS/)
  assert.match(s.headline, /共 4 個/)
  // 分數高的排前面——值班要先看的就是最突出的那個
  assert.deepEqual(s.suspicious.map((t) => t.score), [9, 6, 3])
  assert.match(s.lines.join(''), /不等於違法/)
})

test('尺度分類統計：數量多的排前面', () => {
  const s = summarizeScan(
    [
      target({ ais: 'known', cls: '小型目標（疑似小船/浮標）' }),
      target({ ais: 'known', cls: '小型目標（疑似小船/浮標）' }),
      target({ ais: 'known', cls: '大型目標（疑似大船）' }),
    ],
    true,
  )
  const joined = s.lines.join(' | ')
  assert.match(joined, /小型目標（疑似小船\/浮標） ×2/)
  assert.match(joined, /大型目標（疑似大船） ×1/)
  assert.ok(
    joined.indexOf('×2') < joined.indexOf('×1'),
    '數量多的要排前面',
  )
})
