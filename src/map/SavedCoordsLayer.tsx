import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useTacticalStore } from '../store/tacticalStore'
import { fmtDDM } from '../lib/coordParse'

/**
 * 已釘選座標的長駐記號：跨所有模式顯示，切頁面不會不見，直到取消釘選。
 */
export function SavedCoordsLayer({ map }: { map: L.Map }) {
  const saved = useTacticalStore((s) => s.savedCoords)
  const groupRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!groupRef.current) groupRef.current = L.layerGroup().addTo(map)
    const g = groupRef.current
    g.clearLayers()
    for (const c of saved.filter((x) => x.pinned)) {
      L.marker([c.lat, c.lng], {
        icon: L.divIcon({
          className: '',
          html: `<div class="pin-marker">📌</div>`,
          iconSize: [26, 26],
          iconAnchor: [6, 24],
        }),
        zIndexOffset: 900,
      })
        .bindPopup(
          `<b style="color:#f472b6">📌 ${escapeHtml(c.label)}</b><br/>` +
            `<span style="font-family:ui-monospace,monospace">${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}</span><br/>` +
            `<span style="color:#94a3b8;font-size:11px">${fmtDDM(c.lat, c.lng)}</span>`,
        )
        .addTo(g)
    }
  }, [saved, map])

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

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)
}
