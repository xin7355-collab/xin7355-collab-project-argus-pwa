import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useTacticalStore } from '../store/tacticalStore'
import { fetchVisibilityGrid, classifyVisibility } from '../lib/visibility'

/**
 * 能見度/霧況圖層（跨模式常駐）：抓當前視野網格的即時能見度，把低能見海域上色，
 * 濃霧最紅。平移地圖時去抖重抓。能見度＝瞭望/目視偵蒐距離的天花板。
 */
export function VisibilityLayer({ map }: { map: L.Map }) {
  const show = useTacticalStore((s) => s.showVisibility)
  const setStatus = useTacticalStore((s) => s.setStatus)
  const groupRef = useRef<L.LayerGroup | null>(null)
  const debRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!show) return
    const group = L.layerGroup().addTo(map)
    groupRef.current = group
    let cancelled = false
    let gen = 0

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
      setStatus('能見度：載入即時霧況…')
      const vis = await fetchVisibilityGrid(pts).catch(() => [] as (number | null)[])
      if (cancelled || myGen !== gen || !groupRef.current) return
      group.clearLayers()
      const hLat = (b.getNorth() - b.getSouth()) / rows / 2
      const hLng = (b.getEast() - b.getWest()) / cols / 2
      let foggy = 0
      pts.forEach((p, i) => {
        const v = vis[i]
        if (v == null) return
        const cls = classifyVisibility(v)
        if (v >= 10000) return // 良好能見度不塗色，保持畫面乾淨（只凸顯霧區）
        if (v < 4000) foggy++
        L.rectangle(
          [
            [p[0] - hLat, p[1] - hLng],
            [p[0] + hLat, p[1] + hLng],
          ],
          { stroke: false, fillColor: cls.color, fillOpacity: v < 1000 ? 0.34 : 0.2 },
        )
          .bindPopup(`<b style="color:${cls.color}">能見度 ${cls.label}</b><br/>約 ${(v / 1000).toFixed(1)} km｜目視/瞭望偵蒐距離的上限`)
          .addTo(group)
      })
      setStatus(
        foggy > 0
          ? `能見度：⚠ ${foggy} 區低能見(<4km)——霧區非法越界/可疑運輸易鑽，倚重雷達/AIS`
          : '能見度：目前視野內大致良好（>10km 不上色）',
      )
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
  }, [show, map, setStatus])

  return null
}
