// 暫時性探測腳本：問真正的 Copernicus 伺服器「哪個端點還活著」。
//
// 為什麼要這支：開發沙箱連不出去（CONNECT 403），而排程盯梢在 Actions 上
// 對 resto/api/.../search.json 拿到 404。要修就得先知道正確端點長什麼樣，
// 用猜的只會再錯一次。GitHub Actions 連得到，所以拿它當實驗台。
//
// 隱私：bbox 用寫死的中性座標（北海），**不讀 WATCH_BBOX**。
// 這支的 log 會出現在公開 repo，不能洩漏使用者盯哪片海。
// 同理只印狀態碼與欄位名，不印完整回傳內容。

const BOX = { west: 4, south: 53, east: 6, north: 55 } // 北海，與使用者無關
const TO = new Date()
const FROM = new Date(TO.getTime() - 14 * 86400_000)
const iso = (d) => d.toISOString()

async function probe(label, url, init) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 25000)
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal })
    const ct = res.headers.get('content-type') || ''
    let note = ''
    if (ct.includes('json')) {
      const j = await res.json()
      if (Array.isArray(j.features)) {
        note = `features=${j.features.length}`
        if (j.features[0]?.properties) {
          note += ` props=${Object.keys(j.features[0].properties).slice(0, 14).join(',')}`
        }
      } else if (Array.isArray(j.collections)) {
        note = `collections=${j.collections.length}: ${j.collections.map((c) => c.id).join(' ')}`
      } else if (Array.isArray(j.value)) {
        note = `odata value=${j.value.length}`
        if (j.value[0]) note += ` keys=${Object.keys(j.value[0]).slice(0, 10).join(',')}`
      } else {
        note = `keys=${Object.keys(j).slice(0, 10).join(',')}`
      }
    } else {
      note = `content-type=${ct || '(無)'}`
    }
    console.log(`${res.ok ? '✅' : '❌'} ${res.status} ${label}\n     ${note}`)
    return res.ok
  } catch (e) {
    console.log(`💥 --- ${label}\n     ${e.name}: ${e.message}`)
    return false
  } finally {
    clearTimeout(timer)
  }
}

const bboxCsv = `${BOX.west},${BOX.south},${BOX.east},${BOX.north}`
const dt = `${iso(FROM)}/${iso(TO)}`

console.log(`探測時間窗 ${dt}\nbbox（中性測試座標，非使用者設定）${bboxCsv}\n`)

console.log('── A. 舊的 OpenSearch/resto（目前程式用的）──')
for (const c of ['Sentinel2', 'SENTINEL-2', 'Sentinel-2', 'SENTINEL-2-L2A']) {
  await probe(
    `resto collections/${c}/search.json`,
    `https://catalogue.dataspace.copernicus.eu/resto/api/collections/${c}/search.json?box=${bboxCsv}&startDate=${iso(FROM)}&completionDate=${iso(TO)}&maxRecords=2`,
  )
}

console.log('\n── B. STAC：先看有哪些 collection ──')
for (const base of [
  'https://stac.dataspace.copernicus.eu/v1',
  'https://stac.opensearch.dataspace.copernicus.eu/v1',
]) {
  await probe(`${base}/collections`, `${base}/collections`)
}

console.log('\n── C. STAC item search（GET）──')
for (const base of [
  'https://stac.dataspace.copernicus.eu/v1',
  'https://stac.opensearch.dataspace.copernicus.eu/v1',
]) {
  for (const coll of ['sentinel-2-l2a', 'SENTINEL-2', 'sentinel-1-grd', 'SENTINEL-1']) {
    await probe(
      `GET ${base}/search collections=${coll}`,
      `${base}/search?collections=${coll}&bbox=${bboxCsv}&datetime=${encodeURIComponent(dt)}&limit=2`,
    )
  }
}

console.log('\n── D. OData ──')
const odataFilter =
  `Collection/Name eq 'SENTINEL-2' and ` +
  `OData.CSC.Intersects(area=geography'SRID=4326;POLYGON((${BOX.west} ${BOX.south},${BOX.east} ${BOX.south},${BOX.east} ${BOX.north},${BOX.west} ${BOX.north},${BOX.west} ${BOX.south}))') and ` +
  `ContentDate/Start gt ${iso(FROM)}`
await probe(
  'odata/v1/Products',
  `https://catalogue.dataspace.copernicus.eu/odata/v1/Products?$filter=${encodeURIComponent(odataFilter)}&$top=2`,
)
