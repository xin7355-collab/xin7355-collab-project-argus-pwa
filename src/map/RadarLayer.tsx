import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { useTacticalStore } from '../store/tacticalStore'
import { antennaTopM, radarCoverage, radarColor, radarHorizonKm, RADAR_DEFAULTS } from '../lib/radar'
import { elevation } from '../lib/elevation'
import { formatDist, formatDistBoth } from '../lib/units'
import { lobeStructure } from '../lib/seaPropagation'
import { WIND_FARMS } from '../lib/maritimeRef'
import { fetchWindFarmsOsm, fetchWindTurbinesOsm, attachTurbines, type OsmWindFarm } from '../lib/windfarmOsm'
import { windShadowFor, shadowPolygon, destPoint, DEFAULT_TIP_HEIGHT_M } from '../lib/windRadar'

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
  const updateRadarSite = useTacticalStore((s) => s.updateRadarSite)
  const unit = useTacticalStore((s) => s.distUnit)
  const groupRef = useRef<L.LayerGroup | null>(null)

  // 舊紀錄／手動建的站可能還沒有地面海拔 → 自動補查一次，山頂站才算得出正確大範圍。
  useEffect(() => {
    if (locked) return
    for (const s of sites) {
      if (Number.isFinite(s.siteElevM as number)) continue
      elevation(s.lat, s.lng)
        .then((el) => {
          if (Number.isFinite(el as number)) updateRadarSite(s.id, { siteElevM: el as number })
        })
        .catch(() => {})
    }
  }, [sites, locked, updateRadarSite])

  useEffect(() => {
    if (!show || locked) return
    const g = L.layerGroup().addTo(map)
    groupRef.current = g
    for (const s of sites) {
      const color = radarColor(s.type)
      const cov = radarCoverage(s)
      const km = cov.km
      const horizon = cov.horizonKm
      const limitText = cov.limit === 'power' ? '功率限制' : cov.limit === 'spec' ? '受量程限' : '視距限制'

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
        // 兩者都用「天線頂海拔」與同一 k 值，才跟主涵蓋圈同一套標準。
        const top = antennaTopM(s.siteElevM, s.antennaM)
        const k = s.kFactor ?? RADAR_DEFAULTS.kFactor
        const bigKm = Math.min(radarHorizonKm(top, 10, k), s.maxRangeKm) // 漁船
        const smallKm = Math.min(radarHorizonKm(top, 2, k), s.maxRangeKm) // 小艇
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
            `<b style="color:#f43f5e">小艇死角</b><br/>漁船(10m) 可及 ${formatDist(bigKm, unit)}、小艇(2m) 僅 ${formatDist(smallKm, unit)}<br/>` +
              `<span style="color:#94a3b8;font-size:11px">紅色環內只保證看得到大船；相鄰站的小艇圈之間＝低矮目標死角</span>`,
          )
          .addTo(g)

        // 多路徑零陷環：即使在涵蓋圈內、視距也通，落在這些距離的低矮目標仍可能
        // 收不到回波。與「圈縫死角」是不同機制，因此用不同線型（點線）區隔。
        const lobes = lobeStructure(top, s.targetM, s.freqGhz ?? RADAR_DEFAULTS.freqGhz, km)
        for (const nullKm of lobes.nullsKm) {
          L.circle([s.lat, s.lng], {
            radius: nullKm * 1000,
            color: '#fb7185',
            weight: 1,
            opacity: 0.55,
            dashArray: '1 6',
            fill: false,
          })
            .bindPopup(
              `<b style="color:#fb7185">多路徑零陷</b><br/>${formatDist(nullKm, unit)}<br/>` +
                `<span style="color:#94a3b8;font-size:11px">海面反射與直達波在此距離抵銷，` +
                `${s.targetM}m 高的目標可能收不到回波。目標越矮、頻率越高，零陷越密。</span>`,
            )
            .addTo(g)
        }
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
          html: `<div class="radar-marker" style="border-color:${color};color:${color}">📡<div class="radar-label" style="color:${color}">${s.name}<br/>${formatDist(km, unit)}</div></div>`,
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
          `📡 ${s.name}｜涵蓋 ${formatDistBoth(km, unit)}（${limitText}；地平線 ${formatDist(horizon, unit)}` +
            `${Number.isFinite(cov.powerKm) ? `／功率 ${formatDist(cov.powerKm, unit)}` : ''}）· 點我編輯`,
          { direction: 'top', offset: [0, -14] },
        )
        .addTo(g)
    }
    return () => {
      g.clearLayers()
      map.removeLayer(g)
      groupRef.current = null
    }
  }, [show, sites, gap, terrainRings, showTerrain, locked, setOpenTool, setEditingId, unit, map])

  return null
}

/**
 * 離岸風電雷達雜波區：把離岸風電場標成「雷達雜波／陰影」——風機在雷達上造成假回波
 * 與後方遮蔽，此區偵測可信度低（人工/AIS/光學交叉查證）。
 */
