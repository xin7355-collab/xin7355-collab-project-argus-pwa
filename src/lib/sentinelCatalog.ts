// ── 找「最近一次有影像」的日期（CDSE 公開目錄，免 OAuth）──────────
//
// 高解析衛星非每天過境；這裡查 Copernicus Data Space 的公開 OpenSearch(resto) 目錄，
// 找出目前畫面上空最近一次 Sentinel-2(L2A) 過境、且雲量夠低的那天，讓使用者一鍵
// 跳過去看「最近看得到船的影像」。
//
// 連線策略：若已設定邊緣 Worker（edgeAiUrl）→ 透過 Worker 代理查（伺服器端抓，
// 保證繞過瀏覽器 CORS）；否則直連目錄（部分網路/瀏覽器會被跨域擋）。

import { getConfig } from './config'

export interface RecentImage {
  /** YYYY-MM-DD（該日有 Sentinel-2 過境）。 */
  date: string
  /** 該日最佳影像的雲量 %。 */
  cloud: number
  /** true = 找不到低雲的，只好回傳最近一次（可能多雲）。 */
  cloudy: boolean
}

/**
 * 找最近有影像的日期。lat/lng 為關注點（畫面中心/查詢座標）；maxCloudPct 為可接受
 * 雲量上限；backDays 往回找幾天。查不到回 null；網路/跨域失敗會 throw。
 */
export async function findRecentSentinelDate(
  lat: number,
  lng: number,
  maxCloudPct: number,
  backDays = 45,
): Promise<RecentImage | null> {
  const half = 0.15 // 關注點附近 ~±16km 的框，判斷是否有過境涵蓋此區
  const box = [
    (lng - half).toFixed(4),
    (lat - half).toFixed(4),
    (lng + half).toFixed(4),
    (lat + half).toFixed(4),
  ].join(',')
  const now = Date.now()
  const from = new Date(now - backDays * 86400000).toISOString()
  const to = new Date(now).toISOString()

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 15000)
  let j: any
  try {
    const edge = getConfig().edgeAiUrl
    if (edge) {
      // 走邊緣 Worker 代理（繞過 CORS）
      const res = await fetch(edge, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ catalogSearch: true, box, from, to, maxRecords: 100 }),
        signal: ctrl.signal,
      })
      if (!res.ok) throw new Error('catalog proxy ' + res.status)
      j = await res.json()
      if (j?.error) throw new Error(String(j.error))
    } else {
      // 直連公開目錄（可能被瀏覽器跨域擋）
      const url =
        `https://catalogue.dataspace.copernicus.eu/resto/api/collections/Sentinel2/search.json?` +
        `box=${box}&startDate=${from}&completionDate=${to}` +
        `&productType=S2MSI2A&sortParam=startDate&sortOrder=descending&maxRecords=100`
      const res = await fetch(url, { signal: ctrl.signal })
      if (!res.ok) throw new Error('catalog ' + res.status)
      j = await res.json()
    }
  } finally {
    clearTimeout(timer)
  }

  const feats: any[] = Array.isArray(j?.features) ? j.features : []
  // 同一天可能多個磚——每天保留最低雲量者
  const byDate = new Map<string, number>()
  for (const f of feats) {
    const d = String(f?.properties?.startDate || '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue
    const cloud = Number(f?.properties?.cloudCover)
    const c = Number.isFinite(cloud) ? cloud : 100
    if (!byDate.has(d) || c < (byDate.get(d) as number)) byDate.set(d, c)
  }
  const dates = [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)) // 日期新→舊
  if (!dates.length) return null
  const good = dates.find(([, c]) => c <= maxCloudPct)
  if (good) return { date: good[0], cloud: Math.round(good[1]), cloudy: false }
  const [d, c] = dates[0]
  return { date: d, cloud: Math.round(c), cloudy: true }
}
