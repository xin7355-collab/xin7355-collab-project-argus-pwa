import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  coversPoint,
  findPasses,
  groundTrack,
  nearestApproach,
  splitAtDateline,
  subPointAt,
  swathEdges,
  wrapLng,
  type OrbitAnchor,
  type TrackPoint,
} from './groundTrack.ts'
import { destPoint, distanceKm } from './windRadar.ts'

/** 太陽同步軌道（Sentinel-2 級）：傾角 98.6°、週期 100 分鐘。 */
const SUNSYNC: OrbitAnchor = {
  at: 0, lat: 0, lng: 120, inclinationDeg: 98.6, periodMin: 100, ascending: true,
}

test('經度收斂：跨換日線不能跑出範圍', () => {
  assert.equal(wrapLng(190), -170)
  assert.equal(wrapLng(-190), 170)
  assert.equal(wrapLng(0), 0)
  assert.equal(wrapLng(540), 180, '剛好 180 要留在 180，不要翻成 -180')
})

test('錨點當下回傳的就是錨點本身', () => {
  const p = subPointAt(SUNSYNC, 0)
  assert.ok(Math.abs(p.lat - 0) < 1e-6, `緯度 ${p.lat}`)
  assert.ok(Math.abs(p.lng - 120) < 1e-6, `經度 ${p.lng}`)
})

test('上升段往北飛，最高只到「180 − 傾角」的緯度', () => {
  // 傾角 98.6 的逆行軌道，最北到 180−98.6 = 81.4°N
  let maxLat = -90
  for (let t = 0; t <= 100 * 60 * 1000; t += 30000) {
    maxLat = Math.max(maxLat, subPointAt(SUNSYNC, t).lat)
  }
  assert.ok(Math.abs(maxLat - 81.4) < 0.5, `最高緯度應約 81.4°，實際 ${maxLat.toFixed(2)}`)
  // 錨點後一小段確實往北
  assert.ok(subPointAt(SUNSYNC, 60000).lat > 0, '上升段 1 分鐘後要在北半球')
})

test('下降段往南飛', () => {
  const desc = { ...SUNSYNC, ascending: false }
  assert.ok(subPointAt(desc, 60000).lat < 0, '下降段 1 分鐘後要往南')
})

test('繞一圈之後，軌跡因地球自轉往西移', () => {
  const periodMs = SUNSYNC.periodMin * 60 * 1000
  const after = subPointAt(SUNSYNC, periodMs)
  assert.ok(Math.abs(after.lat) < 0.5, `繞一整圈應回到赤道附近，實際 ${after.lat.toFixed(2)}`)
  // 100 分鐘 × 360° / 恆星日 ≈ 25.07°，往西（經度變小）
  const drift = SUNSYNC.lng - after.lng
  assert.ok(Math.abs(drift - 25.07) < 0.2, `西移應約 25.07°，實際 ${drift.toFixed(2)}`)
})

test('用恆星日而非太陽日：差異要看得出來（否則一圈就差 0.35°）', () => {
  const periodMs = SUNSYNC.periodMin * 60 * 1000
  const drift = SUNSYNC.lng - subPointAt(SUNSYNC, periodMs).lng
  const solarDayDrift = (360 * (periodMs / 1000)) / 86400 // 用錯的話會是這個
  assert.ok(
    Math.abs(drift - solarDayDrift) > 0.05,
    `恆星日(${drift.toFixed(3)}) 與太陽日(${solarDayDrift.toFixed(3)}) 要有可辨差異`,
  )
})

test('ISS 傾角 51.6：緯度上限約 51.6，不會飛到極區', () => {
  const iss: OrbitAnchor = {
    at: 0, lat: 0, lng: 0, inclinationDeg: 51.6, periodMin: 93, ascending: true,
  }
  let maxLat = -90
  for (let t = 0; t <= 93 * 60 * 1000; t += 30000) maxLat = Math.max(maxLat, subPointAt(iss, t).lat)
  assert.ok(Math.abs(maxLat - 51.6) < 0.5, `最高緯度應約 51.6°，實際 ${maxLat.toFixed(2)}`)
})

test('軌跡取樣：點數與時間範圍相符，且經度都在合法範圍', () => {
  const tr = groundTrack(SUNSYNC, 0, 600_000, 20)
  assert.equal(tr.length, 31, '0..600s 每 20 秒一點 = 31 點')
  for (const p of tr) {
    assert.ok(p.lng > -180 && p.lng <= 180, `經度超界：${p.lng}`)
    assert.ok(p.lat >= -90 && p.lat <= 90, `緯度超界：${p.lat}`)
  }
})

test('換日線要切段，不能畫出橫貫地圖的假線', () => {
  const fake = [
    { lat: 0, lng: 170, at: 0 },
    { lat: 1, lng: 179, at: 1 },
    { lat: 2, lng: -179, at: 2 }, // 跨線
    { lat: 3, lng: -170, at: 3 },
  ]
  const segs = splitAtDateline(fake)
  assert.equal(segs.length, 2, '應切成兩段')
  assert.equal(segs[0].length, 2)
  assert.equal(segs[1].length, 2)
  for (const s of segs) {
    for (let i = 1; i < s.length; i++) {
      assert.ok(Math.abs(s[i].lng - s[i - 1].lng) < 180, '段內不得有跨線跳躍')
    }
  }
})

