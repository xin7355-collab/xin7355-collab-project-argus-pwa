import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cellKey,
  cellsForBbox,
  checkPoint,
  cleanText,
  decodeRing,
  decodeZone,
  distanceToEdgeM,
  encodeRing,
  encodeZone,
  epochDate,
  normalizeAirspace,
  normalizePark,
  normalizePort,
  periodText,
  polysBbox,
  rocDate,
  simplifyRing,
  tileZones,
  twDate,
  verdictText,
  zoneActive,
  zoneContains,
  zoneUpcoming,
  zoneDesc,
  zoneTag,
  WIDE_CELLS,
  type DroneZone,
} from './droneZones.ts'

/** 以 (lat, lng) 為中心、邊長 2×half 公尺的正方形環（逆時針、封閉）。 */
function square(lat: number, lng: number, halfM: number): number[][] {
  const dLat = halfM / 110_574
  const dLng = halfM / (111_320 * Math.cos((lat * Math.PI) / 180))
  return [
    [lng - dLng, lat - dLat],
    [lng + dLng, lat - dLat],
    [lng + dLng, lat + dLat],
    [lng - dLng, lat + dLat],
    [lng - dLng, lat - dLat],
  ]
}

function zone(over: Partial<DroneZone> & { polys: number[][][][] }): DroneZone {
  return { id: 'airspace:1', layer: 'airspace', level: 'no', kind: '測試', name: '測試區', bbox: polysBbox(over.polys), ...over }
}

const NOW = Date.parse('2026-11-27T04:00:00Z') // 台灣 2026-11-27 中午

test('民國日期：114/12/24 → 2025-12-24；999 年＝長期；格式錯不亂猜', () => {
  assert.equal(rocDate('114/12/24'), '2025-12-24')
  assert.equal(rocDate('114/2/3'), '2025-02-03')
  assert.equal(rocDate(' 115.11.13 '), '2026-11-13')
  assert.equal(rocDate('999/12/31'), undefined)
  assert.equal(rocDate('114/13/01'), undefined)
  assert.equal(rocDate('明年'), undefined)
  assert.equal(rocDate(null), undefined)
})

test('毫秒時間戳 → 台灣日期；西元 2200 年後＝長期；台灣午夜換日', () => {
  assert.equal(epochDate(1769904000000), '2026-02-01') // 2026-01-31T16:00Z＝台灣 2/1 00:00
  assert.equal(epochDate('1769904000000'), '2026-02-01')
  assert.equal(epochDate(29694988800000), undefined)
  assert.equal(epochDate(''), undefined)
  assert.equal(epochDate(null), undefined)
  assert.equal(twDate(Date.parse('2026-11-26T16:00:00Z')), '2026-11-27')
  assert.equal(twDate(Date.parse('2026-11-26T15:59:59Z')), '2026-11-26')
})

test('官方文字：統一換行、去空白、空字串當沒有', () => {
  assert.equal(cleanText('  1.禁止\r\n 2.申請 \r\n\r\n\r\n3.其他 '), '1.禁止\n2.申請\n\n3.其他')
  assert.equal(cleanText('   '), undefined)
  assert.equal(cleanText(null), undefined)
})

const AIRSPACE_FEATURE = {
  properties: {
    objectid: 38790,
    空域類別名稱: '縣市政府限制使用範圍',
    空域類型: 7,
    空域顏色: '黃區',
    條件: '限制',
    空域名稱: '中122 海巡機關',
    空域說明: '<有條件開放>\r\n1.僅得為管理機關從事飛航活動。\r\n2.經會商同意後始得為之。',
    主管機關名稱: '臺中市政府',
    會商機關名稱: '參山國家風景區\n管理處',
    聯絡方式: '承辦窗口：王小明\r\n電子郵件：someone@example.gov.tw\r\n電話：0912345678',
    created_user: 'caa_admin',
    罰則: '罰款3萬-15萬\r\n得沒入遙控無人機',
    有效日期起: '114/12/24',
    有效日期迄: '999/12/31',
  },
  geometry: { type: 'Polygon', coordinates: [square(24.25, 120.52, 300)] },
}

test('主空域正規化：欄位對、日期換算、聯絡方式（個資）整欄不收', () => {
  const z = normalizeAirspace(AIRSPACE_FEATURE, 'airspace')!
  assert.equal(z.id, 'airspace:38790')
  assert.equal(z.level, 'limit')
  assert.equal(z.kind, '縣市政府限制使用範圍')
  assert.equal(z.name, '中122 海巡機關')
  assert.equal(z.desc, '<有條件開放>\n1.僅得為管理機關從事飛航活動。\n2.經會商同意後始得為之。')
  assert.equal(z.consult, '參山國家風景區管理處')
  assert.equal(z.from, '2025-12-24')
  assert.equal(z.to, undefined)
  assert.equal(z.ceilingFt, undefined)
  const all = JSON.stringify(z)
  assert.ok(!all.includes('@') && !all.includes('0912345678') && !all.includes('王小明') && !all.includes('caa_admin'), '不可以帶到個資')
  assert.ok(!('to' in z), '沒有的欄位直接拿掉')
})

