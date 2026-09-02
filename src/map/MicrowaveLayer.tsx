import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useTacticalStore } from '../store/tacticalStore'
import { formatDist } from '../lib/units'

/**
 * 微波備用鏈路圖層：把分析過的點對點路徑畫在地圖上。
 * 線色即結論——綠＝淨空達標、橙＝視線通但 Fresnel 不足、紅＝視線被擋。
 * 最糟點另外標一個記號，才知道要去哪裡看／要墊高哪一段。
 */
export function MicrowaveLayer({ map }: { map: L.Map }) {
  const path = useTacticalStore((s) => s.mwPath)
  const unit = useTacticalStore((s) => s.distUnit)
  const groupRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!path) return
    const g = L.layerGroup().addTo(map)
    groupRef.current = g

    const color = path.blocked ? '#f43f5e' : path.ok ? '#34d399' : '#fbbf24'
    const verdict = path.blocked
      ? '視線被擋住，這條打不通'
      : path.ok
        ? '視線通、Fresnel 淨空達標'
        : '視線通，但 Fresnel 淨空不足（會有繞射損耗）'

    L.polyline(
      [
        [path.a.lat, path.a.lng],
        [path.b.lat, path.b.lng],
      ],
      { color, weight: 3, opacity: 0.9, dashArray: path.ok ? undefined : '6 4' },
    )
      .bindPopup(
        `<b style="color:${color}">📶 微波鏈路</b><br/>${path.a.name} ↔ ${path.b.name}<br/>` +
          `路徑長 ${formatDist(path.totalKm, unit)}<br/>` +
          `<span style="color:#94a3b8;font-size:11px">${verdict}</span>`,
      )
      .addTo(g)

    // 兩端記號
    for (const [pt, tag] of [
      [path.a, 'A'],
      [path.b, 'B'],
    ] as const) {
      L.marker([pt.lat, pt.lng], {
        icon: L.divIcon({
          className: '',
          html: `<div class="radio-marker" style="border-color:${color};color:${color}">📶<div class="radio-label" style="color:${color}">${tag}·${pt.name}</div></div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        }),
      }).addTo(g)
    }

    // 最糟淨空點——實際要處理的就是這個位置
    if (path.worst) {
      L.circleMarker([path.worst.lat, path.worst.lng], {
        radius: 6,
        color: '#f43f5e',
        weight: 2,
        fillColor: '#f43f5e',
        fillOpacity: 0.6,
      })
        .bindPopup(
          `<b style="color:#f43f5e">最糟淨空點</b><br/>` +
            `距 A 端 ${formatDist(path.worst.km, unit)}｜地面 ${Math.round(path.worst.groundM)}m<br/>` +
            `<span style="color:#94a3b8;font-size:11px">第一 Fresnel 區淨空 ${(path.worst.ratio * 100).toFixed(0)}%` +
            `（微波實務需 ≥60%）。要改善就是墊高兩端天線，或改走中繼點避開這裡。</span>`,
        )
        .addTo(g)
    }

    return () => {
      g.clearLayers()
      map.removeLayer(g)
      groupRef.current = null
    }
  }, [path, unit, map])

  return null
}
