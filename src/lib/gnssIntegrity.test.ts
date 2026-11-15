import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  accumulateGnssObservations,
  binGnssCells,
  gnssCellKey,
  gnssCellText,
  gnssIntegrityLevel,
  normalizeGnssAircraft,
  pruneGnssObservations,
  GNSS_WINDOW_MS,
  type GnssRow,
  type GnssStore,
} from './gnssIntegrity.ts'

// 測試案例移植自 gods-eye-view（MIT）src/layers/gnss/records.test.mjs，涵蓋同樣的邊界情況。

const aircraft = (o: Record<string, unknown> = {}) => ({
  hex: '4ca7b5',
  type: 'adsb_icao',
  version: 2,
  alt_baro: 36000,
  lat: 50.1,
  lon: 19.9,
  nic: 8,
  nac_p: 10,
  seen_pos: 1.2,
  ...o,
})

test('只收：空中、ADS-B 第 1/2 版、一分鐘內的位置、有品質欄位；重複的 hex 只算一次', () => {
  const rows = normalizeGnssAircraft({
    ac: [
      aircraft(),
      aircraft({ hex: '000001', type: 'mlat', nic: undefined, nac_p: undefined }),
      aircraft({ hex: '000002', type: 'tisb_icao' }),
      aircraft({ hex: '000003', version: 0 }),
      aircraft({ hex: '000004', alt_baro: 'ground' }),
      aircraft({ hex: '000005', seen_pos: 120 }),
      aircraft({ hex: '000006', nic: undefined, nac_p: undefined }),
      aircraft({ hex: '000007', lat: 95 }),
      aircraft({ hex: '000008', version: undefined }),
      aircraft({ hex: '000009', version: 3 }),
      aircraft({ hex: '00000a', version: '2' }),
      aircraft({ hex: '00000c', seen_pos: undefined }),
      aircraft({ hex: '00000e', seen_pos: -0.5 }),
      aircraft({ hex: '00000f', seen_pos: '1.2' }),
      aircraft({ hex: '000011', seen_pos: 60.1 }),
      aircraft({ hex: 'not-hex' }),
      aircraft(),
      aircraft({ hex: '~a1b2c3' }),
      aircraft({ hex: 'b00001', version: 1, seen_pos: 0 }),
      aircraft({ hex: 'b00002', seen_pos: 60 }),
      null,
    ],
  })
  assert.deepEqual(
    rows?.map((r) => r.hex),
    ['4ca7b5', '~a1b2c3', 'b00001', 'b00002'],
  )
  assert.equal(normalizeGnssAircraft({}), null, '沒有飛機陣列＝格式不對，不是沒有飛機')
  assert.equal(normalizeGnssAircraft(null), null)
})

test('NIC 低、NACp 低、或 GPS 遺失旗標，各自都算精度差', () => {
  const rows = normalizeGnssAircraft({
    ac: [
      aircraft({ hex: 'a00001', nic: 6 }),
      aircraft({ hex: 'a00002', nac_p: 7 }),
      aircraft({ hex: 'a00003', gpsOkBefore: 1790690000.1 }),
      aircraft({ hex: 'a00004', nic: 7, nac_p: 8 }),
    ],
  })
  assert.deepEqual(
    rows?.map((r) => [r.hex, r.degraded, r.gpsLost]),
    [
      ['a00001', true, false],
      ['a00002', true, false],
      ['a00003', true, true],
      ['a00004', false, false],
    ],
  )
})

test('TIS-B 轉播的精度、未知的包容半徑（NIC 0 但 NACp 好）不會製造異常', () => {
  const rows = normalizeGnssAircraft({
    ac: [
      aircraft({ hex: 'a00001', nac_p: 0, tisb: ['nac_p'] }),
      aircraft({ hex: 'a00002', nic: 0, tisb: ['nic'] }),
      aircraft({ hex: 'a00003', nic: 0, nac_p: 10 }),
      aircraft({ hex: 'a00004', nic: 0, nac_p: 8 }),
      aircraft({ hex: 'a00005', nic: 6, nac_p: 10 }),
    ],
  })
  assert.deepEqual(rows?.map((r) => r.degraded), [false, false, false, true, true])
})

test('MLAT 的 GPS 遺失：證據放在最後一次好的 GPS 位置，不採用 MLAT 的 NIC', () => {
  const [row] = normalizeGnssAircraft({
    ac: [aircraft({ type: 'mlat', nac_p: 0, nic: 0, mlat: ['lat', 'lon', 'nic'], gpsOkBefore: 1800000000, gpsOkLat: 54.2, gpsOkLon: 19.3 })],
  }) ?? []
  assert.equal(row.lat, 54.2)
  assert.equal(row.lon, 19.3)
  assert.equal(row.nic, null)
  assert.equal(row.degraded, true)
})

test('格子代號：半度一格，極區與換日線夾住', () => {
  assert.equal(gnssCellKey(50.1, 19.9), gnssCellKey(50.4, 19.6))
  assert.notEqual(gnssCellKey(50.1, 19.9), gnssCellKey(50.6, 19.9))
  assert.equal(gnssCellKey(90, 180), gnssCellKey(89.9, 179.9))
  assert.equal(gnssCellKey(-90, -180), '0:0')
  assert.equal(gnssCellKey(-0.1, -0.1), '179:359')
})

