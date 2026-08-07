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
  const fitTarget = useTacticalStore((s) => s.fitPointsTarget)
  const fitPoints = useTacticalStore((s) => s.fitPoints)

  useEffect(() => {
    if (!target) return
    map.flyTo([target.lat, target.lng], target.zoom ?? Math.max(map.getZoom(), 11), {
      duration: 0.8,
    })
    setFlyTo(null)
  }, [target, map, setFlyTo])

  // 縮放至涵蓋所有點（「一次看到全部船」）：單點退回 flyTo，多點 fitBounds。
  useEffect(() => {
    if (!fitTarget || fitTarget.length === 0) return
    if (fitTarget.length === 1) {
      map.flyTo(fitTarget[0], Math.max(map.getZoom(), 11), { duration: 0.8 })
    } else {
      map.flyToBounds(L.latLngBounds(fitTarget), { padding: [48, 48], maxZoom: 12, duration: 0.8 })
    }
    fitPoints(null)
  }, [fitTarget, map, fitPoints])

  return null
}
