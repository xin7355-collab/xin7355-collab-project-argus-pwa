import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AisStore,
  DEAD_RECKON_MAX_S,
  MAX_VESSELS,
  STALE_MS,
  TRACK_SAMPLES,
  advance,
  aisEpochSec,
  approxMeters,
  bowDeg,
  cleanCog,
  cleanHeading,
  cleanSog,
  shipTypeText,
  type BBox,
} from './aisStore.ts'

const TW: BBox = [
  [21, 118],
  [26.5, 124],
]

// AISStream 真實格式（欄位名照 aisstream 文件與 gods-eye-view 的解析）
function pos(mmsi: number, lat: number, lng: number, extra: Record<string, unknown> = {}, time = '2026-11-15 08:00:00.123456789 +0000 UTC', type = 'PositionReport') {
  return {
    MessageType: type,
    MetaData: { MMSI: mmsi, ShipName: '', latitude: lat, longitude: lng, time_utc: time },
    Message: { [type]: { UserID: mmsi, Latitude: lat, Longitude: lng, Sog: 10, Cog: 90, TrueHeading: 88, ...extra } },
  }
}
function staticA(mmsi: number, name: string, type = 30) {
  return {
    MessageType: 'ShipStaticData',
    MetaData: { MMSI: mmsi, ShipName: name, latitude: 24, longitude: 121, time_utc: '2026-11-15 08:00:00 +0000 UTC' },
    Message: { ShipStaticData: { UserID: mmsi, Name: name, Type: type, Dimension: { A: 20, B: 10, C: 4, D: 4 }, Destination: 'KEELUNG' } },
  }
}

test('AIS 的「沒給」代碼當成沒有資料，不是真值', () => {
  assert.equal(cleanSog(102.3), null, '102.3 節＝沒給航速')
  assert.equal(cleanSog(102.2), 102.2, '102.2 是真的（≥102.2 節）')
  assert.equal(cleanSog(-1), null)
  assert.equal(cleanCog(360), null, '360°＝沒給航向')
  assert.equal(cleanCog(359.9), 359.9)
  assert.equal(cleanHeading(511), null, '511＝沒給船艏向')
  assert.equal(cleanSog(''), null)
})

test('沒給航速的船不會變成 102 節（以前會觸發「航速異常」假警報）', () => {
  const s = new AisStore()
  s.ingest(pos(416000001, 24, 121, { Sog: 102.3, Cog: 360, TrueHeading: 511 }), 1000)
  const [v] = s.snapshot(1000)
  assert.equal(v.sog, null)
  assert.equal(v.cog, null)
  assert.equal(v.heading, null)
  assert.equal(bowDeg(v), null, '都沒有就不旋轉')
})

test('Class B 船位也收（台灣很多漁船、遊艇是 Class B）', () => {
  const s = new AisStore()
  assert.equal(s.ingest(pos(416000002, 24, 121, {}, undefined, 'StandardClassBPositionReport'), 0), true)
  assert.equal(s.snapshot(0).length, 1)
})

test('船名船種比船位先到：先存起來，船位一到就有名字', () => {
  const s = new AisStore()
  s.ingest(staticA(416000003, 'FU YUAN 66'), 0)
  assert.equal(s.size, 0, '靜態報告不建船位（它的 MetaData 位置不是新定位）')
  s.ingest(pos(416000003, 24, 121), 10)
  const [v] = s.snapshot(10)
  assert.equal(v.name, 'FU YUAN 66')
  assert.equal(v.type, '漁船')
  assert.equal(v.length, 30)
  assert.equal(v.beam, 8)
  assert.equal(v.destination, 'KEELUNG')
})

test('Class B 靜態資料分兩半，Valid=false 的那半不採用', () => {
  const s = new AisStore()
  s.ingest(pos(416000004, 24, 121, {}, undefined, 'StandardClassBPositionReport'), 0)
  s.ingest(
    {
      MessageType: 'StaticDataReport',
      MetaData: { MMSI: 416000004, ShipName: '' },
      Message: { StaticDataReport: { UserID: 416000004, ReportA: { Valid: true, Name: 'SEA BIRD' }, ReportB: { Valid: false, ShipType: 70 } } },
    },
    1,
  )
  let [v] = s.snapshot(1)
  assert.equal(v.name, 'SEA BIRD')
  assert.equal(v.type, '不明', 'ReportB 無效，不能拿它的 70（貨船）')
  s.ingest(
    {
      MessageType: 'StaticDataReport',
      MetaData: { MMSI: 416000004, ShipName: 'SEA BIRD' },
      Message: { StaticDataReport: { UserID: 416000004, ReportA: { Valid: false, Name: 'X' }, ReportB: { Valid: true, ShipType: 37 } } },
    },
    2,
  )
  ;[v] = s.snapshot(2)
  assert.equal(v.name, 'SEA BIRD', '只帶船種的那半不能洗掉船名')
  assert.equal(v.type, '遊艇')
})

