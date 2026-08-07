import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useTacticalStore } from '../store/tacticalStore'
import { fmtDDM } from '../lib/coordParse'

/**
 * 自訂點位圖層：跨所有模式長駐顯示（檢查據點/分署等）。
 * 只畫「可見群組」的點；總開關 poiHidden 開啟時全部隱藏（保護隱私）。
 */
export function PoiLayer({ map }: { map: L.Map }) {
  const groups = useTacticalStore((s) => s.poiGroups)
  const points = useTacticalStore((s) => s.poiPoints)
  const hidden = useTacticalStore((s) => s.poiHidden)
  const groupRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!groupRef.current) groupRef.current = L.layerGroup().addTo(map)
    const g = groupRef.current
    g.clearLayers()
    if (hidden) return

    const byId = new Map(groups.map((gr) => [gr.id, gr]))
    for (const p of points) {
      const grp = byId.get(p.groupId)
      if (!grp || !grp.visible) continue
      L.marker([p.lat, p.lng], {
        icon: L.divIcon({
          className: '',
          html:
            `<div class="poi-marker" style="border-color:${grp.color};box-shadow:0 0 6px ${grp.color}">` +
            `<span>${grp.icon}</span></div>` +
            `<div class="poi-label" style="color:${grp.color}">${escapeHtml(p.label)}</div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        }),
        zIndexOffset: 800,
      })
        .bindPopup(
          `<div style="font-family:ui-monospace,monospace;line-height:1.5">` +
            `<b style="color:${grp.color}">${grp.icon} ${escapeHtml(p.label)}</b><br/>` +
            `<span style="color:#94a3b8;font-size:11px">${escapeHtml(grp.name)}</span><br/>` +
            `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}<br/>` +
            `<span style="color:#94a3b8;font-size:11px">${fmtDDM(p.lat, p.lng)}</span>` +
            (p.elevM != null ? `<br/>⛰️ 海拔 ${Math.round(p.elevM)} m` : '') +
            (p.note ? `<br/><span style="color:#cbd5e1">${escapeHtml(p.note)}</span>` : '') +
            `</div>`,
        )
        .addTo(g)
    }
  }, [groups, points, hidden, map])

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