test('機場四周 200 呎以上禁止：限高從類別來（不從說明猜）；紅區＝禁止', () => {
  const base = AIRSPACE_FEATURE.properties
  const f200 = { ...AIRSPACE_FEATURE, properties: { ...base, 空域類型: 5, 空域類別名稱: '機場四周距地面或水面200呎以上禁止施放範圍', 條件: '限制' } }
  assert.equal(normalizeAirspace(f200, 'airspace')!.ceilingFt, 200)
  const fRed = { ...AIRSPACE_FEATURE, properties: { ...base, 空域類型: 4, 空域類別名稱: null, 條件: null, 空域顏色: '紅區' } }
  const red = normalizeAirspace(fRed, 'airspace')!
  assert.equal(red.level, 'no')
  assert.equal(red.kind, '機場四周禁止施放範圍', '類別名稱是空的就用類型代碼對照')
  assert.equal(red.ceilingFt, undefined)
  assert.equal(normalizeAirspace({ ...AIRSPACE_FEATURE, geometry: { type: 'Point', coordinates: [120, 24] } }, 'airspace'), null)
  assert.equal(normalizeAirspace({ properties: { ...base, objectid: null }, geometry: AIRSPACE_FEATURE.geometry }, 'airspace'), null)
})

test('商港區：管制＝有條件、禁止＝禁止；毫秒日期；聯絡方式不收', () => {
  const f = {
    properties: {
      objectid: 2,
      名稱: '商港-基隆港2禁止飛行區域',
      條件: '禁止',
      說明: '禁止飛行區域',
      管理_及會商_機關: '臺灣港務股份有限公司',
      管理_及會商_機關聯絡方式: '承辦窗口：基隆港務分公司\n電子郵件：t0000@example.com.tw',
      有效日期起: '1769904000000',
      有效日期迄: '29694988800000',
    },
    geometry: { type: 'Polygon', coordinates: [square(25.15, 121.74, 400)] },
  }
  const z = normalizePort(f)!
  assert.equal(z.level, 'no')
  assert.equal(z.layer, 'port')
  assert.equal(z.from, '2026-02-01')
  assert.equal(z.to, undefined)
  assert.ok(!JSON.stringify(z).includes('@'))
  assert.equal(normalizePort({ ...f, properties: { ...f.properties, 條件: '管制' } })!.level, 'limit')
})

test('國家公園：另有規定；只收 https 連結', () => {
  const f = {
    properties: { objectid: 1, name_full: '東沙環礁國家公園', 相關規: 'https://www.marine.gov.tw/apply' },
    geometry: { type: 'Polygon', coordinates: [square(20.7, 116.8, 5000)] },
  }
  const z = normalizePark(f)!
  assert.equal(z.level, 'notice')
  assert.equal(z.link, 'https://www.marine.gov.tw/apply')
  assert.equal(normalizePark({ ...f, properties: { ...f.properties, 相關規: 'javascript:alert(1)' } })!.link, undefined)
})

test('幾何簡化：圓從 720 點縮到少很多、仍封閉、面積幾乎不變；太小的環不丟、壞環回 null', () => {
  const lat = 25.08
  const lng = 121.23
  const circle: number[][] = []
  for (let i = 0; i <= 720; i++) {
    const a = (i / 720) * 2 * Math.PI
    circle.push([lng + (500 / (111_320 * Math.cos((lat * Math.PI) / 180))) * Math.cos(a), lat + (500 / 110_574) * Math.sin(a)])
  }
  const s = simplifyRing(circle)!
  assert.ok(s.length < 200 && s.length >= 4, `點數 ${s.length}`)
  assert.deepEqual(s[0], s[s.length - 1])
  const area = (r: number[][]) => Math.abs(r.reduce((acc, p, i) => (i ? acc + (r[i - 1][0] * p[1] - p[0] * r[i - 1][1]) : 0), 0) / 2)
  assert.ok(Math.abs(area(s) / area(circle) - 1) < 0.01, '面積差不到 1%')
  // 簡化後偏離不到 3 公尺：原圓上每點離簡化後邊界都很近
  const z = zone({ polys: [[s]] })
  const worst = Math.max(...circle.filter((_, i) => i % 7 === 0).map(([x, y]) => distanceToEdgeM(z, y, x)))
  assert.ok(worst < 3, `最大偏離 ${worst.toFixed(2)} 公尺`)
  const tiny = square(25, 121, 1)
  assert.ok(simplifyRing(tiny), '1 公尺見方的小區也要留著')
  assert.equal(simplifyRing([[121, 25], [121.1, 25], [121, 25]]), null)
})

