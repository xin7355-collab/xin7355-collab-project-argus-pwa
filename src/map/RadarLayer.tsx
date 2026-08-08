import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useTacticalStore } from '../store/tacticalStore'
import { coverageKm, radarColor, radarHorizonKm } from '../lib/radar'
import { WIND_FARMS } from '../lib/maritimeRef'

/**
 * 雷達涵蓋圖層：把使用者自建的雷達站畫成涵蓋圈（依雷達地平線＋目標高度）。
 * 圈與圈之間的縫＝偵測死角，就是非法越界小艇可能鑽的地方。私密，只存本機。
 */
export function RadarLayer({ map }: { map: L.Map }) {
  const show = useTacticalStore((s) => s.showRadar)
  const sites = useTacticalStore((s) => s.radarSites)
  const gap = useTacticalStore((s) => s.showRadarGap)
  const terrainRings = useTacticalStore((s) => s.radarTerrainRings)
  const showTerrain = useTacticalStore((s) => s.showRadarTerrain)
  const locked = useTacticalStore((s) => s.secureHasLock && !s.secureUnlocked)
  const setOpenTool = useTacticalStore((s) => s.setOpenTool)
  const setEditingId = useTacticalStore((s) => s.setRadarEditingId)
  const groupRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!show || locked) return
    const g = L.layerGroup().addTo(map)
    groupRef.current = g
    for (const s of sites) {
      const color = radarColor(s.type)
      const km = coverageKm(s)
      const horizon = radarHorizonKm(s.antennaM, s.targetM)
      const capped = horizon > s.maxRangeKm

      // 個別關閉的雷達站：不畫涵蓋/死角環，只留灰暗記號（點一下可編輯／開回）。
      if (s.off) {
        const offMarker = L.marker([s.lat, s.lng], {
          icon: L.divIcon({
            className: '',
            html: `<div class="radar-marker" style="border-color:#64748b;color:#64748b;opacity:0.6">📡<div class="radar-label" style="color:#94a3b8">${s.name}<br/>（已關閉）</div></div>`,
            iconSize: [30, 30],
            iconAnchor: [15, 15],
          }),
        })
        offMarker.on('click', () => {
          setEditingId(s.id)
          setOpenTool('radar')
        })
        offMarker.bindTooltip(`📡 ${s.name}｜已關閉（點我編輯／開回）`, { direction: 'top', offset: [0, -14] }).addTo(g)
        continue
      }
      // 小艇死角高亮：漁船(10m) 對比 小艇(2m) 涵蓋，凸顯只看得到大船的環＋縫。
      if (gap) {
        const bigKm = Math.min(radarHorizonKm(s.antennaM, 10), s.maxRangeKm) // 漁船
        const smallKm = Math.min(radarHorizonKm(s.antennaM, 2), s.maxRangeKm) // 小艇
        // 外環（漁船看得到，紅色淡填＝此範圍只保證看得到大船）
        L.circle([s.lat, s.lng], {
          radius: bigKm * 1000,
          color: '#f43f5e',
          weight: 1,
          opacity: 0.5,
          dashArray: '2 5',
          fillColor: '#f43f5e',
          fillOpacity: 0.1,
        }).addTo(g)
        // 內環（小艇也看得到，較安全）——實線
        L.circle([s.lat, s.lng], {
          radius: smallKm * 1000,
          color: '#fca5a5',
          weight: 1.5,
          opacity: 0.8,
          fill: false,
        })
          .bindPopup(
            `<b style="color:#f43f5e">小艇死角</b><br/>漁船(10m) 可及 ${bigKm.toFixed(1)}km、小艇(2m) 僅 ${smallKm.toFixed(1)}km<br/>` +
              `<span style="color:#94a3b8;font-size:11px">紅色環內只保證看得到大船；相鄰站的小艇圈之間＝低矮目標死角</span>`,
          )
          .addTo(g)
      }
      // 涵蓋：地形遮蔽多邊形（若已算）或圓圈
      const tRing = terrainRings[s.id]
      if (showTerrain && tRing && tRing.length >= 3) {
        L.polygon(tRing, { color, weight: 2, opacity: 0.9, fillColor: color, fillOpacity: 0.08, lineJoin: 'round' }).addTo(g)
      } else {
        L.circle([s.lat, s.lng], {
          radius: km * 1000,
          color,
          weight: 2,
          opacity: 0.85,
          dashArray: '4 4',
          fillColor: color,
          fillOpacity: 0.08,
        }).addTo(g)
      }
      // 站點
      const marker = L.marker([s.lat, s.lng], {
        icon: L.divIcon({
          className: '',
          html: `<div class="radar-marker" style="border-color:${color};color:${color}">📡<div class="radar-label" style="color:${color}">${s.name}<br/>${km.toFixed(1)}km</div></div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        }),
      })
      // 點記號 → 開面板並帶入此站編輯（改參數/算此站地形/看涵蓋）
      marker.on('click', () => {
        setEditingId(s.id)
        setOpenTool('radar')
      })
      marker
        .bindTooltip(
          `📡 ${s.name}｜涵蓋 ${km.toFixed(1)}km（地平線 ${horizon.toFixed(1)}km${capped ? '·受量程限' : ''}）· 點我編輯`,
          { direction: 'top', offset: [0, -14] },
        )
        .addTo(g)
    }
    return () => {
      g.clearLayers()
      map.removeLayer(g)
      groupRef.current = null
    }
  }, [show, sites, gap, terrainRings, showTerrain, locked, setOpenTool, setEditingId, map])

  return null
}

/**
 * 離岸風電雷達雜波區：把離岸風電場標成「雷達雜波／陰影」——風機在雷達上造成假回波
 * 與後方遮蔽，此區偵測可信度低（人工/AIS/光學交叉查證）。
 */
export function WindClutterLayer({ map }: { map: L.Map }) {
  const show = useTacticalStore((s) => s.showWindClutter)
  const locked = useTacticalStore((s) => s.secureHasLock && !s.secureUnlocked)
  const groupRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!show || locked) return
    const g = L.layerGroup().addTo(map)
    groupRef.current = g
    for (const wf of WIND_FARMS) {
      const dLat = wf.radiusKm / 111
      const dLng = wf.radiusKm / (111 * Math.cos((wf.lat * Math.PI) / 180))
      L.rectangle(
        [
          [wf.lat - dLat, wf.lng - dLng],
          [wf.lat + dLat, wf.lng + dLng],
        ],
        { color: '#f43f5e', weight: 1.5, opacity: 0.7, dashArray: '3 3', fillColor: '#f43f5e', fillOpacity: 0.14 },
      )
        .bindPopup(
          `<b style="color:#f43f5e">📡⚠ 雷達雜波區</b><br/>${wf.name}<br/>` +
            `<span style="color:#94a3b8;font-size:11px">風機造成假回波與後方遮蔽，此區雷達偵測可信度低；建議 AIS/光學交叉查證</span>`,
        )
        .addTo(g)
      L.marker([wf.lat, wf.lng], {
        icon: L.divIcon({
          className: '',
          html: `<div class="clutter-label">📡⚠ 雜波</div>`,
          iconSize: [56, 16],
          iconAnchor: [28, 8],
        }),
      }).addTo(g)
    }
    return () => {
      g.clearLayers()
      map.removeLayer(g)
      groupRef.current = null
    }
  }, [show, locked, map])

  return null
}
