import { useEffect } from 'react'
import L from 'leaflet'
import { useTacticalStore } from '../store/tacticalStore'

/**
 * 監聽 store 的 flyToTarget：一被設定，地圖就飛過去，然後清空（一次性）。
 * 供「輸入座標查詢影像」等功能跳轉地圖用，跨模式通用。
 */
export function MapFlyTo({ map }: { map: L.Map }) {
  const target = useTacticalStore((s) => s.flyToTarget)
  const setFlyTo = useTacticalStore((s) => s.setFlyTo)

  useEffect(() => {
    if (!target) return
    map.flyTo([target.lat, target.lng], target.zoom ?? Math.max(map.getZoom(), 11), {
      duration: 0.8,
    })
    setFlyTo(null)
  }, [target, map, setFlyTo])

  return null
}
