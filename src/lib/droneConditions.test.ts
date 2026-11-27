import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  assessHour,
  daylightWindow,
  droneWeatherUrl,
  kpLevel,
  kpSummary,
  lowTraffic,
  parseDroneWeather,
  parseKp,
  trafficLevel,
  type DroneHour,
} from './droneConditions.ts'

const NOW = Date.parse('2026-11-27T04:20:00Z') // 台灣 12:20

test('Open-Meteo 網址：10／80／120 公尺風、m/s、GMT', () => {
  const u = droneWeatherUrl(25.07771, 121.23281)
  assert.match(u, /latitude=25\.078&longitude=121\.233/)
  assert.match(u, /wind_speed_120m/)
  assert.match(u, /wind_speed_unit=ms/)
  assert.match(u, /timezone=GMT/)
})

test('解析天氣：從現在這一小時開始；時間沒帶 Z 當 UTC；120 公尺缺了用 80 公尺頂；壞資料回 null', () => {
  const j = {
    hourly: {
      time: ['2026-11-27T03:00', '2026-11-27T04:00', '2026-11-27T05:00', '2026-11-27T06:00'],
      wind_speed_10m: [3, 4, 5, null],
      wind_speed_80m: [5, 6, 7, 8],
      wind_speed_120m: [6, null, 9, 10],
      wind_direction_10m: [30, 40, 50, 60],
      wind_gusts_10m: [7, 8, 9, 10],
      precipitation_probability: [0, 10, 60, 0],
      precipitation: [0, 0, 0.2, 0],
      visibility: [24000, 20000, 2500, 30000],
      temperature_2m: [20, 21, 22, 23],
    },
  }
  const h = parseDroneWeather(j, NOW)!
  assert.equal(h.length, 2, '03:00 已經過了、06:00 缺地面風')
  assert.equal(h[0].t, Date.parse('2026-11-27T04:00:00Z'))
  assert.equal(h[0].wind120, 6, '120 公尺缺 → 用 80 公尺')
  assert.equal(h[1].vis, 2500)
  assert.equal(parseDroneWeather({ hourly: {} }, NOW), null)
  assert.equal(parseDroneWeather(null, NOW), null)
})

const hour = (o: Partial<DroneHour> = {}): DroneHour => ({
  t: NOW,
  wind10: 3,
  wind80: 4,
  wind120: 5,
  dir10: 0,
  gust: 6,
  pop: 0,
  precip: 0,
  vis: 20000,
  temp: 22,
  ...o,
})

test('天氣判定：風取三個高度最大、照抗風上限；陣風、降雨、能見度、氣溫', () => {
  assert.deepEqual(assessHour(hour()), { level: 'ok', reasons: [] })
  const up = assessHour(hour({ wind120: 12.5 }))
  assert.equal(up.level, 'no')
  assert.match(up.reasons[0], /120 公尺風 12\.5 m\/s，超過抗風上限 12/)
  assert.equal(assessHour(hour({ wind120: 12.5 }), 15).level, 'caution', '工業級機型 15 m/s 只是接近')
  assert.equal(assessHour(hour({ wind80: 9 })).level, 'caution')
  assert.equal(assessHour(hour({ gust: 16 })).level, 'no')
  assert.equal(assessHour(hour({ precip: 1.2 })).level, 'no')
  assert.equal(assessHour(hour({ pop: 70 })).level, 'caution')
  assert.equal(assessHour(hour({ vis: 800 })).level, 'no')
  assert.equal(assessHour(hour({ vis: 2000 })).level, 'caution')
  assert.equal(assessHour(hour({ vis: null })).level, 'ok', '沒有能見度資料不當成問題')
  assert.equal(assessHour(hour({ temp: -2 })).level, 'caution')
})

test('Kp：新版物件格式、舊版陣列格式都吃；時間當 UTC；排序', () => {
  const obj = [
    { time_tag: '2026-11-27T03:00:00', kp: 2.33, observed: 'estimated', noaa_scale: null },
    { time_tag: '2026-11-27T00:00:00', kp: 1, observed: 'observed', noaa_scale: null },
    { time_tag: '2026-11-27T06:00:00', kp: 5.67, observed: 'predicted', noaa_scale: 'G2' },
  ]
  const p = parseKp(obj)!
  assert.deepEqual(p.map((x) => x.kind), ['observed', 'estimated', 'predicted'])
  assert.equal(p[0].t, Date.parse('2026-11-27T00:00:00Z'))
  const legacy = [
    ['time_tag', 'kp', 'observed', 'noaa_scale'],
    ['2026-11-27 00:00:00', '1.00', 'observed', null],
  ]
  assert.equal(parseKp(legacy)![0].kp, 1)
  assert.equal(parseKp({}), null)
  const s = kpSummary(p, NOW)
  assert.equal(s.now!.kp, 2.33, '現在 04:20 落在 03:00 那一格')
  assert.equal(s.max24, 5.67)
  assert.equal(kpLevel(3.67), 'ok')
  assert.equal(kpLevel(4), 'caution')
  assert.equal(kpLevel(5.33), 'no')
})

test('低空有人機：5 浬內、3000 呎以下（高度不明也算）、在地面不算；近的在前、方位對', () => {
  const lat = 25
  const lng = 121
  const nm = (n: number) => n / 60 // 緯度 1 分 ≈ 1 浬
  const list = lowTraffic(
    [
      { name: 'HELI', lat: lat + nm(1.5), lng, altFt: 800, onGround: false, heli: true, emergency: false },
      { name: 'HIGH', lat: lat + nm(1), lng, altFt: 35000, onGround: false, heli: false, emergency: false },
      { name: 'GROUND', lat: lat + nm(0.2), lng, altFt: null, onGround: true, heli: false, emergency: false },
      { name: 'FAR', lat: lat + nm(8), lng, altFt: 1000, onGround: false, heli: false, emergency: false },
      { name: 'NOALT', lat: lat - nm(3), lng, altFt: null, onGround: false, heli: false, emergency: false },
    ],
    lat,
    lng,
  )
  assert.deepEqual(list.map((x) => x.name), ['HELI', 'NOALT'])
  assert.ok(Math.abs(list[0].distNm - 1.5) < 0.02)
  assert.ok(list[0].bearing < 1 || list[0].bearing > 359, '正北')
  assert.ok(Math.abs(list[1].bearing - 180) < 1, '正南')
  assert.equal(trafficLevel(list), 'no', '2 浬內有直升機')
  assert.equal(trafficLevel(list.slice(1)), 'caution')
  assert.equal(trafficLevel([]), 'ok')
})

test('日出到日落：法規時段；日落前 30 分鐘提醒收機', () => {
  const rise = new Date('2026-11-26T22:11:00Z') // 台灣 06:11
  const set = new Date('2026-11-27T09:07:00Z') // 台灣 17:07
  assert.equal(daylightWindow(Date.parse('2026-11-26T21:00:00Z'), rise, set).level, 'no')
  const noon = daylightWindow(NOW, rise, set)
  assert.equal(noon.level, 'ok')
  assert.match(noon.text, /離日落還有 4 小時 47 分（可飛時段 06:11–17:07）/)
  const late = daylightWindow(Date.parse('2026-11-27T08:50:00Z'), rise, set)
  assert.equal(late.level, 'caution')
  assert.match(late.text, /只剩 17 分/)
  assert.match(daylightWindow(Date.parse('2026-11-27T10:00:00Z'), rise, set).text, /已經日落/)
  assert.equal(daylightWindow(NOW, null, null).level, 'caution')
})
