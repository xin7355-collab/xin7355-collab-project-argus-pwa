import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useTacticalStore } from '../store/tacticalStore'
import { fmtDDM } from '../lib/coordParse'

/**
 * 搜尋定位預覽圖層：地址/地名/電線桿搜尋後，在地圖放一個醒目的暫時標記 📍。
 * 這個標記**純暫時**——不存 localStorage、不寫入「最近用過」，離開/重整即消失。
 * 要保留請用面板的「釘選 / 存成點位」。
 */
export function SearchMarkerLayer({ map }: { map: L.Map }) {
  const marker = useTacticalStore((s) => s.searchMarker)
  const groupRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!groupRef.current) groupRef.current = L.layerGroup().addTo(map)
    const g = groupRef.current
    g.clearLayers()
    if (!marker) return

    const m = L.marker([marker.lat, marker.lng], {
      icon: L.divIcon({
        className: '',
        html:
          `<div class="search-pin"><span>📍</span></div>` +
          `<div class="search-pin-label">${escapeHtml(marker.label)}</div>`,
        iconSize: [34, 34],
        iconAnchor: [17, 34],
      }),
      zIndexOffset: 1200,
    }).bindPopup(
      `<div style="font-family:ui-monospace,monospace;line-height:1.5">` +
        `<b style="color:#f59e0b">📍 搜尋定位（暫時，未儲存）</b><br/>` +
        `<span style="color:#e2e8f0">${escapeHtml(marker.label)}</span><br/>` +
        `${marker.lat.toFixed(5)}, ${marker.lng.toFixed(5)}<br/>` +
        `<span style="color:#94a3b8;font-size:11px">${fmtDDM(marker.lat, marker.lng)}</span><br/>` +
        `<span style="color:#94a3b8;font-size:11px">離開或重整即消失。要保留請按「釘選 / 存成點位」。</span>` +
        `</div>`,
    )
    m.addTo(g)
    m.openPopup()
  }, [marker, map])

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
