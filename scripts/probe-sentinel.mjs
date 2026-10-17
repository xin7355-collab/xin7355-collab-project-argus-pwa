// 暫時性探測：CDSE Sentinel Hub WMS 對「不存在的組態」與 GetCapabilities 的回應格式、CORS 標頭。
// 只用全零的假 Instance ID 與中性座標，不讀任何 secret。
const HOSTS = ['https://sh.dataspace.copernicus.eu/ogc/wms', 'https://services.sentinel-hub.com/ogc/wms']
const FAKE = '00000000-0000-0000-0000-000000000000'
const qs = (o) => new URLSearchParams(o).toString()
for (const host of HOSTS) {
  const urls = {
    caps: `${host}/${FAKE}?${qs({ service: 'WMS', request: 'GetCapabilities', version: '1.3.0' })}`,
    map: `${host}/${FAKE}?${qs({ service: 'WMS', request: 'GetMap', version: '1.3.0', layers: 'SAR-VV', styles: '', crs: 'EPSG:3857', bbox: '0,0,100000,100000', width: 256, height: 256, format: 'image/png', transparent: 'true', time: '2026-10-01/2026-10-16' })}`,
  }
  for (const [k, u] of Object.entries(urls)) {
    try {
      const r = await fetch(u, { headers: { Origin: 'https://argus-app.xin7355.workers.dev' } })
      const body = await r.text()
      console.log(`== ${host} ${k}: HTTP ${r.status} ct=${r.headers.get('content-type')} acao=${r.headers.get('access-control-allow-origin')}`)
      console.log(body.slice(0, 700).replace(/\s+/g, ' '))
    } catch (e) {
      console.log(`== ${host} ${k}: 失敗 ${e}`)
    }
  }
}