test('掃幅邊界：左右各離軌跡半個掃幅寬，且兩側加起來等於掃幅', () => {
  const tr = groundTrack(SUNSYNC, 0, 300_000, 30)
  const swathKm = 290 // Sentinel-2 掃幅
  const { left, right } = swathEdges(tr, swathKm)
  assert.ok(left.length > 2 && right.length > 2, '兩側都要有點')

  // 取中段一點，量它到左右邊界的距離
  const mid = Math.floor(left.length / 2)
  const p = tr[mid] // left[k] 對應 tr[k]（a===b 只在軌跡只有一點時成立，不會略過）
  const dl = distanceKm(p.lat, p.lng, left[mid][0], left[mid][1])
  // right 已反轉，對應索引要從尾端算
  const r = right[right.length - 1 - mid]
  const dr = distanceKm(p.lat, p.lng, r[0], r[1])
  assert.ok(Math.abs(dl - swathKm / 2) < 5, `左緣應距軌跡 ${swathKm / 2}km，實際 ${dl.toFixed(1)}`)
  assert.ok(Math.abs(dr - swathKm / 2) < 5, `右緣應距軌跡 ${swathKm / 2}km，實際 ${dr.toFixed(1)}`)
})

test('掃不掃得到：正下方一定掃得到，掃幅外一定掃不到', () => {
  const tr = groundTrack(SUNSYNC, 0, 600_000, 20)
  const onTrack = tr[10]
  const hit = coversPoint(tr, 290, onTrack.lat, onTrack.lng)
  assert.ok(hit?.covered, '軌跡正下方必須判為掃得到')
  assert.ok(hit!.km < 1, `正下方距離應趨近 0，實際 ${hit!.km}`)

  // 往旁邊挪 400km（遠大於半掃幅 145km）
  const [flat, flng] = destPoint(onTrack.lat, onTrack.lng, 90, 400)
  const miss = coversPoint(tr, 290, flat, flng)
  assert.equal(miss?.covered, false, '離軌跡 400km 不該判為掃得到')
})

test('最近接近點會回報時刻，才知道「幾點掃到」', () => {
  const tr = groundTrack(SUNSYNC, 1_000_000, 1_600_000, 20)
  const target = tr[15]
  const near = nearestApproach(tr, target.lat, target.lng)
  assert.ok(near)
  assert.equal(near.at, target.at, '最近點的時刻要對得上')
})

test('空軌跡不能炸，要回 null', () => {
  assert.equal(nearestApproach([], 0, 0), null)
  assert.equal(coversPoint([], 290, 0, 0), null)
})

test('找過境時段：掃得到就給起訖與最接近時刻', () => {
  const tr = groundTrack(SUNSYNC, 0, 600_000, 20)
  const target = tr[12]
  const passes = findPasses(tr, 290, target.lat, target.lng)
  assert.equal(passes.length, 1, '這段軌跡只會經過一次')
  const p = passes[0]
  assert.ok(p.startMs <= target.at && target.at <= p.endMs, '目標時刻要落在時段內')
  assert.ok(p.closestKm < 1, `最接近應趨近 0，實際 ${p.closestKm.toFixed(1)}`)
  assert.equal(p.closestMs, target.at)
  assert.ok(p.endMs > p.startMs, '時段要有長度')
})

test('找過境時段：掃不到就是空陣列，不要硬給一筆', () => {
  const tr = groundTrack(SUNSYNC, 0, 600_000, 20)
  // 挪到地球另一側
  assert.deepEqual(findPasses(tr, 290, -SUNSYNC.lat, SUNSYNC.lng - 120), [])
})

test('找過境時段：掃幅越寬，時段越長（物理上必然）', () => {
  const tr = groundTrack(SUNSYNC, 0, 600_000, 20)
  const t = tr[12]
  const narrow = findPasses(tr, 100, t.lat, t.lng)[0]
  const wide = findPasses(tr, 1000, t.lat, t.lng)[0]
  assert.ok(wide.endMs - wide.startMs > narrow.endMs - narrow.startMs)
})

test('找過境時段：同一段軌跡經過兩次要分成兩筆，不能併成一大段', () => {
  // 造一條「靠近→遠離→再靠近」的假軌跡
  const fake: TrackPoint[] = [
    { lat: 24.0, lng: 122, at: 0 },
    { lat: 24.5, lng: 122, at: 1000 }, // 近
    { lat: 30.0, lng: 122, at: 2000 }, // 遠
    { lat: 24.5, lng: 122, at: 3000 }, // 又近
  ]
  const passes = findPasses(fake, 200, 24.5, 122)
  assert.equal(passes.length, 2, '中間離開過就要切成兩筆')
  assert.ok(passes[0].endMs < passes[1].startMs)
})