test('靜態報告不洗掉已知的航速航向', () => {
  const s = new AisStore()
  s.ingest(pos(416000005, 24, 121, { Sog: 12, Cog: 45 }), 0)
  s.ingest(staticA(416000005, 'HAI HUNG', 70), 1)
  const [v] = s.snapshot(1)
  assert.equal(v.sog, 12)
  assert.equal(v.cog, 45)
  assert.equal(v.type, '貨船')
})

test('航標：種類、虛擬航標、不推算、不算船', () => {
  const s = new AisStore()
  s.ingest(
    {
      MessageType: 'AidsToNavigationReport',
      MetaData: { MMSI: 994161234, ShipName: 'KEELUNG' },
      Message: { AidsToNavigationReport: { UserID: 994161234, Name: 'KEELUNG HARBOUR ', NameExtension: 'E', Type: 20, Latitude: 25.15, Longitude: 121.75, VirtualAtoN: true } },
    },
    0,
  )
  const [v] = s.snapshot(60_000)
  assert.equal(v.kind, 'aton')
  assert.equal(v.type, '浮標：北方位')
  assert.equal(v.name, 'KEELUNG HARBOUR E')
  assert.equal(v.virtual, true)
  assert.equal(v.reckoned, undefined)
})

test('船種中文：細分軍艦／執法／搜救，0 與保留碼是不明', () => {
  assert.equal(shipTypeText(30), '漁船')
  assert.equal(shipTypeText(35), '軍艦')
  assert.equal(shipTypeText(55), '執法船')
  assert.equal(shipTypeText(51), '搜救船')
  assert.equal(shipTypeText(52), '拖船')
  assert.equal(shipTypeText(74), '貨船')
  assert.equal(shipTypeText(84), '油輪')
  assert.equal(shipTypeText(56), '特種船')
  assert.equal(shipTypeText(0), '不明')
  assert.equal(shipTypeText(15), '不明')
  assert.equal(shipTypeText(120), '不明')
  assert.equal(shipTypeText('x'), '不明')
})

test('錯誤訊息、伺服器提示、沒 MMSI 的不算資料', () => {
  const s = new AisStore()
  assert.equal(s.ingest({ error: 'Api Key Is Not Valid' }, 0), false)
  assert.equal(s.ingest({ MessageType: 'SubscriptionConfirmation', Message: {} }, 0), false)
  assert.equal(s.ingest({ MessageType: 'PositionReport', MetaData: {}, Message: { PositionReport: {} } }, 0), false)
  assert.equal(s.ingest(null, 0), false)
})

test('經緯度 91／181（AIS 的沒有位置）不建船', () => {
  const s = new AisStore()
  assert.equal(s.ingest(pos(416000006, 91, 181), 0), true)
  assert.equal(s.size, 0)
})

test('30 分鐘沒回報就移除（以前關掉 AIS 的船會永遠留在原地）', () => {
  const s = new AisStore()
  s.ingest(pos(416000007, 24, 121), 0)
  s.prune(STALE_MS - 1)
  assert.equal(s.size, 1)
  s.prune(STALE_MS + 1)
  assert.equal(s.size, 0)
})

test('框外的船清掉；總數超過上限先丟最舊的', () => {
  const s = new AisStore()
  s.ingest(pos(416000008, 10, 100), 0)
  s.ingest(pos(416000009, 24, 121), 0)
  s.prune(1, TW)
  assert.deepEqual(s.snapshot(1).map((v) => v.mmsi), ['416000009'])
  const big = new AisStore()
  for (let i = 0; i < MAX_VESSELS + 5; i++) big.ingest(pos(400000000 + i, 24, 121), i)
  big.prune(MAX_VESSELS + 10)
  assert.equal(big.size, MAX_VESSELS)
  assert.equal(big.snapshot(0).some((v) => v.mmsi === '400000000'), false, '最舊的先丟')
})

