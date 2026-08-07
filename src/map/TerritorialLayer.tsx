import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useTacticalStore } from '../store/tacticalStore'
import {
  TAIWAN_BASELINE,
  PENGHU_BASELINE,
  offsetRing,
} from '../lib/territorialWaters'

/**
 * 領海基線 / 領海(12浬) / 鄰接區(24浬) 參考覆蓋層。
 * 跨模式顯示（態勢感知），由右上角按鈕切換。示意用途，非法律劃界。
 */
export function TerritorialLayer({ map }: { map: L.Map }) {
  const show = useTacticalStore((s) => s.showTerritorial)
  const groupRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!show) return
    const group = L.layerGroup().addTo(map)
    groupRef.current = group

    for (const baseline of [TAIWAN_BASELINE, PENGHU_BASELINE]) {
      // 24 浬鄰接區（外，橙色）
      const cz = offsetRing(baseline, 24)
      L.polygon(cz, {
        color: '#fb923c',
        weight: 1.5,
        dashArray: '2 6',
        opacity: 0.7,
        fill: false,
      })
        .bindPopup('<b style="color:#fb923c">鄰接區外界（24 浬）</b><br/>示意參考線，非法律劃界')
        .addTo(group)
      // 12 浬領海（中，青色）
      const ts = offsetRing(baseline, 12)
      L.polygon(ts, {
        color: '#22d3ee',
        weight: 2,
        dashArray: '6 4',
        opacity: 0.85,
        fillColor: '#22d3ee',
        fillOpacity: 0.05,
      })
        .bindPopup('<b style="color:#22d3ee">領海外界（12 浬）</b><br/>示意參考線，非法律劃界')
        .addTo(group)
      // 基線（內，白色細線 + 基點）
      L.polygon(baseline, {
        color: '#e2e8f0',
        weight: 1,
        opacity: 0.6,
        fill: false,
      })
        .bindPopup('<b>領海基線（示意）</b><br/>依直線基線概念連接主要岬角/沙洲')
        .addTo(group)
      for (const [lat, lng] of baseline) {
        L.circleMarker([lat, lng], {
          radius: 2.5,
          color: '#e2e8f0',
          fillColor: '#e2e8f0',
          fillOpacity: 1,
          weight: 1,
        }).addTo(group)
      }
    }

    return () => {
      group.clearLayers()
      map.removeLayer(group)
      groupRef.current = null
    }
  }, [show, map])

  return null
}