test('座標編碼：差分整數，來回一致（1e-5 度）', () => {
  const r = [
    [121.23456, 25.07771],
    [121.2349, 25.0779],
    [121.23001, 25.07],
    [121.23456, 25.07771],
  ]
  const enc = encodeRing(r)
  assert.deepEqual(enc.slice(0, 2), [12123456, 2507771])
  assert.deepEqual(decodeRing(enc), r)
  const z = zone({ polys: [[r]] })
  assert.deepEqual(decodeZone(encodeZone(z)), z)
})

test('切格：0.5 度一格；負座標也對；跨格的每格一份；跨太多格放 wide', () => {
  assert.equal(cellKey(25.07, 121.23), '50_242')
  assert.equal(cellKey(-0.1, -0.1), '-1_-1')
  assert.deepEqual(cellsForBbox([121.4, 24.9, 121.6, 25.1]), ['49_242', '49_243', '50_242', '50_243'])
  const a = zone({ id: 'a', polys: [[square(25.0, 121.5, 2000)]] }) // 跨 4 格
  const b = zone({ id: 'b', polys: [[square(25.2, 121.2, 300)]] })
  const huge = zone({ id: 'huge', polys: [[[[114, 10], [118, 10], [118, 13], [114, 13], [114, 10]]]] })
  assert.ok(cellsForBbox(huge.bbox).length > WIDE_CELLS)
  const { tiles, wide } = tileZones([a, b, huge])
  assert.deepEqual([...tiles.keys()].sort(), ['49_242', '49_243', '50_242', '50_243'])
  assert.deepEqual(tiles.get('50_242')!.map((z) => z.id), ['a', 'b'])
  assert.deepEqual(wide.map((z) => z.id), ['huge'])
})

test('點在區內：外框內、洞裡不算；多個多邊形任一個都算', () => {
  const outer = square(25, 121, 1000)
  const hole = square(25, 121, 300)
  const other = square(25.1, 121.1, 200)
  const z = zone({ polys: [[outer, hole], [other]] })
  assert.equal(zoneContains(z, 25, 121), false, '在洞裡')
  assert.equal(zoneContains(z, 25 + 600 / 110_574, 121), true, '在外框與洞之間')
  assert.equal(zoneContains(z, 25.1, 121.1), true, '第二個多邊形')
  assert.equal(zoneContains(z, 25.05, 121.05), false)
})

test('離邊界距離：正方形東邊外 100 公尺 ≈ 100 公尺', () => {
  const z = zone({ polys: [[square(25, 121, 500)]] })
  const lng = 121 + 600 / (111_320 * Math.cos((25 * Math.PI) / 180))
  const d = distanceToEdgeM(z, 25, lng)
  assert.ok(Math.abs(d - 100) < 1, `${d}`)
})

test('生效期間：含頭含尾（台灣日期）；30 天內才算即將生效', () => {
  assert.equal(zoneActive({ from: '2026-11-27', to: '2026-11-27' }, NOW), true)
  assert.equal(zoneActive({ from: '2026-11-28' }, NOW), false)
  assert.equal(zoneActive({ to: '2026-11-26' }, NOW), false)
  assert.equal(zoneActive({}, NOW), true)
  assert.equal(zoneUpcoming({ from: '2026-12-10' }, NOW), true)
  assert.equal(zoneUpcoming({ from: '2027-03-01' }, NOW), false)
  assert.equal(zoneUpcoming({ from: '2026-11-27' }, NOW), false, '今天生效＝已經生效')
})

