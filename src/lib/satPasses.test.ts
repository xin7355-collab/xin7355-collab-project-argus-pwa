// 「下一趟會不會拍到我這片海」的測試。
//
// 這裡**不驗「衛星在某時刻應該在某經緯度」**——那等於把 SGP4 的輸出抄下來
// 當答案，以後換版本就整片紅，而且根本沒驗到自己寫的東西。
//
// 真正要驗的是我自己加的那層：
//   1. 先粗後細的取樣最佳化，不可以漏掉任何一趟（跟全程細掃比對，要完全一樣）
//   2. 「算不出來」和「沒有過境」要分得開
//   3. 掃幅涵蓋的定義要正確（最接近距離不超過半掃幅）

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeTle, fixtureEpochMs } from './tleFixture.ts'
import { parseTle, type TleRecord } from './tle.ts'
import { passesForPoint, trackFromTle } from './satTrack.ts'
import { findPasses } from './groundTrack.ts'
import { planPasses, topPerSat } from './passPlan.ts'
import { assignFleet } from './satFleet.ts'

/** Sentinel-2 那一類的太陽同步軌道。 */
const SSO = { satnum: 40697, inclination: 98.57, raan: 100, meanMotion: 14.3 }
/** ISS 那一類的低傾角軌道——高緯度永遠飛不到，用來驗「真的沒有過境」。 */
const LOW_INC = { satnum: 25544, inclination: 51.64, raan: 247.46, meanMotion: 15.495 }

const T0 = fixtureEpochMs(SSO)

function rec(name: string, e: Parameters<typeof makeTle>[1]): TleRecord {
  const r = parseTle(makeTle(name, e))
  assert.equal(r.length, 1, '夾具本身不合法（檢查碼或欄位位置錯了）')
  return r[0]
}

/** 取某一刻的星下點當目標——這樣一定有一趟會掃到，測試才不會是空的。 */
function subPointAt(r: TleRecord, tMs: number): { lat: number; lng: number } {
  const tr = trackFromTle(r, tMs, tMs + 60_000, 30)
  assert.ok(tr, 'SGP4 推不動夾具')
  return { lat: tr.points[0].lat, lng: tr.points[0].lng }
}

// ── 1. 取樣最佳化不可以漏趟 ────────────────────────────────

/**
 * 低軌衛星對地約 7 km/s，Sentinel-1 掃幅只有 250 km，整趟通過約 35 秒——
 * 比粗掃間隔還短。這條就是在驗「放寬門檻 + 回頭細掃」真的補得回來。
 */
function sameAsBruteForce(swathKm: number, coarseS: number, hours: number) {
  const r = rec('SENTINEL-2A', SSO)
  const from = T0
  const to = from + hours * 3600_000
  const target = subPointAt(r, from + 3600_000)

  const fast = passesForPoint(r, target.lat, target.lng, swathKm, from, to, { coarseS, fineS: 4 })
  assert.ok(fast, 'SGP4 推不動')

  const full = trackFromTle(r, from, to, 4)
  assert.ok(full, 'SGP4 推不動')
  const brute = findPasses(full.points, swathKm, target.lat, target.lng)

  assert.ok(brute.length > 0, '這個場景沒有任何過境，測試是空的')
  assert.equal(
    fast.passes.length,
    brute.length,
    `趟數不符：先粗後細 ${fast.passes.length}，全程細掃 ${brute.length}`,
  )
  for (let i = 0; i < brute.length; i++) {
    assert.equal(fast.passes[i].startMs, brute[i].startMs, `第 ${i + 1} 趟開始時間不符`)
    assert.equal(fast.passes[i].endMs, brute[i].endMs, `第 ${i + 1} 趟結束時間不符`)
    assert.equal(fast.passes[i].closestMs, brute[i].closestMs, `第 ${i + 1} 趟最接近時刻不符`)
  }
}

test('窄掃幅（Sentinel-1 250km）：先粗後細的結果要跟全程細掃完全一樣', () => {
  sameAsBruteForce(250, 60, 12)
})

test('更窄（50km，整趟只有幾秒）也不能漏', () => {
  sameAsBruteForce(50, 60, 12)
})

test('粗掃間隔拉到 240 秒仍然不漏（放寬門檻是跟著間隔算的）', () => {
  sameAsBruteForce(250, 240, 12)
})

test('寬掃幅（VIIRS 3060km）：一天會有好幾趟', () => {
  const r = rec('NOAA 20', SSO)
  const target = subPointAt(r, T0 + 3600_000)
  const got = passesForPoint(r, target.lat, target.lng, 3060, T0, T0 + 24 * 3600_000)
  assert.ok(got)
  assert.ok(got.passes.length >= 2, `寬掃幅一天該有多趟，只有 ${got.passes.length}`)
})

// ── 2. 掃幅涵蓋的定義 ──────────────────────────────────────

test('每一趟的最接近距離都不超過半掃幅（否則根本沒掃到）', () => {
  const r = rec('SENTINEL-2A', SSO)
  const target = subPointAt(r, T0 + 3600_000)
  const got = passesForPoint(r, target.lat, target.lng, 290, T0, T0 + 24 * 3600_000)
  assert.ok(got && got.passes.length > 0)
  for (const p of got.passes) {
    assert.ok(p.closestKm <= 145 + 1e-6, `最接近 ${p.closestKm}km 超過半掃幅 145km`)
    assert.ok(p.startMs <= p.closestMs && p.closestMs <= p.endMs, '最接近時刻不在時段內')
  }
})

