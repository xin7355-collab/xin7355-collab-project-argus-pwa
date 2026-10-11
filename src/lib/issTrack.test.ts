// issTrack 的單元測試：驗「解析」與「幾何」。
//
// 注意：線上 API 的實際回傳格式「沒驗到」——這兩個主機在開發沙箱被網路政策
// 擋住（CONNECT 403）。這裡驗的是解析函式面對兩種已知格式與各種壞資料時的
// 行為，以及可見地平圈的算式。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ISS_INCLINATION_DEG,
  ISS_NOMINAL_ALT_KM,
  isOverhead,
  issFootprintKm,
  orbitPeriodMin,
  parseIssFix,
} from './issTrack.ts'

test('解析 wheretheiss 格式（有高度、速度、日照）', () => {
  const fix = parseIssFix(
    {
      name: 'iss',
      id: 25544,
      latitude: 24.5,
      longitude: 122.0,
      altitude: 419.8,
      velocity: 27583.1,
      visibility: 'daylight',
      timestamp: 1760000000,
    },
    'wheretheiss.at',
  )
  assert.ok(fix, '應該要解析得出來')
  assert.equal(fix.lat, 24.5)
  assert.equal(fix.lng, 122.0)
  assert.ok(Math.abs((fix.altKm ?? 0) - 419.8) < 1e-6)
  assert.ok(Math.abs((fix.speedKmh ?? 0) - 27583.1) < 1e-6)
  assert.equal(fix.visibility, 'daylight')
  assert.equal(fix.at, 1760000000000)
  assert.equal(fix.source, 'wheretheiss.at')
})

test('解析 open-notify 格式（巢狀、數值是字串、沒有高度）', () => {
  const fix = parseIssFix(
    { message: 'success', timestamp: 1760000000, iss_position: { latitude: '-12.25', longitude: '101.5' } },
    'open-notify.org',
  )
  assert.ok(fix)
  assert.equal(fix.lat, -12.25)
  assert.equal(fix.lng, 101.5)
  assert.equal(fix.altKm, null)
  assert.equal(fix.speedKmh, null)
  assert.equal(fix.visibility, null)
})

test('沒有 timestamp 時退回本機時間，不整筆丟掉', () => {
  const before = Date.now()
  const fix = parseIssFix({ latitude: 0, longitude: 0 }, 'x')
  assert.ok(fix)
  assert.ok(fix.at >= before && fix.at <= Date.now() + 1000)
})

test('壞資料一律回 null（由呼叫端換端點）', () => {
  for (const bad of [
    null,
    undefined,
    'not json',
    42,
    {},
    { latitude: 24.5 }, // 只有一半
    { latitude: 'abc', longitude: 'def' },
    { latitude: 95, longitude: 0 }, // 緯度超範圍
    { latitude: 0, longitude: 181 }, // 經度超範圍
    { latitude: NaN, longitude: 0 },
  ]) {
    assert.equal(parseIssFix(bad, 'x'), null, `這筆應該被拒絕：${JSON.stringify(bad)}`)
  }
})

test('經度 0、緯度 0 是合法位置，不能被當成「沒有資料」', () => {
  const fix = parseIssFix({ latitude: 0, longitude: 0, timestamp: 1760000000 }, 'x')
  assert.ok(fix, '赤道/本初子午線交點是合法座標')
  assert.equal(fix.lat, 0)
  assert.equal(fix.lng, 0)
})

test('可見地平圈：420km 約 2250km，且隨高度遞增', () => {
  const r = issFootprintKm(ISS_NOMINAL_ALT_KM)
  assert.ok(r > 2100 && r < 2400, `420km 的地平圈應約 2250km，實際 ${r.toFixed(0)}`)
  assert.ok(issFootprintKm(800) > r, '越高看得越遠')
  // 沒有高度時要退回標稱值，不能回 NaN
  assert.ok(Math.abs(issFootprintKm(null) - r) < 1e-9)
})

test('可見範圍判定：正上方在圈內，對蹠點不在', () => {
  const r = issFootprintKm(420)
  assert.equal(isOverhead(0, 420), true, '正上方一定在圈內')
  assert.equal(isOverhead(r - 1, 420), true, '剛好在圈內')
  assert.equal(isOverhead(r + 1, 420), false, '剛好在圈外')
  assert.equal(isOverhead(12000, 420), false, '地球另一側不可能看到')
  // 沒有高度時要用標稱值判斷，不能因為 null 就全判 false
  assert.equal(isOverhead(100, null), true)
})

test('由高度推算軌道週期：420km 約 92.8 分鐘', () => {
  const t = orbitPeriodMin(420)
  assert.ok(Math.abs(t - 92.8) < 0.5, `420km 應約 92.8 分，實際 ${t.toFixed(2)}`)
  // 越高飛越慢（克卜勒第三定律）
  assert.ok(orbitPeriodMin(800) > t, '800km 的週期要比 420km 長')
  // 沒有高度時退回標稱值，不能回 NaN
  assert.ok(Math.abs(orbitPeriodMin(null) - orbitPeriodMin(ISS_NOMINAL_ALT_KM)) < 1e-9)
  assert.ok(Number.isFinite(orbitPeriodMin(0)), '高度 0 也不能回 NaN')
})

test('ISS 傾角常數在合理範圍（決定軌跡最北/最南到哪）', () => {
  assert.ok(ISS_INCLINATION_DEG > 51 && ISS_INCLINATION_DEG < 52, '約 51.6 度')
})
