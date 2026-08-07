import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useTacticalStore } from '../store/tacticalStore'
import { coverage, repeaterColor, linkStatus, linkColor, windFarmsOnPath, deadZones } from '../lib/radio'
import { WIND_FARMS } from '../lib/maritimeRef'

/**
 * 無線電中繼台覆蓋圖層：把使用者自建的中繼台畫成半透明涵蓋圈
 * （依視距＋功率鏈路預算取小）。私密，只存本機。
 * 若設了「現場單位」座標，畫每個站台→單位的連線＋距離＋數位鏈路研判。
 */
export function RadioLayer({ map }: { map: L.Map }) {
  const show = useTacticalStore((s) => s.showRepeater)
  const repeaters = useTacticalStore((s) => s.repeaters)
  const probe = useTacticalStore((s) => s.radioProbe)
  const terrainRings = useTacticalStore((s) => s.terrainRings)
  const showTerrain = useTacticalStore((s) => s.showTerrain)
  const radioEdit = useTacticalStore((s) => s.radioEdit)
  const showGap = useTacticalStore((s) => s.showRadioGap)
  const updateRepeater = useTacticalStore((s) => s.updateRepeater)
  const setOpenTool = useTacticalStore((s) => s.setOpenTool)
  const setEditingId = useTacticalStore((s) => s.setRadioEditingId)
  const groupRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!show) return
    const g = L.layerGroup().addTo(map)
    groupRef.current = g

    // 通訊死角：多台覆蓋聯集後仍收不到的網格（鋪在最底層，涵蓋圈畫其上）
    // 開啟地形時用「被山切出的真實形狀」判定，故山後（圓內卻遮蔽）也會標為死角。
    if (showGap && repeaters.length) {
      const dz = deadZones(repeaters, { rings: terrainRings, useTerrain: showTerrain })
      const hLat = dz.dLat / 2
      const hLng = dz.dLng / 2
      for (const [lat, lng] of dz.cells) {
        L.rectangle(
          [
            [lat - hLat, lng - hLng],
            [lat + hLat, lng + hLng],
          ],
          { stroke: false, fillColor: '#f43f5e', fillOpacity: 0.22, interactive: false },
        ).addTo(g)
      }
      useTacticalStore.getState().setRadioGapTerrain(dz.terrainUsed)
    }

    for (const r of repeaters) {
      const cov = coverage(r)
      const col = repeaterColor(r.id) // 每站不同色（依 id 穩定）
      const ring = terrainRings[r.id]
      if (showTerrain && ring && ring.length >= 3) {
        // 地形遮蔽覆蓋多邊形（被山切出的真實形狀）
        L.polygon(ring, {
          color: col,
          weight: 2,
          opacity: 0.9,
          fillColor: col,
          fillOpacity: 0.18,
          lineJoin: 'round',
        }).addTo(g)
      } else {
        // 半透明涵蓋圈（視距/自由空間估算）
        L.circle([r.lat, r.lng], {
          radius: cov.km * 1000,
          color: col,
          weight: 2,
          opacity: 0.85,
          fillColor: col,
          fillOpacity: 0.18,
        }).addTo(g)
      }
      // 中繼台記號 + 名稱/涵蓋（編輯模式可拖曳微調）
      const marker = L.marker([r.lat, r.lng], {
        draggable: radioEdit,
        autoPan: radioEdit,
        icon: L.divIcon({
          className: '',
          html: `<div class="radio-marker" style="border-color:${col};color:${col}${radioEdit ? ';box-shadow:0 0 0 2px #fbbf24' : ''}">📻<div class="radio-label" style="color:${col}">${r.name}<br/>${cov.km.toFixed(1)}km${radioEdit ? ' ✋' : ''}</div></div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        }),
      })
      if (radioEdit) {
        marker.on('dragend', (e) => {
          const ll = (e.target as L.Marker).getLatLng()
          updateRepeater(r.id, { lat: ll.lat, lng: ll.lng })
        })
      }
      // 點記號 → 開面板並帶入此站編輯（看覆蓋/改參數/算此站地形）
      marker.on('click', () => {
        setEditingId(r.id)
        setOpenTool('radio')
      })
      marker
        .bindTooltip(
          `📻 ${r.name}｜覆蓋 ${cov.km.toFixed(1)}km（${cov.limit === 'los' ? '視距' : '功率'}限制）· 點我編輯`,
          { direction: 'top', offset: [0, -14] },
        )
        .addTo(g)
    }

    // 現場單位（數位回傳座標）：畫每個站台→單位連線＋距離＋鏈路研判
    if (probe) {
      let bestText = ''
      let bestLevel: 'good' | 'marginal' | 'none' = 'none'
      let bestMargin = -Infinity
      for (const r of repeaters) {
        const ls = linkStatus(r, probe.lat, probe.lng)
        const col = linkColor(ls.level)
        // 只畫視距內、或雖超出但想看關係——這裡一律畫線但用顏色區分
        L.polyline(
          [
            [r.lat, r.lng],
            [probe.lat, probe.lng],
          ],
          { color: col, weight: 1.5, opacity: ls.level === 'none' ? 0.35 : 0.85, dashArray: ls.level === 'none' ? '3 5' : undefined },
        ).addTo(g)
        // 路徑穿越離岸風電場：疊一條琥珀虛線提示干擾（多重路徑/遮蔽）
        const wf = windFarmsOnPath(r.lat, r.lng, probe.lat, probe.lng, WIND_FARMS)
        if (wf.length) {
          L.polyline(
            [
              [r.lat, r.lng],
              [probe.lat, probe.lng],
            ],
            { color: '#fbbf24', weight: 1, opacity: 0.9, dashArray: '1 6' },
          )
            .bindPopup(`🌀 此路徑穿越離岸風電場：${wf.join('、')}<br/>旋轉葉片+金屬塔→多重路徑衰落/遮蔽，訊號可能忽強忽弱`)
            .addTo(g)
        }
        const mid: [number, number] = [(r.lat + probe.lat) / 2, (r.lng + probe.lng) / 2]
        L.marker(mid, {
          icon: L.divIcon({
            className: '',
            html: `<div class="radio-dist" style="border-color:${col};color:${col}">${(ls.distM / 1000).toFixed(1)}km／${(ls.distM / 1852).toFixed(1)}浬${wf.length ? ' 🌀' : ''}</div>`,
            iconSize: [92, 16],
            iconAnchor: [46, 8],
          }),
        }).addTo(g)
        // 記錄最佳台（以實際鏈路餘裕挑，而非只看等級，避免同級時挑到較弱的）
        if (ls.marginDb > bestMargin) {
          bestMargin = ls.marginDb
          bestLevel = ls.level
          bestText = `經「${r.name}」：${ls.text}｜餘裕 ${ls.marginDb.toFixed(0)}dB｜方位 ${ls.bearing.toFixed(0)}°`
        }
      }
      const pcol = linkColor(bestLevel)
      L.marker([probe.lat, probe.lng], {
        icon: L.divIcon({
          className: '',
          html: `<div class="radio-unit" style="border-color:${pcol}">📍<div class="radio-label" style="color:${pcol}">${probe.label || '現場單位'}</div></div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        }),
        zIndexOffset: 1500,
      })
        .bindPopup(
          `<b style="color:${pcol}">📍 ${probe.label || '現場單位'}</b><br/>` +
            `<span style="font-family:ui-monospace,monospace">${probe.lat.toFixed(5)}, ${probe.lng.toFixed(5)}</span><br/>` +
            (repeaters.length ? bestText : '尚未建任何中繼台'),
          { autoPan: false }, // 圖層切換重繪時不再把地圖拉回置中（避免抖動）
        )
        .openPopup()
        .addTo(g)
    }

    return () => {
      g.clearLayers()
      map.removeLayer(g)
      groupRef.current = null
    }
  }, [show, repeaters, probe, terrainRings, showTerrain, radioEdit, showGap, updateRepeater, setOpenTool, setEditingId, map])

  return null
}
