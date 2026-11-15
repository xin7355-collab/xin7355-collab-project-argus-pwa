import { test } from 'node:test'
import assert from 'node:assert/strict'
import { altitudeKm, heightForZoom, nextOrbitEcef, periodMin, satEcefMeters, satrecOf, viewRadiusNm, zoomForHeight } from './globeMath.ts'
import { parseTle } from './tle.ts'
import { fixtureEpochMs, makeTle, type TleElements } from './tleFixture.ts'

test('2D 縮放 ↔ 3D 高度來回一致；越放大高度越低', () => {
  for (const z of [3, 7, 12, 16]) {
    const h = heightForZoom(z, 24)
    assert.ok(Math.abs(zoomForHeight(h, 24) - z) < 1e-9, `z${z}`)
  }
  assert.ok(heightForZoom(8, 24) > heightForZoom(9, 24) * 1.99)
  // z7 看台灣附近：大約 700～900 公里高
  const h7 = heightForZoom(7, 24)
  assert.ok(h7 > 700_000 && h7 < 900_000, String(h7))
})

test('高度換回縮放會夾在 2～18（太高、太低都不會跑出地圖能用的範圍）', () => {
  assert.equal(zoomForHeight(1e9, 24), 2)
  assert.equal(zoomForHeight(1, 24), 18)
})

test('看得到的半徑隨高度變大', () => {
  assert.ok(viewRadiusNm(100_000) < viewRadiusNm(1_000_000))
  assert.ok(Math.abs(viewRadiusNm(1_000_000) - 499) < 1, String(viewRadiusNm(1_000_000)))
})

const ISS_LIKE: TleElements = { satnum: 25544, inclination: 51.64, raan: 120, meanMotion: 15.5, epochYear: 26, epochDay: 300.5 }

test('衛星位置：ISS 般的軌道在約 400 公里高、一圈約 93 分鐘', () => {
  const r = parseTle(makeTle('ISS (TEST)', ISS_LIKE))[0]
  const sat = satrecOf(r.line1, r.line2)
  assert.ok(sat)
  const p = satEcefMeters(sat, new Date(fixtureEpochMs(ISS_LIKE) + 600_000))
  assert.ok(p)
  const alt = altitudeKm(p)
  assert.ok(alt > 300 && alt < 500, `高度 ${alt}`)
  assert.ok(Math.abs(periodMin(sat) - 92.9) < 0.5, `週期 ${periodMin(sat)}`)
})

test('接下來一圈：點數齊全、每個點都在軌道高度、頭尾不重疊（地球在轉）', () => {
  const r = parseTle(makeTle('ISS (TEST)', ISS_LIKE))[0]
  const sat = satrecOf(r.line1, r.line2)
  assert.ok(sat)
  const pts = nextOrbitEcef(sat, fixtureEpochMs(ISS_LIKE), 60)
  assert.equal(pts.length, 61)
  for (const p of pts) assert.ok(altitudeKm(p) > 300 && altitudeKm(p) < 500)
  const [a, b] = [pts[0], pts[pts.length - 1]]
  const gapKm = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / 1000
  assert.ok(gapKm > 1000, `一圈後地球轉了約 23°，頭尾應差上千公里，實際 ${gapKm}`)
})

test('壞掉的根數回 null，不會算出 NaN 的位置', () => {
  assert.equal(satrecOf('garbage', 'garbage'), null)
})