test('判定：禁止優先；附近 1 公里內列出（近的在前）；即將生效另列；過期不算；邊界提醒', () => {
  const red = zone({ id: 'red', level: 'no', name: '桃園機場禁止施放範圍', polys: [[square(25, 121, 500)]] })
  const yellow = zone({ id: 'yellow', level: 'limit', name: '黃區', polys: [[square(25, 121, 2000)]] })
  const nearZ = zone({ id: 'near', level: 'no', name: '旁邊', polys: [[square(25, 121 + 1200 / 100_900, 400)]] })
  const far = zone({ id: 'far', level: 'no', name: '很遠', polys: [[square(25.2, 121.2, 400)]] })
  const soon = zone({ id: 'soon', layer: 'temporary', level: 'no', name: '耶誕活動', from: '2026-12-20', to: '2026-12-20', polys: [[square(25, 121, 800)]] })
  const later = zone({ id: 'later', layer: 'temporary', level: 'no', name: '跨年煙火（34 天後，不列）', from: '2026-12-31', to: '2026-12-31', polys: [[square(25, 121, 800)]] })
  const old = zone({ id: 'old', layer: 'temporary', level: 'no', name: '上個月的活動', from: '2026-10-01', to: '2026-10-02', polys: [[square(25, 121, 800)]] })
  const c = checkPoint(25, 121, [yellow, red, nearZ, far, soon, later, old, red], NOW)
  assert.equal(c.verdict, 'no')
  assert.deepEqual(c.inside.map((z) => z.id), ['red', 'yellow'])
  assert.deepEqual(c.near.map((n) => n.zone.id), ['near'])
  assert.ok(Math.abs(c.near[0].distM - 800) < 30, `${c.near[0].distM}`)
  assert.deepEqual(c.upcoming.map((z) => z.id), ['soon'])
  assert.equal(c.nearEdge, false)
  assert.equal(verdictText(c), '禁止飛航：在「桃園機場禁止施放範圍」等 2 個範圍內')
  // 貼著紅區邊界 20 公尺：提醒以官方為準
  const edge = checkPoint(25, 121 + 520 / 100_900, [red], NOW)
  assert.equal(edge.verdict, 'clear')
  assert.equal(edge.nearEdge, true)
  // 什麼都沒有
  const sea = checkPoint(24.5, 122, [red, yellow], NOW)
  assert.equal(sea.verdict, 'clear')
  assert.match(verdictText(sea), /不在公告的禁限航區內/)
})

test('同樣禁止：民航局公告的（機場四周）排在縣市公告前面，結論講最重的', () => {
  const county = zone({ id: 'county', level: 'no', kind: '縣市政府限制使用範圍', name: '桃園捷運機場線-桃園段1', polys: [[square(25, 121, 300)]] })
  const airport = zone({ id: 'apt', level: 'no', kind: '機場四周禁止施放範圍', name: '臺灣桃園國際機場禁止施放範圍', polys: [[square(25, 121, 3000)]] })
  const c = checkPoint(25, 121, [county, airport], NOW)
  assert.deepEqual(c.inside.map((z) => z.id), ['apt', 'county'])
  assert.equal(verdictText(c), '禁止飛航：在「臺灣桃園國際機場禁止施放範圍」等 2 個範圍內')
})

test('只在機場 200 呎以上禁止範圍內：講限高（公尺）；其他黃區講照說明', () => {
  const c200 = zone({ id: 'c200', level: 'limit', name: '松山機場200呎以上禁止施放範圍', ceilingFt: 200, polys: [[square(25, 121, 3000)]] })
  const c = checkPoint(25, 121, [c200], NOW)
  assert.equal(c.verdict, 'limit')
  assert.equal(c.ceilingFt, 200)
  assert.equal(verdictText(c), '有條件：200 呎（約 61 公尺）以上禁止')
  const park = zone({ id: 'p', level: 'limit', name: '谷關公園', polys: [[square(25, 121, 1000)]] })
  assert.match(verdictText(checkPoint(25, 121, [c200, park], NOW)), /照說明的條件才能飛/)
  const np = zone({ id: 'np', layer: 'park', level: 'notice', name: '陽明山國家公園', polys: [[square(25, 121, 1000)]] })
  assert.match(verdictText(checkPoint(25, 121, [np], NOW)), /要另外向管理處申請/)
})

test('類別標籤與說明：臨時公告標出來；說明跟名稱一樣就不重複', () => {
  assert.equal(zoneTag({ layer: 'airspace', kind: '機場四周禁止施放範圍' }), '機場四周禁止施放範圍')
  assert.equal(zoneTag({ layer: 'temporary', kind: '縣市政府限制使用範圍' }), '臨時公告・縣市政府限制使用範圍')
  assert.equal(zoneDesc({ name: '嘉義機場禁止施放範圍', desc: '嘉義機場禁止施放範圍' }), undefined)
  assert.equal(zoneDesc({ name: '谷關公園', desc: '週一至週五開放' }), '週一至週五開放')
})

test('期間文字', () => {
  assert.equal(periodText({}), '長期')
  assert.equal(periodText({ from: '2026-12-31', to: '2026-12-31' }), '2026-12-31 當天')
  assert.equal(periodText({ from: '2026-11-13', to: '2026-12-27' }), '2026-11-13 到 2026-12-27')
  assert.equal(periodText({ from: '2025-12-24' }), '2025-12-24 起')
})
