import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useTacticalStore } from '../store/tacticalStore'

/** 同心距離圈（浬）：一眼判斷目標「在幾浬內」。12浬=領海、24浬=鄰接區。 */
const RINGS_NM = [1, 3, 5, 12, 24]
const NM = 1852 // m

export function RangeRingLayer({ map }: { map: L.Map }) {
  const center = useTacticalStore((s) => s.rangeCenter)
  const groupRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!center) return
    const g = L.layerGroup().addTo(map)
    groupRef.current = g
    const color = '#38bdf8'
    for (const nm of RINGS_NM) {
      const territorial = nm === 12 || nm === 24
      L.circle([center.lat, center.lng], {
        radius: nm * NM,
        color: territorial ? '#f59e0b' : color,
        weight: territorial ? 1.6 : 1.2,
        opacity: 0.8,
        dashArray: territorial ? '6 5' : '3 5',
        fill: false,
        interactive: false,
      }).addTo(g)
      // 距離標籤放在圈的正北緣
      const labelLat = center.lat + (nm * NM) / 111000
      L.marker([labelLat, center.lng], {
        icon: L.divIcon({
          className: '',
          html: `<div class="range-label" style="border-color:${territorial ? '#f59e0b' : color};color:${territorial ? '#fbbf24' : '#bae6fd'}">${nm} 浬${nm === 12 ? '·領海' : nm === 24 ? '·鄰接' : ''}</div>`,
          iconSize: [64, 15],
          iconAnchor: [32, 8],
        }),
      }).addTo(g)
    }
    // 中心點
    L.circleMarker([center.lat, center.lng], {
      radius: 4,
      color,
      fillColor: '#0e7490',
      fillOpacity: 1,
      weight: 2,
    }).addTo(g)

    return () => {
      g.clearLayers()
      map.removeLayer(g)
      groupRef.current = null
    }
  }, [center, map])

  return null
}
