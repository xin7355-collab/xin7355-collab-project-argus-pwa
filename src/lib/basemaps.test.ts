// 底圖樣式的測試。
//
// 這些數字（maxNativeZoom、哪一層要藏什麼）是在 GitHub Actions 上打真的伺服器
// 實測出來的。測試的作用是：哪天有人「順手」把暗灰改回 z19、把海洋底圖改到 z15，
// 這裡會擋下來——那樣改會讓放大後整片變成「Map data not yet available」。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BASE_STYLES,
  MAIN_STYLES,
  MORE_STYLES,
  DEFAULT_BASE,
  NLSC_BOUNDS,
  migrateBaseId,
  resolveStoredBase,
  fillTemplate,
  specActiveAt,
  type BaseLayerId,
} from './basemaps.ts'

const ALL = Object.keys(BASE_STYLES) as BaseLayerId[]

test('預設是詳細地圖，不是舊的暗灰（使用者抱怨的根源）', () => {
  assert.equal(DEFAULT_BASE, 'street')
})

test('每個樣式的 id 跟 key 一致，切換清單沒有漏也沒有重複', () => {
  for (const id of ALL) assert.equal(BASE_STYLES[id].id, id)
  const listed = [...MAIN_STYLES, ...MORE_STYLES]
  assert.equal(new Set(listed).size, listed.length, '清單有重複')
  assert.deepEqual([...listed].sort(), [...ALL].sort(), '有樣式沒出現在切換清單裡')
})

test('不需要金鑰的樣式至少要有一層圖磚', () => {
  for (const id of ALL) {
    const s = BASE_STYLES[id]
    if (!s.needsKey) assert.ok(s.layers.length > 0, `${id} 沒有任何圖層`)
  }
})

test('實測上限：暗灰最多 z16、海洋底圖最多 z10（再高全是佔位圖）', () => {
  assert.ok(BASE_STYLES.dark.layers[0].maxNativeZoom <= 16)
  for (const l of BASE_STYLES.ocean.layers) assert.ok(l.maxNativeZoom <= 10)
})

test('會藏圖磚的層，網址都是實測有 CORS 的主機（否則讀不到像素，規則會失效）', () => {
  for (const id of ALL) {
    for (const l of BASE_STYLES[id].layers) {
      if (!l.hide) continue
      assert.ok(
        /^https:\/\/(server\.arcgisonline\.com|wmts\.nlsc\.gov\.tw)\//.test(l.url),
        `${id} 的 ${l.url} 沒實測過 CORS`,
      )
    }
  }
})

test('國土測繪中心的層都限定範圍，不去請求一定沒圖的地方', () => {
  for (const id of ALL) {
    for (const l of BASE_STYLES[id].layers) {
      if (l.url.includes('wmts.nlsc.gov.tw')) assert.deepEqual(l.bounds, NLSC_BOUNDS)
    }
  }
})

test('範圍框要包到金門、馬祖、東沙、蘭嶼', () => {
  const inside = (lat: number, lng: number) =>
    lat >= NLSC_BOUNDS[0][0] && lat <= NLSC_BOUNDS[1][0] && lng >= NLSC_BOUNDS[0][1] && lng <= NLSC_BOUNDS[1][1]
  assert.ok(inside(24.43, 118.32), '金門')
  assert.ok(inside(26.16, 119.95), '馬祖')
  assert.ok(inside(20.7, 116.72), '東沙')
  assert.ok(inside(22.05, 121.55), '蘭嶼')
})

test('衛星樣式：英文地名拉遠才顯示、中文地名放大才顯示，兩層不會同時出現', () => {
  const [, , en, zh] = BASE_STYLES.hybrid.layers
  assert.ok(en.url.includes('Boundaries_and_Places'))
  assert.ok(zh.url.includes('EMAP12'))
  assert.ok(en.maxZoom !== undefined && zh.minZoom !== undefined)
  assert.equal(zh.minZoom, en.maxZoom + 1)
})

test('衛星樣式的最底層是外海也有圖的 EOX（Esri 外海 z14 以上會回佔位圖）', () => {
  assert.ok(BASE_STYLES.hybrid.layers[0].url.includes('eox.at'))
})