test('多久沒回報：手機收到的時間＋收到時這筆已經落後資料源多少', () => {
  const s = new AisStore()
  s.ingest(pos(416000010, 24, 121, {}, '2026-11-15 08:10:00 +0000 UTC'), 0)
  // 同一時刻收到一筆 4 分鐘前的回報（資料源補送）
  s.ingest(pos(416000011, 24, 121, {}, '2026-11-15 08:06:00 +0000 UTC'), 0)
  const age = Object.fromEntries(s.snapshot(30_000).map((v) => [v.mmsi, Math.round(v.ageSec)]))
  assert.equal(age['416000010'], 30)
  assert.equal(age['416000011'], 270)
})

test('推算船位：最多推 3 分鐘，之後停住', () => {
  const s = new AisStore()
  s.ingest(pos(416000012, 24, 121, { Sog: 20, Cog: 90 }), 0)
  const at = (ms: number) => s.snapshot(ms)[0]
  const p60 = at(60_000)
  assert.equal(p60.reckoned, true)
  assert.ok(Math.abs(approxMeters(24, 121, p60.lat, p60.lng) - (20 * 1852 / 3600) * 60) < 3)
  const pMax = at(DEAD_RECKON_MAX_S * 1000)
  const pLater = at(DEAD_RECKON_MAX_S * 1000 + 600_000)
  assert.equal(pLater.lat, pMax.lat)
  assert.equal(pLater.lng, pMax.lng, '超過 3 分鐘不再往前推')
})

test('慢速、沒航向的船不推算', () => {
  const s = new AisStore()
  s.ingest(pos(416000013, 24, 121, { Sog: 0.2, Cog: 90 }), 0)
  s.ingest(pos(416000014, 24.1, 121, { Sog: 8, Cog: 360 }), 0)
  for (const v of s.snapshot(60_000)) {
    assert.equal(v.reckoned, undefined)
  }
})

test('航跡：不到 30 秒或 25 公尺不記，最多 64 點', () => {
  const s = new AisStore()
  const t = (sec: number) => `2026-11-15 08:${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')} +0000 UTC`
  s.ingest(pos(416000015, 24, 121, {}, t(0)), 0)
  s.ingest(pos(416000015, 24.001, 121, {}, t(10)), 0) // 10 秒：太快
  s.ingest(pos(416000015, 24.0001, 121, {}, t(40)), 0) // 11 公尺：太近
  assert.equal(s.track('416000015').length, 0, '還沒有第二個合格點')
  s.ingest(pos(416000015, 24.001, 121, {}, t(70)), 0)
  assert.equal(s.track('416000015').length, 2)
  const s2 = new AisStore()
  for (let i = 0; i < TRACK_SAMPLES + 10; i++) {
    const m = Math.floor((i * 31) / 60)
    const sec = (i * 31) % 60
    s2.ingest(pos(416000016, 24 + i * 0.001, 121, {}, `2026-11-15 ${String(8 + Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:${String(sec).padStart(2, '0')} +0000 UTC`), 0)
  }
  const tr = s2.track('416000016')
  assert.equal(tr.length, TRACK_SAMPLES)
  assert.ok(tr[0].t < tr[tr.length - 1].t, '舊到新')
})

test('AISStream 時間格式（+0000 UTC、奈秒）', () => {
  assert.equal(aisEpochSec('2026-11-15 08:00:00.123456789 +0000 UTC'), Date.UTC(2026, 10, 15, 8, 0, 0) / 1000)
  assert.equal(aisEpochSec(''), null)
  assert.equal(aisEpochSec('garbage'), null)
})

test('推算公式：赤道往東 1 小時 10 節＝10 浬（10 分經度）、往北＝10 分緯度', () => {
  const [lat, lng] = advance(0, 0, 90, 10, 3600)
  assert.ok(Math.abs(lat) < 1e-9)
  assert.ok(Math.abs(lng * 60 - 10) < 1e-6)
  const [lat2] = advance(24, 121, 0, 10, 3600)
  assert.ok(Math.abs((lat2 - 24) * 60 - 10) < 1e-6)
})

test('船名去掉 AIS 補位的 @ 與多餘空白', () => {
  const s = new AisStore()
  s.ingest(staticA(416000017, 'HAI  HUNG@@@@'), 0)
  s.ingest(pos(416000017, 24, 121), 0)
  assert.equal(s.snapshot(0)[0].name, 'HAI HUNG')
})