export function WindClutterLayer({ map }: { map: L.Map }) {
  const show = useTacticalStore((s) => s.showWindClutter)
  const sites = useTacticalStore((s) => s.radarSites)
  const locked = useTacticalStore((s) => s.secureHasLock && !s.secureUnlocked)
  const unit = useTacticalStore((s) => s.distUnit)
  const groupRef = useRef<L.LayerGroup | null>(null)
  // OSM 風場邊界＋風機高度。抓不到就退回內建示意範圍（見下方 fallback）。
  const [farms, setFarms] = useState<OsmWindFarm[] | null>(null)

  useEffect(() => {
    if (!show || locked) return
    let cancelled = false
    Promise.all([fetchWindFarmsOsm(), fetchWindTurbinesOsm()])
      .then(([f, t]) => {
        if (!cancelled && f.length) setFarms(attachTurbines(f, t))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [show, locked])

  useEffect(() => {
    if (!show || locked) return
    const g = L.layerGroup().addTo(map)
    groupRef.current = g

    // 沒有 OSM 資料時，用內建示意中心＋半徑組出概略多邊形（圓），
    // 至少比原本的長方形貼近實際範圍。
    const list: OsmWindFarm[] =
      farms ??
      WIND_FARMS.map((wf) => ({
        name: wf.name,
        status: wf.status,
        center: [wf.lat, wf.lng] as [number, number],
        ring: Array.from({ length: 24 }, (_, i) => destPoint(wf.lat, wf.lng, (i / 24) * 360, wf.radiusKm)),
      }))

    for (const wf of list) {
      const tipTxt =
        wf.tipHeightM != null
          ? `葉尖高約 ${Math.round(wf.tipHeightM)}m（OSM ${wf.turbines?.length ?? 0} 支風機）`
          : `葉尖高未知，以 ${DEFAULT_TIP_HEIGHT_M}m 推定`

      // ── 效應一：Doppler 假回跡（風場範圍本身，與高度無關）──
      L.polygon(wf.ring, {
        color: '#f43f5e',
        weight: 1.5,
        opacity: 0.75,
        dashArray: '3 3',
        fillColor: '#f43f5e',
        fillOpacity: 0.14,
      })
        .bindPopup(
          `<b style="color:#f43f5e">📡⚠ Doppler 假回跡區</b><br/>${wf.name}<br/>` +
            `<span style="color:#94a3b8;font-size:11px">葉尖速度可達 80–90m/s，都卜勒頻移與移動船隻同量級，` +
            `MTI 濾不掉 → 此區可能出現<b>不存在的移動目標</b>。與高度無關，雷達再高也照樣發生。<br/>` +
            `建議 AIS／光學交叉查證。<br/>${tipTxt}</span>`,
        )
        .addTo(g)

      L.marker(wf.center, {
        icon: L.divIcon({
          className: '',
          html: `<div class="clutter-label">📡⚠ 假回跡</div>`,
          iconSize: [64, 16],
          iconAnchor: [32, 8],
        }),
      }).addTo(g)

      // ── 效應二：塔架幾何遮蔽（依各雷達站位置與天線高分別計算）──
      for (const s of sites) {
        if (s.off) continue
        const cov = radarCoverage(s)
        const sh = windShadowFor(
          {
            lat: s.lat,
            lng: s.lng,
            antennaTopM: antennaTopM(s.siteElevM, s.antennaM),
            targetM: s.targetM,
            maxKm: cov.km,
            kFactor: s.kFactor ?? RADAR_DEFAULTS.kFactor,
          },
          wf,
        )
        if (!sh) continue
        L.polygon(shadowPolygon({ lat: s.lat, lng: s.lng }, sh), {
          color: '#64748b',
          weight: 1,
          opacity: 0.6,
          fillColor: '#0f172a',
          fillOpacity: 0.35,
        })
          .bindPopup(
            `<b style="color:#94a3b8">🌑 風機遮蔽（${s.name} 視角）</b><br/>` +
              `${wf.name} 後方 ${formatDist(sh.startKm, unit)} – ${formatDist(sh.endKm, unit)}<br/>` +
              `<span style="color:#94a3b8;font-size:11px">` +
              (sh.fullyShadowed
                ? `<b>後方整段被遮</b>，${s.targetM}m 目標看不到。` +
                  (sh.antennaBelowTip
                    ? `此站天線頂 ${Math.round(antennaTopM(s.siteElevM, s.antennaM))}m 低於葉尖 ${Math.round(sh.tipM)}m。`
                    : `此站天線頂雖高於葉尖，但朝 ${s.targetM}m 低目標的視線是下降的，` +
                      `到風場處已降到葉尖以下，涵蓋範圍內都沒再高上去。`)
                : `僅遮蔽近段，更遠處視線已高過葉尖而恢復。`) +
              `<br/>${sh.tipEstimated ? '⚠ 葉尖高為推定值（OSM 無高度標籤）' : ''}</span>`,
          )
          .addTo(g)
      }
    }
    return () => {
      g.clearLayers()
      map.removeLayer(g)
      groupRef.current = null
    }
  }, [show, locked, farms, sites, unit, map])

  return null
}
