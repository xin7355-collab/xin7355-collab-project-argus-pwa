import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useTacticalStore } from '../store/tacticalStore'
import { lookoutReachKm, opticalHorizonKm } from '../lib/lookout'

/**
 * 瞭望哨視域圖層：把沿岸觀測點「看得到的海域」畫成半透明扇形/多邊形。
 * 有地形視域多邊形就畫真實形狀（被岬角/山擋出的死角），否則畫圓。私密只存本機。
 */
export function LookoutLayer({ map }: { map: L.Map }) {
  const show = useTacticalStore((s) => s.showLookout)
  const lookouts = useTacticalStore((s) => s.lookouts)
  const rings = useTacticalStore((s) => s.lookoutRings)
  const showTerrain = useTacticalStore((s) => s.showLookoutTerrain)
  const groupRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!show) return
    const g = L.layerGroup().addTo(map)
    groupRef.current = g
    const color = '#a3e635' // 萊姆綠：目視/瞭望
    for (const l of lookouts) {
      const reach = lookoutReachKm(l)
      const ring = rings[l.id]
      if (showTerrain && ring && ring.length >= 3) {
        L.polygon(ring, {
          color,
          weight: 2,
          opacity: 0.9,
          fillColor: color,
          fillOpacity: 0.15,
          lineJoin: 'round',
        }).addTo(g)
      } else {
        L.circle([l.lat, l.lng], {
          radius: reach * 1000,
          color,
          weight: 2,
          opacity: 0.85,
          fillColor: color,
          fillOpacity: 0.12,
          dashArray: '4 4',
        }).addTo(g)
      }
      const horiz = opticalHorizonKm(l.eyeM, l.targetM)
      L.marker([l.lat, l.lng], {
        icon: L.divIcon({
          className: '',
          html: `<div class="lookout-marker">👁️<div class="lookout-label">${l.name}<br/>${reach.toFixed(1)}km</div></div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        }),
      })
        .bindPopup(
          `<b style="color:${color}">👁️ ${l.name}</b><br/>眼高 ${l.eyeM}m ｜ 目標 ${l.targetM}m<br/>` +
            `<b>視域 ${reach.toFixed(1)} km</b>（地平線 ${horiz.toFixed(1)}km／辨識上限 ${l.maxKm}km 取小）<br/>` +
            `<span style="color:#94a3b8;font-size:11px">目視樂觀估算；夜間/霧/雨會大幅縮短。地形視域需按「計算」以 DEM 切出死角。</span>`,
        )
        .addTo(g)
    }
    return () => {
      g.clearLayers()
      map.removeLayer(g)
      groupRef.current = null
    }
  }, [show, lookouts, rings, showTerrain, map])

  return null
}