test('等級照 gpsjam.org：先扣一架，< 2% 低、2–10% 中、> 10% 高', () => {
  assert.deepEqual(gnssIntegrityLevel(10, 0), { percent: 0, level: 'low', anomaly: false })
  assert.equal(gnssIntegrityLevel(10, 1).level, 'low', '一架壞的一律扣掉')
  assert.equal(gnssIntegrityLevel(50, 2).level, 'medium')
  assert.equal(gnssIntegrityLevel(10, 2).level, 'medium')
  assert.equal(gnssIntegrityLevel(10, 3).level, 'high')
  assert.equal(gnssIntegrityLevel(0, 0).level, 'low')
})

const MIN = 60_000
const report = (hex: string, degraded: boolean, lat = 50.1): GnssRow => ({ hex, lat, lon: 20.1, nic: null, nacp: null, gpsLost: false, degraded })
const entry = (store: GnssStore, hex: string) => [...store].find(([k]) => k.startsWith(`${hex}|`))?.[1]

test('每架在每格只算一次；過了時間窗就消失', () => {
  const store: GnssStore = new Map()
  accumulateGnssObservations(store, [report('a1', true, 50.1), report('a2', false, 50.2), report('a3', false, 50.3)], 0, { windowMs: 1000 })
  accumulateGnssObservations(store, [report('a1', false, 50.2)], 500, { windowMs: 1000 })
  const [cell] = binGnssCells(store)
  assert.equal(cell.aircraft, 3)
  assert.equal(cell.degraded, 1, 'a1 恢復了，但在時間窗內仍算差')
  assert.deepEqual([cell.south, cell.west, cell.north, cell.east], [50, 20, 50.5, 20.5])
  accumulateGnssObservations(store, [], 1200, { windowMs: 1000 })
  assert.deepEqual(binGnssCells(store), [])
})

test('精度差的證據從那一筆起算一個時間窗，後面一直回報正常也不會延長', () => {
  const store: GnssStore = new Map()
  accumulateGnssObservations(store, [report('a1', true)], 0)
  for (let m = 1; m <= 30; m++) accumulateGnssObservations(store, [report('a1', false)], m * MIN)
  assert.equal(entry(store, 'a1')?.degradedAt, 0)
  accumulateGnssObservations(store, [report('a1', false)], 31 * MIN)
  assert.equal(entry(store, 'a1')?.degradedAt, null)
  accumulateGnssObservations(store, [report('a1', true)], 32 * MIN)
  assert.equal(entry(store, 'a1')?.degradedAt, 32 * MIN, '新的一筆差重新起算')
})

test('快照用觀測時間記：重播舊快照不會讓證據變新；未來時間夾到現在；沒時間的不收', () => {
  const store: GnssStore = new Map()
  const snap = [report('a1', true), report('a2', false)]
  accumulateGnssObservations(store, snap, 0, { observedAt: 0 })
  accumulateGnssObservations(store, snap, 29 * MIN, { observedAt: 0 })
  assert.equal(entry(store, 'a1')?.seenAt, 0)
  accumulateGnssObservations(store, snap, 31 * MIN, { observedAt: 0 })
  assert.equal(store.size, 0, '比時間窗還舊的快照什麼都不加')
  accumulateGnssObservations(store, [report('f1', true)], 50 * MIN, { observedAt: 99 * MIN })
  assert.equal(entry(store, 'f1')?.seenAt, 50 * MIN)
  for (const observedAt of [null, Number.NaN]) accumulateGnssObservations(store, [report('u1', true)], 50 * MIN, { observedAt })
  assert.equal(entry(store, 'u1'), undefined)
})

test('只清理：過期的觀測刪掉、過期的「差」改回沒有', () => {
  const store: GnssStore = new Map()
  accumulateGnssObservations(store, [report('a1', true)], 0)
  accumulateGnssObservations(store, [report('a1', false)], 20 * MIN)
  accumulateGnssObservations(store, [report('a2', false)], 0)
  assert.equal(pruneGnssObservations(store, 31 * MIN), store)
  assert.deepEqual([...store.keys()].map((k) => k.split('|')[0]), ['a1'])
  assert.equal(entry(store, 'a1')?.degradedAt, null)
  pruneGnssObservations(store, 51 * MIN)
  assert.equal(store.size, 0)
  assert.equal(GNSS_WINDOW_MS, 30 * MIN)
})

test('座標不合法的不進格子；飛機少於 3 架的格子不顯示', () => {
  const store: GnssStore = new Map()
  accumulateGnssObservations(store, [{ ...report('n1', true), lat: Number.NaN }, null], 0)
  assert.equal(store.size, 0)
  accumulateGnssObservations(store, [report('b1', true, 10.1), report('b2', true, 10.2)], 0)
  assert.deepEqual(binGnssCells(store), [])
  const [cell] = binGnssCells(store, { minAircraft: 2 })
  assert.equal(cell.level, 'high')
  assert.equal(cell.percentDegraded, 50)
})

test('說明文字：先講看到什麼，異常才講可能原因，一律講限制', () => {
  const store: GnssStore = new Map()
  accumulateGnssObservations(store, [report('a1', true), report('a2', true), report('a3', false), report('a4', false)], 0)
  const [cell] = binGnssCells(store)
  const t = gnssCellText(cell).join('\n')
  assert.match(t, /定位異常（高）/)
  assert.match(t, /4 架飛機經過，2 架回報定位精度差（扣掉 1 架後 25%）/)
  assert.match(t, /GPS 干擾或欺騙（未經驗證）/)
  assert.match(t, /海面上的船/)
  const ok: GnssStore = new Map()
  accumulateGnssObservations(ok, [report('a1', false), report('a2', false), report('a3', false)], 0)
  assert.doesNotMatch(gnssCellText(binGnssCells(ok)[0]).join('\n'), /干擾/)
})
