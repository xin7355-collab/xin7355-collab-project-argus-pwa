// 暫時性：沙箱連不到 CDSE 文件站，借 Actions 讀官方說明全文段落。不讀任何 secret。
const PAGES = [
  ['https://documentation.dataspace.copernicus.eu/Applications/QGIS.html', /Configuration Utility|New Layer|New Configuration|Based on|template/i],
  ['https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/OGC.html', /instance|GetCapabilities|layer/i],
  ['https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Data/S1GRD.html', /decibel|VV|evalscript|visualiz|dataset|type/i],
]
const strip = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '')
    .replace(/<(br|p|li|h\d|div|tr|pre)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
for (const [u, kw] of PAGES) {
  try {
    const r = await fetch(u)
    const text = strip(await r.text())
    console.log(`\n######## ${u} HTTP ${r.status}`)
    const lines = text.split('\n').map((s) => s.trim()).filter((s) => s.length > 3)
    lines.forEach((l, i) => { if (kw.test(l)) console.log(`[${i}] ${l.slice(0, 1500)}`) })
  } catch (e) {
    console.log(`######## ${u} 失敗 ${e}`)
  }
}