test('舊版存的 id 對應到新樣式；舊預設 dark 要換成新預設', () => {
  assert.equal(migrateBaseId('dark'), 'street', '舊預設原樣保留＝改版沒感覺')
  assert.equal(migrateBaseId('nlsc'), 'street')
  assert.equal(migrateBaseId('nlscPhoto'), 'hybrid')
  assert.equal(migrateBaseId('esri'), 'hybrid')
  assert.equal(migrateBaseId('satColor'), 'satColor')
  assert.equal(migrateBaseId('sentinel1'), 'sentinel1')
  assert.equal(migrateBaseId(null), 'street')
  assert.equal(migrateBaseId('亂打的'), 'street')
})

test('樣板網址填得出跟 Leaflet 一樣的網址（離線快取才命中）', () => {
  const u = fillTemplate(BASE_STYLES.street.layers[0].url, 15, 27423, 14030)
  assert.equal(
    u,
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/15/14030/27423',
  )
  const e = fillTemplate(BASE_STYLES.hybrid.layers[0].url, 12, 3, 4)
  assert.match(e, /TileMatrix=12&TileCol=3&TileRow=4/)
})

test('離線下載只抓會用到的層：範圍外、層級外都不抓', () => {
  const [esri, nlsc] = BASE_STYLES.street.layers
  assert.equal(specActiveAt(nlsc, 15, 25.03, 121.56), true, '台北要抓 NLSC')
  assert.equal(specActiveAt(nlsc, 15, 1.26, 103.82), false, '新加坡不抓 NLSC')
  assert.equal(specActiveAt(esri, 15, 1.26, 103.82), true)
  const zh = BASE_STYLES.hybrid.layers[3]
  assert.equal(specActiveAt(zh, 12, 25.03, 121.56), false, '中文層 z14 起才顯示')
  assert.equal(specActiveAt(BASE_STYLES.dark.layers[0], 18, 25, 121), false, '超過原生層級不會被請求')
})

test('改版後使用者自己選的「夜間」要記住，不能下次開又被換回地圖', () => {
  assert.equal(resolveStoredBase('dark', null), 'dark')
  assert.equal(resolveStoredBase('dark', 'dark'), 'dark', '新鍵優先')
  assert.equal(resolveStoredBase(null, 'dark'), 'street', '只有舊鍵的 dark 才換掉')
  assert.equal(resolveStoredBase(null, 'nlscPhoto'), 'hybrid')
  assert.equal(resolveStoredBase('壞掉的值', 'esri'), 'hybrid', '新鍵壞掉就看舊鍵')
  assert.equal(resolveStoredBase(null, null), 'street')
})

// 離線下載的網址必須跟 Leaflet 顯示時請求的一字不差，否則下載了也用不到
import { urlsForStyle, tilesForBounds } from './offlineMap.ts'

test('離線下載：超過原生層級時改抓原生層級那一張（Leaflet 顯示時用的是它）', () => {
  // 暗色原生只到 z16；在 z18 下載要抓的是 z16 的父圖磚
  const urls = urlsForStyle(BASE_STYLES.dark, [{ z: 18, x: 219392, y: 112240 }])
  assert.equal(urls.length, 1)
  assert.match(urls[0], /\/tile\/16\/28060\/54848$/)
})

test('離線下載：同一張父圖磚只抓一次', () => {
  // 四張 z17 的兄弟圖磚，在 z16 是同一張父圖磚
  const kids = [
    { z: 17, x: 2, y: 2 }, { z: 17, x: 3, y: 2 }, { z: 17, x: 2, y: 3 }, { z: 17, x: 3, y: 3 },
  ]
  assert.equal(urlsForStyle(BASE_STYLES.dark, kids).length, 1)
})

test('離線下載：台北抓兩家（Esri＋國土測繪中心），新加坡只抓 Esri', () => {
  const taipei = tilesForBounds({ west: 121.55, south: 25.02, east: 121.56, north: 25.03 }, 15, 15)
  const tpe = urlsForStyle(BASE_STYLES.street, taipei)
  assert.ok(tpe.some((u) => u.includes('arcgisonline')))
  assert.ok(tpe.some((u) => u.includes('nlsc')))
  const sg = tilesForBounds({ west: 103.82, south: 1.26, east: 103.83, north: 1.27 }, 15, 15)
  const sgu = urlsForStyle(BASE_STYLES.street, sg)
  assert.ok(sgu.every((u) => !u.includes('nlsc')), '新加坡不該去抓國土測繪中心')
})

test('離線下載：要金鑰的動態影像沒有固定圖磚，回空清單（UI 要講清楚，不是默默沒事）', () => {
  assert.deepEqual(urlsForStyle(BASE_STYLES.sentinel2, [{ z: 10, x: 1, y: 1 }]), [])
})
