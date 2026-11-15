import { test } from 'node:test'
import assert from 'node:assert/strict'
import { operatorOf, sarOpportunities } from './sarOps.ts'
import { makeTle, fixtureEpochMs } from './tleFixture.ts'
import { trackFromTle } from './satTrack.ts'
import { parseTle } from './tle.ts'

const SSO = { satnum: 50001, inclination: 97.5, raan: 100, meanMotion: 15.2 }

test('營運商分類：Sentinel-1 不重複算、認不得的歸其他', () => {
  assert.equal(operatorOf('SENTINEL-1C'), null)
  assert.equal(operatorOf('ICEYE-X54')?.name, 'ICEYE')
  assert.equal(operatorOf('CSG-2')?.name, 'COSMO-SkyMed')
  assert.equal(operatorOf('COSMO-SKYMED 4')?.name, 'COSMO-SkyMed')
  assert.equal(operatorOf('CAPELLA-14 (ACADIA-4)')?.name, 'Capella')
  assert.equal(operatorOf('GAOFEN-3 02')?.name, '高分三號')
  assert.equal(operatorOf('NISAR')?.note, '美國 NASA／印度 ISRO，資料免費公開')
  assert.equal(operatorOf('SAR-LUPE 2')?.name, '其他')
})

test('經過次數：目標在軌跡附近一定有，依最早機會排序、每家最多列 3 次', async () => {
  const t0 = fixtureEpochMs(SSO)
  const text = makeTle('ICEYE-X99', SSO) + makeTle('SENTINEL-1A', { ...SSO, satnum: 50002 })
  const r = parseTle(makeTle('ICEYE-X99', SSO))[0]
  const tr = trackFromTle(r, t0 + 3600_000, t0 + 3660_000, 30)!
  const p = tr.points[0]
  const out = await sarOpportunities(text, p.lat, p.lng, t0, t0 + 48 * 3600_000)
  assert.equal(out.length, 1, 'Sentinel-1 不算在這裡')
  assert.equal(out[0].operator, 'ICEYE')
  assert.ok(out[0].count >= 1)
  assert.ok(out[0].next.length <= 3)
  for (let i = 1; i < out[0].next.length; i++) assert.ok(out[0].next[i].ms >= out[0].next[i - 1].ms)
})
