// 暫時性探測（量完就刪）：沙箱連不到外部，借 Actions 確認幾個外部服務的真實行為。
// 只用公開地標座標（桃園機場），不讀任何 secret。
const ORIGIN = 'https://argus-app.xin7355.workers.dev'
const show = (k, v) => console.log(`${k}: ${v}`)
async function get(url, init = {}) {
  const r = await fetch(url, { ...init, headers: { Origin: ORIGIN, ...(init.headers || {}) } })
  const text = await r.text()
  return { r, text }
}

// 1. GIBS：VIIRS 夜間（Day/Night Band）各衛星圖層的時間範圍
try {
  const { r, text } = await get('https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml')
  show('\n== GIBS capabilities', `HTTP ${r.status}，${text.length} 字元`)
  for (const chunk of text.split('<Layer>').slice(1)) {
    const id = chunk.match(/<ows:Identifier>([^<]+)<\/ows:Identifier>/)?.[1] || ''
    if (!/DayNightBand|CorrectedReflectance_TrueColor/.test(id) || !/VIIRS/.test(id)) continue
    const values = [...chunk.matchAll(/<Value>([^<]+)<\/Value>/g)].map((m) => m[1])
    const def = chunk.match(/<Default>([^<]+)<\/Default>/)?.[1]
    const mats = [...new Set([...chunk.matchAll(/<TileMatrixSet>([^<]+)<\/TileMatrixSet>/g)].map((m) => m[1]))]
    show(`  ${id}`, `預設日 ${def}；範圍 ${values.slice(-2).join(' ｜ ')}；矩陣 ${mats.join(',')}`)
  }
} catch (e) { show('GIBS 失敗', e) }

// 2. adsb.lol：點查詢與軍機，看欄位與 CORS
for (const u of ['https://api.adsb.lol/v2/lat/25.08/lon/121.23/dist/100', 'https://api.adsb.lol/v2/mil']) {
  try {
    const { r, text } = await get(u)
    show(`\n== ${u}`, `HTTP ${r.status} ct=${r.headers.get('content-type')} acao=${r.headers.get('access-control-allow-origin')} cache=${r.headers.get('cache-control')}`)
    const j = JSON.parse(text)
    show('  頂層鍵', Object.keys(j).join(','))
    const ac = j.ac || j.aircraft || []
    show('  架數', ac.length)
    const keys = new Set(); for (const a of ac.slice(0, 50)) Object.keys(a).forEach((k) => keys.add(k))
    show('  欄位', [...keys].sort().join(','))
    const nic = ac.filter((a) => a.nic !== undefined).length
    show('  有 nic／nac_p／gpsOkBefore／emergency', `${nic}／${ac.filter((a) => a.nac_p !== undefined).length}／${ac.filter((a) => a.gpsOkBefore !== undefined).length}／${ac.filter((a) => a.emergency && a.emergency !== 'none').length}`)
    show('  第一架（只列型別）', JSON.stringify(Object.fromEntries(Object.entries(ac[0] || {}).map(([k, v]) => [k, typeof v]))))
  } catch (e) { show(`${u} 失敗`, e) }
}
try {
  const r = await fetch('https://api.adsb.lol/v2/mil', { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'GET' } })
  show('  adsb.lol 預檢', `HTTP ${r.status} acao=${r.headers.get('access-control-allow-origin')}`)
} catch (e) { show('adsb.lol 預檢失敗', e) }

// 3. 氣象署：假授權碼放網址 vs 放標頭，回應有沒有差（判斷標頭是否被讀）
const CWA = 'https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-C0032-001'
for (const [name, url, headers] of [
  ['不帶授權碼', `${CWA}?format=JSON`, {}],
  ['假碼放網址', `${CWA}?format=JSON&Authorization=CWA-00000000-0000-0000-0000-000000000000`, {}],
  ['假碼放標頭', `${CWA}?format=JSON`, { Authorization: 'CWA-00000000-0000-0000-0000-000000000000' }],
]) {
  try {
    const { r, text } = await get(url, { headers })
    show(`\n== CWA ${name}`, `HTTP ${r.status} acao=${r.headers.get('access-control-allow-origin')}｜${text.slice(0, 160).replace(/\s+/g, ' ')}`)
  } catch (e) { show(`CWA ${name} 失敗`, e) }
}
try {
  const r = await fetch(CWA, { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } })
  show('  CWA 預檢（帶 Authorization 標頭）', `HTTP ${r.status} acao=${r.headers.get('access-control-allow-origin')} acah=${r.headers.get('access-control-allow-headers')}`)
} catch (e) { show('CWA 預檢失敗', e) }

// 4. Photon 地名搜尋（免金鑰備援）
try {
  const { r, text } = await get('https://photon.komoot.io/api/?q=Keelung&limit=1')
  show('\n== Photon', `HTTP ${r.status} acao=${r.headers.get('access-control-allow-origin')}｜${text.slice(0, 200)}`)
} catch (e) { show('Photon 失敗', e) }

// 5. CelesTrak：sar／resource／weather 群組有哪些（衛星名是公開資訊）
for (const g of ['sar', 'resource', 'weather']) {
  try {
    const { r, text } = await get(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${g}&FORMAT=tle`)
    const names = text.split('\n').filter((_, i) => i % 3 === 0).map((s) => s.trim()).filter(Boolean)
    const pick = g === 'sar' ? names : names.filter((n) => /SENTINEL|NOAA 2|SUOMI|ICEYE|CAPELLA|RCM|NISAR|ALOS|COSMO|CSG|GAOFEN-3|TERRASAR|TANDEM|UMBRA|RADARSAT/i.test(n))
    show(`\n== CelesTrak ${g}`, `HTTP ${r.status}，共 ${names.length} 顆；挑出：${pick.join('、')}`)
  } catch (e) { show(`CelesTrak ${g} 失敗`, e) }
}
