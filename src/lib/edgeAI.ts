// ── 邊緣 AI 辨識客戶端 ──────────────────────────────────────
//
// 手機端「絕對禁止」載入 YOLO。這裡只把框選的 bbox 丟給 Cloudflare
// Worker，Worker 去抓 SAR 圖、跑輕量推論，只回傳 <1KB 的 GeoJSON。
//
// 若未設定 VITE_EDGE_AI_URL，會 fallback 到本機 mock，方便先驗證 UI 流程。

import type { BBox, DetectionCollection } from '../types'
import { getConfig, isEdgeAiConfigured } from './config'

export { isEdgeAiConfigured }

/**
 * 呼叫邊緣 AI。回傳「疑似船隻」的 GeoJSON。
 * 加了 8 秒 timeout 與錯誤處理，避免海上網路不穩時 UI 卡死。
 */
export async function detectVessels(bbox: BBox, date: string): Promise<DetectionCollection> {
  const edgeUrl = getConfig().edgeAiUrl
  if (!edgeUrl) return mockDetect(bbox)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await fetch(edgeUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bbox, date }),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`Edge AI ${res.status}`)
    return (await res.json()) as DetectionCollection
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * 本機 mock：在 bbox 內隨機灑幾個「偵測點」，讓 UI 流程可以先跑起來。
 * 真接上 Worker 後這段永遠不會執行。
 */
function mockDetect(bbox: BBox): DetectionCollection {
  const n = 3 + Math.floor(Math.random() * 4)
  const features = Array.from({ length: n }, (_, i) => {
    const lng = bbox.west + Math.random() * (bbox.east - bbox.west)
    const lat = bbox.south + Math.random() * (bbox.north - bbox.south)
    const confidence = 0.55 + Math.random() * 0.4
    return {
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [lng, lat] as [number, number] },
      properties: {
        confidence: Number(confidence.toFixed(2)),
        label: `TGT-${String(i + 1).padStart(2, '0')}`,
        suspicious: confidence > 0.7, // 高信心 → 紅色警示
      },
    }
  })
  return { type: 'FeatureCollection', features }
}