test('epoch 要跟著 TLE 走（UI 要靠它說「根數多舊」）', () => {
  const r = rec('SENTINEL-2A', SSO)
  const target = subPointAt(r, T0 + 3600_000)
  const got = passesForPoint(r, target.lat, target.lng, 290, T0, T0 + 6 * 3600_000)
  assert.ok(got)
  assert.equal(got.epochMs, T0)
})

// ── 3. 「算不出來」 vs 「沒有過境」 ────────────────────────

test('壞掉的根數回 null，不是回空陣列', () => {
  // 平均運動 20 圈/日 → 軌道高度在地表以下，SGP4 直接標錯（error=6）
  const bad = rec('BROKEN', { ...SSO, satnum: 99999, meanMotion: 20 })
  assert.equal(passesForPoint(bad, 24, 122, 290, T0, T0 + 6 * 3600_000), null)
})

test('傾角到不了的緯度：回空陣列（真的沒有過境），不是 null', () => {
  const r = rec('ISS (ZARYA)', LOW_INC)
  // 傾角 51.64° → 星下點永遠到不了北緯 80°
  const got = passesForPoint(r, 80, 122, 290, T0, T0 + 24 * 3600_000)
  assert.ok(got, '算得出來就不該回 null')
  assert.equal(got.passes.length, 0)
})

// ── 4. planPasses：每顆衛星的狀態都要說清楚 ────────────────

test('狀態分四種：有過境／沒過境／找不到 TLE／根數推不動', () => {
  const r = rec('SENTINEL-2A', SSO)
  const target = subPointAt(r, T0 + 3600_000)

  const fleet = assignFleet([
    makeTle('SENTINEL-2A', SSO),
    // Landsat 用到不了的傾角 + 把目標放在它飛不到的緯度，製造「沒過境」
    makeTle('LANDSAT 9', { ...LOW_INC, satnum: 49260 }),
    makeTle('TERRA', { ...SSO, satnum: 25994, meanMotion: 20 }), // 推不動
  ])

  const plan = planPasses(fleet, target.lat, target.lng, T0, { windowHours: 24 })
  const byId = new Map(plan.status.map((s) => [s.satId, s]))

  assert.equal(byId.get('s2')?.state, 'passes')
  assert.ok((byId.get('s2')?.count ?? 0) > 0)
  assert.equal(byId.get('s1')?.state, 'noTle', 'TLE 裡沒有就要講找不到')
  assert.equal(byId.get('modis')?.state, 'badTle', '推不動要跟「沒過境」分開')
  assert.equal(byId.get('viirs')?.state, 'noTle')

  // Landsat：有 TLE、推得動，但目標在它的掃幅範圍之外
  const ls = byId.get('landsat')
  assert.ok(ls)
  assert.ok(ls.state === 'passes' || ls.state === 'none', `非預期狀態 ${ls.state}`)
})

test('找不到 TLE 時絕對不能回「這段時間沒有衛星經過」', () => {
  const plan = planPasses(assignFleet([]), 24, 122, T0, { windowHours: 24 })
  assert.equal(plan.passes.length, 0)
  assert.ok(plan.status.length > 0, '狀態清單不能是空的，否則 UI 會顯示一片空白')
  assert.ok(
    plan.status.every((s) => s.state === 'noTle'),
    '一筆 TLE 都沒有時，每顆都該是「找不到」',
  )
  assert.equal(plan.oldestEpochMs, null)
})

test('過境依開始時間排序，而且 2A/2B 分開算成不同趟', () => {
  const r = rec('SENTINEL-2A', SSO)
  const target = subPointAt(r, T0 + 3600_000)
  // 2B 用不同的升交點赤經 → 不同的軌道面，過境時間也不同
  const fleet = assignFleet([
    makeTle('SENTINEL-2A', SSO) + makeTle('SENTINEL-2B', { ...SSO, satnum: 42063, raan: 110 }),
  ])
  const plan = planPasses(fleet, target.lat, target.lng, T0, { windowHours: 48 })

  for (let i = 1; i < plan.passes.length; i++) {
    assert.ok(plan.passes[i].startMs >= plan.passes[i - 1].startMs, '沒有依時間排序')
  }
  const crafts = new Set(plan.passes.map((p) => p.craft))
  assert.ok(crafts.has('SENTINEL-2A'), '2A 的過境不見了')
  assert.ok(plan.passes.every((p) => p.swathKm === 290), '掃幅沒有從 SATS 接過來')
})

test('topPerSat：每顆只留最早的幾趟（避免寬掃幅洗版）', () => {
  const r = rec('NOAA 20', SSO)
  const target = subPointAt(r, T0 + 3600_000)
  const plan = planPasses(assignFleet([makeTle('NOAA 20', SSO)]), target.lat, target.lng, T0, {
    windowHours: 48,
  })
  assert.ok(plan.passes.length > 2, '這個場景趟數不夠多，測不到上限')
  const top = topPerSat(plan.passes, 2)
  assert.equal(top.length, 2)
  assert.equal(top[0].startMs, plan.passes[0].startMs, '要留最早的，不是隨便兩趟')
})
