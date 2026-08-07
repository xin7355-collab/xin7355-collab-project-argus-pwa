import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useTacticalStore } from '../store/tacticalStore'
import { fetchEnvGrid } from '../lib/marineEnv'

/**
 * 風場圖層（跨模式常駐）：由圖層視窗打勾開啟。抓當前視野網格的即時風向風速
 * （Open-Meteo，免金鑰），畫青色風羽箭頭；平移地圖時自動重抓（去抖）。
 */
export function WindLayer({ map }: { map: L.Map }) {
  const showWind = useTacticalStore((s) => s.showWind)
  const setStatus = useTacticalStore((s) => s.setStatus)
  const groupRef = useRef<L.LayerGroup | null>(null)
  const debRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!showWind) return
    const group = L.layerGroup().addTo(map)
    groupRef.current = group
    let cancelled = false
    let gen = 0 // 世代序號：只讓「最新一次」的抓取結果繪製，避免重疊抓取畫到舊資料

    const load = async () => {
      const myGen = ++gen
      const b = map.getBounds()
      const cols = 7
      const rows = 5
      const pts: [number, number][] = []
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          const lat = b.getSouth() + ((b.getNorth() - b.getSouth()) * (r + 0.5)) / rows
          const lng = b.getWest() + ((b.getEast() - b.getWest()) * (c + 0.5)) / cols
          pts.push([lat, lng])
        }
      setStatus('風場：載入即時風向風速…')
      const env = await fetchEnvGrid(pts).catch(() => [])
      if (cancelled || myGen !== gen || !groupRef.current) return
      group.clearLayers()
      const spanKm = (b.getNorth() - b.getSouth()) * 111
      const base = Math.max(1500, (spanKm / rows) * 1000 * 0.32) // 依縮放調整箭頭長度
      pts.forEach((p, i) => {
        const e = env[i]
        if (!e) return
        // windDir 為「來向」；+180 = 去向（箭頭指向風吹去的方向）
        drawArrow(group, p[0], p[1], (e.windDir + 180) % 360, base + e.windSpeed * base * 0.12, '#22d3ee')
      })
      setStatus('風場：即時風向風速（Open-Meteo）。箭頭＝風吹去的方向')
    }

    const onMove = () => {
      if (debRef.current) clearTimeout(debRef.current)
      debRef.current = setTimeout(load, 700)
    }
    map.on('moveend', onMove)
    load()

    return () => {
      cancelled = true
      map.off('moveend', onMove)
      if (debRef.current) clearTimeout(debRef.current)
      group.clearLayers()
      map.removeLayer(group)
      groupRef.current = null
    }
  }, [showWind, map, setStatus])

  return null
}

const DEG = Math.PI / 180
const R = 6371000
function dest(lat: number, lng: number, bearingDeg: number, distM: number) {
  const b = bearingDeg * DEG
  return {
    lat: lat + ((distM * Math.cos(b)) / R) / DEG,
    lng: lng + ((distM * Math.sin(b)) / (R * Math.cos(lat * DEG))) / DEG,
  }
}
function drawArrow(group: L.LayerGroup, lat: number, lng: number, bearing: number, lengthM: number, color: string) {
  const tip = dest(lat, lng, bearing, lengthM)
  const style: L.PolylineOptions = { color, weight: 2, opacity: 0.8, dashArray: '4 3' }
  L.polyline([[lat, lng], [tip.lat, tip.lng]], style).addTo(group)
  const wing = lengthM * 0.32
  const l = dest(tip.lat, tip.lng, bearing + 150, wing)
  const r = dest(tip.lat, tip.lng, bearing - 150, wing)
  L.polyline([[tip.lat, tip.lng], [l.lat, l.lng]], style).addTo(group)
  L.polyline([[tip.lat, tip.lng], [r.lat, r.lng]], style).addTo(group)
}
