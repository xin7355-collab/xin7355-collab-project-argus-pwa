import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useTacticalStore } from '../store/tacticalStore'

/**
 * 量測工具圖層：量測模式開啟時，點地圖依序加點，畫出折線並在每段標
 * 距離(浬)＋方位(°)。跨模式可用。
 */
export function MeasureLayer({ map }: { map: L.Map }) {
  const measuring = useTacticalStore((s) => s.measuring)
  const points = useTacticalStore((s) => s.measurePoints)
  const addMeasurePoint = useTacticalStore((s) => s.addMeasurePoint)
  const updateMeasurePoint = useTacticalStore((s) => s.updateMeasurePoint)
  const groupRef = useRef<L.LayerGroup | null>(null)
  const lineRef = useRef<L.Polyline | null>(null)

  // 點擊加點（只在量測模式）
  useEffect(() => {
    if (!measuring) return
    const onClick = (e: L.LeafletMouseEvent) => addMeasurePoint({ lat: e.latlng.lat, lng: e.latlng.lng })
    map.on('click', onClick)
    const el = map.getContainer()
    el.style.cursor = 'crosshair'
    return () => {
      map.off('click', onClick)
      el.style.cursor = ''
    }
  }, [measuring, map, addMeasurePoint])

  // 畫線 + 可拖曳控點 + 標籤
  useEffect(() => {
    if (!groupRef.current) groupRef.current = L.layerGroup().addTo(map)
    const g = groupRef.current
    g.clearLayers()
    lineRef.current = null
    if (points.length === 0) return
    const latlngs = points.map((p) => [p.lat, p.lng] as [number, number])
    const line = L.polyline(latlngs, { color: '#22d3ee', weight: 2, dashArray: '5 4' }).addTo(g)
    lineRef.current = line
    points.forEach((p, i) => {
      // 大控點：先點大概位置，再「拖曳」到精準點（放開才更新，避免點不準）
      const handle = L.marker([p.lat, p.lng], {
        draggable: true,
        autoPan: true,
        icon: L.divIcon({ className: '', html: `<div class="measure-handle">${i + 1}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }),
      }).addTo(g)
      // 拖曳中：即時更新折線該點（線跟著手指走）
      handle.on('drag', (e) => {
        const ll = (e.target as L.Marker).getLatLng()
        const cur = line.getLatLngs() as L.LatLng[]
        cur[i] = ll
        line.setLatLngs(cur)
      })
      // 放開：寫回 store（重繪標籤/距離）
      handle.on('dragend', (e) => {
        const ll = (e.target as L.Marker).getLatLng()
        updateMeasurePoint(i, { lat: ll.lat, lng: ll.lng })
      })
      if (i > 0) {
        const a = points[i - 1]
        const dNm = haversineNm(a.lat, a.lng, p.lat, p.lng)
        const brg = bearingDeg(a.lat, a.lng, p.lat, p.lng)
        const mid: [number, number] = [(a.lat + p.lat) / 2, (a.lng + p.lng) / 2]
        L.marker(mid, {
          icon: L.divIcon({
            className: '',
            html: `<div class="measure-label">${dNm.toFixed(2)} 浬 · ${Math.round(brg)}°</div>`,
            iconSize: [96, 16],
            iconAnchor: [48, 8],
          }),
        }).addTo(g)
      }
    })
  }, [points, map, updateMeasurePoint])

  useEffect(
    () => () => {
      if (groupRef.current) {
        groupRef.current.clearLayers()
        map.removeLayer(groupRef.current)
        groupRef.current = null
      }
    },
    [map],
  )

  return null
}

const R = 6371000
const DEG = Math.PI / 180
export function haversineNm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const a =
    Math.sin(((lat2 - lat1) * DEG) / 2) ** 2 +
    Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(((lng2 - lng1) * DEG) / 2) ** 2
  return (2 * R * Math.asin(Math.sqrt(a))) / 1852
}
export function bearingDeg(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const y = Math.sin((lng2 - lng1) * DEG) * Math.cos(lat2 * DEG)
  const x =
    Math.cos(lat1 * DEG) * Math.sin(lat2 * DEG) -
    Math.sin(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.cos((lng2 - lng1) * DEG)
  return (Math.atan2(y, x) / DEG + 360) % 360
}
