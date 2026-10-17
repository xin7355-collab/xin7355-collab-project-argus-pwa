import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkInstance, explainWmsError, parseCapabilities, parseServiceException, pickLayer } from './sentinelLayers.ts'

const caps = (layers: [string, string][]) => `<?xml version="1.0"?>
<WMS_Capabilities version="1.3.0"><Capability><Layer><Title>Sentinel Hub WMS</Title>
${layers.map(([n, t]) => `<Layer queryable="1"><Name>${n}</Name><Title>${t}</Title><Abstract>x</Abstract></Layer>`).join('\n')}
</Layer></Capability></WMS_Capabilities>`

// 實測過的錯誤格式（GitHub Actions 打 CDSE，假 Instance ID）
const BAD_ID = `<?xml version='1.0' encoding="UTF-8"?><ServiceExceptionReport version="1.3.0"><ServiceException> <![CDATA[ Invalid instance id: 00000000-0000-0000-0000-000000000000 ]]> </ServiceException></ServiceExceptionReport>`

const P = { sar: 'SAR-VV', optical: 'TRUE-COLOR-S2L2A' }

test('讀出有名字的圖層，略過外層群組', () => {
  const l = parseCapabilities(caps([['TRUE-COLOR', 'True color'], ['NDVI', 'NDVI &amp; vegetation']]))
  assert.deepEqual(l, [{ name: 'TRUE-COLOR', title: 'True color' }, { name: 'NDVI', title: 'NDVI & vegetation' }])
})

test('讀出實際的 CDSE 錯誤文字', () => {
  assert.equal(parseServiceException(BAD_ID), 'Invalid instance id: 00000000-0000-0000-0000-000000000000')
  assert.equal(parseServiceException(caps([])), null)
})

test('預設名字在就用預設', () => {
  const l = parseCapabilities(caps([['SAR-VV', 'x'], ['VV-DB', 'y']]))
  assert.equal(pickLayer('sar', l, 'SAR-VV'), 'SAR-VV')
})

test('雷達：沒有預設名字就挑像 Sentinel-1 的，偏好 VV', () => {
  const l = parseCapabilities(caps([['TRUE-COLOR', 'S2 true color'], ['VH-DB', 'Sentinel-1 VH'], ['S1-VV', 'Sentinel-1 VV decibel']]))
  assert.equal(pickLayer('sar', l, 'SAR-VV'), 'S1-VV')
})

test('雷達：Sentinel-2 範本裡沒有雷達 → null，不能亂挑光學圖層頂替', () => {
  const l = parseCapabilities(caps([['TRUE-COLOR', 'True color'], ['FALSE-COLOR', 'False color'], ['NDVI', 'NDVI']]))
  assert.equal(pickLayer('sar', l, 'SAR-VV'), null)
})

test('光學：挑真彩、排除假彩與雷達', () => {
  const l = parseCapabilities(caps([['FALSE-COLOR', 'False color'], ['1_TRUE_COLOR', 'True color'], ['S1-VV', 'radar']]))
  assert.equal(pickLayer('optical', l, 'TRUE-COLOR-S2L2A'), '1_TRUE_COLOR')
})

test('檢查：Instance ID 錯 → 明講去重貼，並提醒 WMS 網址', async () => {
  const r = await checkInstance('https://x/ogc/wms/bad', async () => ({ status: 400, text: BAD_ID }), P)
  assert.equal(r.status, 'badId')
  assert.match(r.message, /重新複製/)
  assert.match(r.message, /免費 CDSE/)
})

test('檢查：組態沒有雷達圖層 → 列出現有圖層、叫人去加', async () => {
  const r = await checkInstance('u', async () => ({ status: 200, text: caps([['TRUE-COLOR', 'True color']]) }), P)
  assert.equal(r.status, 'ok')
  assert.equal(r.sar, null)
  assert.equal(r.optical, 'TRUE-COLOR')
  assert.match(r.message, /沒有雷達/)
  assert.match(r.message, /TRUE-COLOR/)
})

test('檢查：都有 → 沒話說', async () => {
  const r = await checkInstance('u', async () => ({ status: 200, text: caps([['SAR-VV', ''], ['TRUE-COLOR-S2L2A', '']]) }), P)
  assert.deepEqual([r.status, r.sar, r.optical, r.message], ['ok', 'SAR-VV', 'TRUE-COLOR-S2L2A', ''])
})

test('檢查：連不到不算設定錯，照預設名字載入', async () => {
  const r = await checkInstance('u', async () => { throw new TypeError('Failed to fetch') }, P)
  assert.equal(r.status, 'unreachable')
  assert.equal(r.sar, 'SAR-VV')
})

test('額度用完講清楚', () => {
  assert.match(explainWmsError('Processing units quota exceeded').message, /額度/)
})
