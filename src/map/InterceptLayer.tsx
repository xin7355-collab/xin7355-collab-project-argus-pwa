import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useTacticalStore } from '../store/tacticalStore'

/**
 * 攔截解算圖上疊層：畫「我方→攔截點」（青色實線＝該操航向）與
 * 「目標→攔截點」（琥珀虛線＝目標航跡），並在攔截點打星號。一眼看清幾何。
 */
export function InterceptLayer({ map }: { map: L.Map }) {
  const sol = useTacticalStore((s) => s.interceptSolution)
  const groupRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!sol) return
    const g = L.layerGroup().addTo(map)
    groupRef.current = g

    // 我方 → 攔截點（該操航向）
    L.polyline([[sol.own.lat, sol.own.lng], [sol.point.lat, sol.point.lng]], {
      color: '#38bdf8',
      weight: 2.5,
      opacity: 0.95,
    }).addTo(g)
    // 目標 → 攔截點（目標航跡）
    L.polyline([[sol.target.lat, sol.target.lng], [sol.point.lat, sol.point.lng]], {
      color: '#f59e0b',
      weight: 2,
      opacity: 0.9,
      dashArray: '6 5',
    }).addTo(g)

    const dot = (lat: number, lng: number, color: string, fill: string) =>
      L.circleMarker([lat, lng], { radius: 5, color, fillColor: fill, fillOpacity: 1, weight: 2 }).addTo(g)
    dot(sol.own.lat, sol.own.lng, '#38bdf8', '#0e7490').bindTooltip('我方', { direction: 'top' })
    dot(sol.target.lat, sol.target.lng, '#f59e0b', '#7c4a03').bindTooltip('目標現位', { direction: 'top' })

    // 攔截點：星號
    L.marker([sol.point.lat, sol.point.lng], {
      icon: L.divIcon({
        className: '',
        html: '<div style="font-size:20px;line-height:1;filter:drop-shadow(0 0 3px #000)">🎯</div>',
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      }),
    })
      .addTo(g)
      .bindTooltip('攔截點', { direction: 'top' })

    return () => {
      g.clearLayers()
      map.removeLayer(g)
      groupRef.current = null
    }
  }, [sol, map])

  return null
}
