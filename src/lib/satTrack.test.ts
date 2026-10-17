import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tleAgeText, tleEpochMs, trackFromTle } from './satTrack.ts'
import { coversPoint, nearestApproach, swathEdges } from './groundTrack.ts'
import { parseTle } from './tle.ts'

// 一組 ISS 量級的 TLE：軌道參數（傾角 51.64、每日圈數 15.495）取自公開的
// ISS 典型值，檢查碼自行補正到自洽。它是「格式與物理都成立」的測試資料，
// 不是某一天的真實觀測值。
//
// 用它驗「流程與物理合理性」，不驗某個精確座標——TLE 會過期，
// 把特定座標寫死在測試裡只會讓測試在未來某天無故紅燈。
const ISS_TLE = `ISS (ZARYA)
1 25544U 98067A   24015.50000000  .00016717  00000-0  10270-3 0  9004
2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.49514900 10008`

function issRec() {
  const recs = parseTle(ISS_TLE)
  assert.equal(recs.length, 1, 'TLE 測試資料本身要是合法的')
  return recs[0]
}

test('TLE epoch 解得出來（年份兩位數的世紀判斷）', () => {
  const ms = tleEpochMs('1 25544U 98067A   24015.50000000  .00016717  00000-0  10270-3 0  9004')
  assert.ok(ms !== null)
  const d = new Date(ms)
  assert.equal(d.getUTCFullYear(), 2024)
  assert.equal(d.getUTCMonth(), 0, '第 15.5 日 = 1 月')
  assert.equal(d.getUTCDate(), 15)
  assert.equal(d.getUTCHours(), 12, '.5 日 = 正午')
})

test('TLE epoch：57 以上視為 19xx（NORAD 慣例）', () => {
  const ms = tleEpochMs('1 00005U 58002B   98001.00000000  .00000000  00000-0  00000-0 0  9990')
  assert.equal(new Date(ms!).getUTCFullYear(), 1998)
})

test('壞掉的 epoch 回 null，不要回 NaN 讓它悄悄往下流', () => {
  assert.equal(tleEpochMs('1 25544U 98067A   XXXXX.XXXXXXXX'), null)
  assert.equal(tleEpochMs(''), null)
})

test('SGP4 推算得出軌跡，而且數值都在合法範圍', () => {
  const t0 = Date.UTC(2024, 0, 15, 12, 0, 0)
  const tr = trackFromTle(issRec(), t0, t0 + 90 * 60 * 1000, 60)
  assert.ok(tr, '應該算得出來')
  assert.ok(tr.points.length > 80, `一圈 90 分鐘每 60 秒一點，實際 ${tr.points.length} 點`)
  for (const p of tr.points) {
    assert.ok(Number.isFinite(p.lat) && Number.isFinite(p.lng), 'NaN 會在地圖上變成看不出錯的破線')
    assert.ok(Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180)
  }
})

test('物理合理性：ISS 傾角 51.6，緯度不會超過那個範圍', () => {
  const t0 = Date.UTC(2024, 0, 15, 12, 0, 0)
  const tr = trackFromTle(issRec(), t0, t0 + 95 * 60 * 1000, 30)!
  const maxAbs = Math.max(...tr.points.map((p) => Math.abs(p.lat)))
  assert.ok(maxAbs > 48 && maxAbs < 53, `最高緯度應接近 51.6，實際 ${maxAbs.toFixed(2)}`)
})

test('物理合理性：繞一圈約 92–93 分鐘後回到接近的緯度', () => {
  const t0 = Date.UTC(2024, 0, 15, 12, 0, 0)
  const tr = trackFromTle(issRec(), t0, t0 + 93 * 60 * 1000, 30)!
  const first = tr.points[0]
  const last = tr.points[tr.points.length - 1]
  assert.ok(Math.abs(first.lat - last.lat) < 6, `一圈後緯度應接近，${first.lat.toFixed(1)} vs ${last.lat.toFixed(1)}`)
})

test('物理合理性：相鄰取樣點的地面位移符合約 7.6 km/s', () => {
  const t0 = Date.UTC(2024, 0, 15, 12, 0, 0)
  const tr = trackFromTle(issRec(), t0, t0 + 10 * 60 * 1000, 60)!
  const near = nearestApproach(tr.points, tr.points[0].lat, tr.points[0].lng)!
  assert.equal(near.idx, 0)
  // 用現成的 coversPoint 檢查 60 秒後的位移量級（約 450km 地面距離）
  const c = coversPoint([tr.points[1]], 2000, tr.points[0].lat, tr.points[0].lng)!
  assert.ok(c.km > 300 && c.km < 600, `60 秒應移動約 450km，實際 ${c.km.toFixed(0)}km`)
})

test('壞掉的 TLE 要回 null，不是回空軌跡假裝算過', () => {
  assert.equal(trackFromTle({ name: 'X', line1: 'garbage', line2: 'garbage', noradId: '0' }, 0, 1000), null)
})

test('算出來的軌跡可以直接餵給既有的掃幅/涵蓋判斷', () => {
  const t0 = Date.UTC(2024, 0, 15, 12, 0, 0)
  const tr = trackFromTle(issRec(), t0, t0 + 20 * 60 * 1000, 30)!
  const { left, right } = swathEdges(tr.points, 290)
  assert.ok(left.length > 2 && right.length > 2, '掃幅邊界算得出來')
  const onTrack = tr.points[10]
  assert.equal(coversPoint(tr.points, 290, onTrack.lat, onTrack.lng)?.covered, true)
})

test('TLE 太舊要標示出來，不能默默拿去當精準預報', () => {
  const now = Date.UTC(2024, 0, 20)
  assert.equal(tleAgeText(Date.UTC(2024, 0, 19, 18), now).stale, false)
  assert.match(tleAgeText(Date.UTC(2024, 0, 19, 18), now).text, /小時前/)
  assert.equal(tleAgeText(Date.UTC(2024, 0, 17), now).stale, false, '3 天內還能用')
  assert.equal(tleAgeText(Date.UTC(2024, 0, 5), now).stale, true, '超過一週誤差明顯，要警告')
  assert.equal(tleAgeText(Date.UTC(2024, 0, 25), now).stale, true, '未來時間一定有問題')
})
