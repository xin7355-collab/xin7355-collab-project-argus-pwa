// 暫時性：沙箱連不到 CDSE 文件站，借 Actions 讀官方說明，抓出設定頁的按鈕與圖層名稱。不讀任何 secret。
const PAGES = [
  'https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Dashboard.html',
  'https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/OGC.html',
  'https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Overview.html',
  'https://documentation.dataspace.copernicus.eu/Applications/QGIS.html',
  'https://knowledgebase.code-de.org/en/latest/cloud/Sentinel-Hub-Configuration-Utility-Overview-CODE-DE.html',
]
const KW = /configuration|template|layer|dashboard|shapps|instance|sentinel-1|grd|vv|data source|add new|predefined|save/i
for (const u of PAGES) {
  try {
    const r = await fetch(u)
    const html = await r.text()
    const text = html
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '')
      .replace(/<(br|p|li|h\d|div|tr)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    const hrefs = [...html.matchAll(/href="(https?:\/\/[^"]*(shapps|dashboard)[^"]*)"/gi)].map((m) => m[1])
    console.log(`\n######## ${u} HTTP ${r.status}`)
    console.log('連結：', [...new Set(hrefs)].join(' '))
    for (const line of text.split('\n').map((s) => s.trim()).filter((s) => s.length > 3 && KW.test(s))) console.log('  ' + line.slice(0, 300))
  } catch (e) {
    console.log(`######## ${u} 失敗 ${e}`)
  }
}
