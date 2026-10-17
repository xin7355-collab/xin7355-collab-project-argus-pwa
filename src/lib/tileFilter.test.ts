// 「沒資料圖磚」判斷的測試。
//
// 夾具的顏色是照 GitHub Actions 實測解碼的數值做的（不是自己編的），
// 見 tileFilter.ts 檔頭。重點是兩個方向都要對：
//   該藏的藏（不然空白蓋掉底下的地圖）
//   不該藏的絕對不能藏（不然把真的地圖弄不見——這個比前者嚴重）

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyTile,
  shouldHide,
  NLSC_EMAP_EMPTY,
  NLSC_PHOTO_EMPTY,
  type TileSample,
} from './tileFilter.ts'

const W = 16

/** 測試夾具一律用 Uint8ClampedArray，才能用 .set 畫字樣。 */
type Sample = TileSample & { data: Uint8ClampedArray }

function solid(r: number, g: number, b: number, a = 255): Sample {
  const data = new Uint8ClampedArray(W * W * 4)
  for (let i = 0; i < W * W; i++) data.set([r, g, b, a], i * 4)
  return { data, w: W, h: W }
}

/** 灰底中間一塊深灰字樣——Esri「Map data not yet available」的樣子。 */
function esriPlaceholder(): Sample {
  const s = solid(208, 208, 208)
  for (let y = 6; y < 10; y++) for (let x = 3; x < 13; x++) s.data.set([110, 110, 110, 255], (y * W + x) * 4)
  return s
}

/** 有紋理的真圖（街道、海岸線…）。 */
function real(seed = 1): Sample {
  const data = new Uint8ClampedArray(W * W * 4)
  let a = seed
  for (let i = 0; i < W * W; i++) {
    a = (a * 1103515245 + 12345) >>> 0
    const v = 120 + (a % 120)
    data.set([v, (v * 7) % 256, (v * 3) % 256, 255], i * 4)
  }
  return { data, w: W, h: W }
}

/** 單色但帶 JPEG 雜訊（±1）。 */
function nearlySolid(r: number, g: number, b: number): Sample {
  const s = solid(r, g, b)
  for (let i = 0; i < W * W; i += 7) s.data[i * 4] = r + ((i % 3) - 1)
  return s
}

const ESRI = { esriPlaceholder: true }
const EMAP = { flatColors: [NLSC_EMAP_EMPTY] }
const PHOTO = { flatColors: [NLSC_PHOTO_EMPTY] }

test('Esri 的「尚無資料」佔位圖要認得出來', () => {
  const c = classifyTile(esriPlaceholder())
  assert.equal(c.verdict, 'esriPlaceholder')
  assert.equal(shouldHide(c, ESRI), true)
})

test('就算取樣剛好沒踩到字樣（整張純灰），還是要認得出是佔位圖', () => {
  assert.equal(classifyTile(solid(205, 205, 205)).verdict, 'esriPlaceholder')
})

test('真的地圖絕對不能藏', () => {
  for (const seed of [1, 2, 3, 99]) {
    const c = classifyTile(real(seed))
    assert.equal(c.verdict, 'real')
    assert.equal(shouldHide(c, ESRI), false)
    assert.equal(shouldHide(c, EMAP), false)
  }
})

test('Esri 街道的海面（#bed8f2 單色）是真的海，不能藏', () => {
  // 實測：基隆外海 z12–z17 都是這個顏色的單色圖。藏掉它會變成一格格的洞。
  const c = classifyTile(solid(0xbe, 0xd8, 0xf2))
  assert.equal(c.verdict, 'flat')
  assert.equal(shouldHide(c, ESRI), false, 'Esri 的規則只藏佔位圖，不藏單色海面')
})

test('Esri 衛星的深色海面（接近黑）不能被當成佔位圖', () => {
  // 實測綠島外海 z16–z18：#00050a 附近，幾乎全黑。
  const c = classifyTile(nearlySolid(0x00, 0x05, 0x0c))
  assert.notEqual(c.verdict, 'esriPlaceholder')
  assert.equal(shouldHide(c, ESRI), false)
})

test('NLSC 地圖的「沒資料淺藍」要藏，好讓底下的全球地圖露出來', () => {
  // 實測：台灣東方外海全部、廈門岸邊 z16 起、基隆外海 z16 起
  const c = classifyTile(nearlySolid(0xa5, 0xdb, 0xf1))
  assert.equal(c.verdict, 'flat')
  assert.equal(shouldHide(c, EMAP), true)
})

test('NLSC 自己畫的深海藍（#2872df）是有意的配色，不能藏', () => {
  // 實測綠島外海 z13–z15。它也是單色，但不是「沒資料」的那個顏色。
  const c = classifyTile(solid(0x28, 0x72, 0xdf))
  assert.equal(shouldHide(c, EMAP), false)
})

test('NLSC 影像的假海面（#183b4b）要藏，讓 Esri 真的海面影像露出來', () => {
  const c = classifyTile(nearlySolid(0x18, 0x3b, 0x4b))
  assert.equal(shouldHide(c, PHOTO), true)
  // 但同一個顏色在「地圖」規則下不該被藏（規則是各圖層各自的）
  assert.equal(shouldHide(c, EMAP), false)
})

test('透明的標註圖層空白處不歸這裡管（本來就該透明）', () => {
  const c = classifyTile(solid(0, 0, 0, 0))
  assert.equal(c.verdict, 'real')
  assert.equal(shouldHide(c, ESRI), false)
})

test('白色、淺米色的真實陸地單色圖不能被當成佔位圖', () => {
  // 佔位圖的灰是 r=g=b；陸地底色帶黃（例如 #f2efe9）。純白則超出灰階範圍。
  assert.notEqual(classifyTile(solid(0xf2, 0xef, 0xe9)).verdict, 'esriPlaceholder')
  assert.notEqual(classifyTile(solid(255, 255, 255)).verdict, 'esriPlaceholder')
})
