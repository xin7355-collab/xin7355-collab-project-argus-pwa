// 第二輪探測：第一輪已確認舊的 resto/api 全部 404，STAC 可用、不需金鑰，
// collection id 是小寫的 sentinel-2-l2a / sentinel-1-grd。
// 這一輪要問清楚最後三件事，才不用猜：
//   1. 雲量欄位到底叫什麼（第一輪只印了前 14 個 key，沒看到）
//   2. sortby 支不支援（要拿「最近的」）
//   3. 時間窗過濾是不是真的有效（回來的 datetime 要落在窗內）
// 並順帶確認「collection 打錯會怎樣」——兩個主機行為不同，要選會大聲失敗的那個。

const BOX = { west: 4, south: 53, east: 6, north: 55 } // 北海，與使用者無關
const TO = new Date()
const FROM = new Date(TO.getTime() - 7 * 86400_000)
const dt = `${FROM.toISOString()}/${TO.toISOString()}`
const bbox = `${BOX.west},${BOX.south},${BOX.east},${BOX.north}`

async function get(url) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 25000)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    const body = res.headers.get('content-type')?.includes('json') ? await res.json() : null
    return { status: res.status, body }
  } catch (e) {
    return { status: 0, err: `${e.name}: ${e.message}` }
  } finally {
    clearTimeout(timer)
  }
}

for (const base of [
  'https://stac.dataspace.copernicus.eu/v1',
  'https://stac.opensearch.dataspace.copernicus.eu/v1',
]) {
  console.log(`\n████ ${base}`)

  for (const coll of ['sentinel-2-l2a', 'sentinel-1-grd']) {
    const r = await get(`${base}/search?collections=${coll}&bbox=${bbox}&datetime=${encodeURIComponent(dt)}&limit=3&sortby=-datetime`)
    console.log(`\n── ${coll} (sortby=-datetime) → ${r.status}`)
    if (r.status !== 200) { console.log('   ', JSON.stringify(r.body ?? r.err).slice(0, 300)); continue }
    const fs = r.body.features || []
    console.log(`   features=${fs.length} matched=${r.body.numberMatched ?? r.body.context?.matched ?? '(無)'}`)
    if (fs[0]) {
      const p = fs[0].properties
      console.log('   全部 property key:', Object.keys(p).sort().join(' '))
      const cloudKeys = Object.keys(p).filter((k) => /cloud/i.test(k))
      console.log('   含 cloud 的 key:', cloudKeys.length ? cloudKeys.map((k) => `${k}=${JSON.stringify(p[k])}`).join(' ') : '（沒有）')
      console.log('   datetime:', JSON.stringify(p.datetime), ' start:', JSON.stringify(p.start_datetime))
      console.log('   前 3 筆 datetime（驗排序是否由新到舊）:', fs.map((f) => f.properties.datetime).join(' | '))
      const inWindow = fs.every((f) => {
        const t = Date.parse(f.properties.datetime ?? f.properties.start_datetime)
        return t >= FROM.getTime() - 86400_000 && t <= TO.getTime() + 86400_000
      })
      console.log('   全部落在時間窗內:', inWindow)
    }
  }

  // collection 打錯會怎樣：安靜回 0 筆是陷阱，會被讀成「沒有新影像」
  const bad = await get(`${base}/search?collections=sentinel-2-NOPE&bbox=${bbox}&datetime=${encodeURIComponent(dt)}&limit=1`)
  console.log(`\n── collection 打錯 → ${bad.status}  features=${bad.body?.features?.length ?? '(無)'}`)
}
