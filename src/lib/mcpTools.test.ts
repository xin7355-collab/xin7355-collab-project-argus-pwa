import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TOOL_BY_NAME, ToolInputError, greatCircle, type ToolDeps } from './mcpTools.ts'

const run = async (name: string, args: Record<string, unknown>, deps: ToolDeps = {}) => {
  const t = TOOL_BY_NAME.get(name)
  assert.ok(t, name)
  return t.run(args, deps)
}

test('大圓距離與方位：緯度 1 度約 60 浬、正北；往東是 090', () => {
  const n = greatCircle({ lat: 24, lng: 121 }, { lat: 25, lng: 121 })
  assert.ok(Math.abs(n.nm - 60.04) < 0.05, String(n.nm))
  assert.ok(Math.abs(n.bearing) < 1e-6)
  assert.ok(Math.abs(greatCircle({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }).bearing - 90) < 1e-6)
})

test('座標換算：度分寫法 → 十進位', async () => {
  const r = await run('parse_position', { text: "25°07.8'N 121°44.5'E" })
  const s = r.structured as { lat: number; lng: number }
  assert.ok(Math.abs(s.lat - 25.13) < 1e-6 && Math.abs(s.lng - 121.741667) < 1e-5)
  assert.match(r.text, /十進位：.*25\.13/)
})

test('推算船位：往東 10 節 1 小時；負的分鐘是回推', async () => {
  const r = await run('dead_reckoning', { start: '24, 121', course_deg: 90, speed_kn: 10, minutes: 60 })
  const s = r.structured as { lat: number; lng: number; runNm: number }
  assert.ok(Math.abs(s.lng - (121 + 10 / (60 * Math.cos((24 * Math.PI) / 180)))) < 1e-9)
  assert.equal(s.runNm, 10)
  const back = await run('dead_reckoning', { start: '24, 121', course_deg: 0, speed_kn: 6, minutes: -30 })
  assert.ok(Math.abs((back.structured as { lat: number }).lat - (24 - 3 / 60)) < 1e-9)
  assert.match(back.text, /30 分鐘前/)
})

test('攔截：追得上給航向與時間；太慢說追不上', async () => {
  const ok = await run('intercept_course', { own: '24, 121', own_speed_kn: 20, target: '24, 121.2', target_course_deg: 0, target_speed_kn: 10 })
  assert.match(ok.text, /^操 0\d\d°，約 \d+ 分鐘追上/)
  const slow = await run('intercept_course', { own: '24, 121', own_speed_kn: 2, target: '24.1, 121', target_course_deg: 0, target_speed_kn: 15 })
  assert.match(slow.text, /^追不上/)
})

test('視距：雷達 10 公尺天線約 13 公里（7 浬）；目視用 App 同一個公式', async () => {
  const r = await run('horizon_range', { antenna_height_m: 10 })
  assert.ok(Math.abs((r.structured as { km: number }).km - 13.03) < 0.05)
  const o = await run('horizon_range', { kind: 'optical', antenna_height_m: 4, target_height_m: 9 })
  assert.ok(Math.abs((o.structured as { km: number }).km - 4.12 * 5) < 1e-9)
  await assert.rejects(Promise.resolve().then(() => run('horizon_range', { kind: 'sonar', antenna_height_m: 1 })), (e: unknown) => e instanceof ToolInputError)
})

test('日月：台北夏至日出約 05:0x、日落約 18:4x（台灣時間）', async () => {
  const r = await run('sun_moon', { position: '25.04, 121.56', date: '2026-06-21' })
  const sunrise = r.text.match(/日出 (\d\d):(\d\d)/)
  const sunset = r.text.match(/日落 (\d\d):(\d\d)/)
  assert.ok(sunrise && sunset, r.text)
  const mins = (m: RegExpMatchArray) => Number(m[1]) * 60 + Number(m[2])
  assert.ok(mins(sunrise) >= 4 * 60 + 58 && mins(sunrise) <= 5 * 60 + 10, sunrise[0])
  assert.ok(mins(sunset) >= 18 * 60 + 40 && mins(sunset) <= 18 * 60 + 52, sunset[0])
  assert.match(r.text, /照明 \d+%/)
  await assert.rejects(Promise.resolve().then(() => run('sun_moon', { position: '25, 121', date: '2026/06/21' })), /YYYY-MM-DD/)
})

test('日月：沒給日期就用「當地今天」（注入的時鐘）', async () => {
  // UTC 2026-11-15 20:00 = 台灣 11/16 04:00
  const r = await run('sun_moon', { position: '25, 121' }, { now: () => new Date('2026-11-15T20:00:00Z') })
  assert.match(r.text, /^2026-11-16（UTC\+8）/)
})

test('搜索航線：1 浬半徑、0.5 浬間距 → 5 條腿、10 個航點', async () => {
  const r = await run('search_pattern', { center: '24, 121', radius_nm: 1, spacing_nm: 0.5 })
  const s = r.structured as { legs: number; waypoints: unknown[]; lengthNm: number }
  assert.equal(s.legs, 5)
  assert.equal(s.waypoints.length, 10)
  assert.ok(s.lengthNm > 9 && s.lengthNm < 12, String(s.lengthNm))
})

test('附近飛機：只列半徑內、緊急的排最前、其餘照距離、標出軍機、註明 ODbL', async () => {
  const deps: ToolDeps = {
    fetchAdsb: async (a) => {
      assert.equal(a.dist, 50)
      return {
        ageSec: 3,
        stale: false,
        ac: [
          { hex: '899111', flight: 'FAR1', lat: 26.5, lon: 121, alt_baro: 30000, seen_pos: 1 }, // 約 90 浬，超出
          { hex: '899222', flight: 'NEAR1', lat: 25.1, lon: 121, alt_baro: 2000, gs: 120, seen_pos: 1 },
          { hex: '899333', flight: 'SOS1', lat: 25.3, lon: 121, alt_baro: 1500, squawk: '7700', seen_pos: 1 },
          { hex: 'ae0001', flight: 'MIL1', lat: 25.5, lon: 121, alt_baro: 20000, dbFlags: 1, seen_pos: 1 },
        ],
      }
    },
  }
  const r = await run('nearby_aircraft', { position: '25, 121', radius_nm: 40 }, deps)
  assert.match(r.text, /^40 浬內 3 架，其中 1 架發緊急/)
  const lines = r.text.split('\n')
  assert.match(lines[1], /^SOS1/, '發緊急的排第一，就算比較遠')
  assert.match(lines[2], /^NEAR1/)
  assert.match(r.text, /SOS1.*詢答碼 7700/)
  assert.match(r.text, /MIL1.*軍機/)
  assert.match(r.text, /ODbL/)
  assert.doesNotMatch(r.text, /FAR1/)
})

test('附近飛機：一架都沒有時講清楚「不代表沒有飛機」；沒接資料時不會假裝查過', async () => {
  const r = await run('nearby_aircraft', { position: '15, 130' }, { fetchAdsb: async () => ({ ac: [], ageSec: 1, stale: false }) })
  assert.match(r.text, /不代表天上沒有飛機/)
  await assert.rejects(Promise.resolve().then(() => run('nearby_aircraft', { position: '15, 130' })), /沒有接飛機資料/)
})
