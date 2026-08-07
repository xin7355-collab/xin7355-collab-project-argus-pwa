import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useTacticalStore } from '../store/tacticalStore'
import { subscribeAIS, isAisConfigured, type Vessel, type BBox } from '../lib/ais'
import { analyzeVessel } from '../lib/aisAnomaly'
import { buildGibsBoatLights } from '../lib/gibs'
import { buildWmsConfig, LAYERS, isSentinelConfigured } from '../lib/sentinel'

/** 前一天日期（YYYY-MM-DD）——夜間漁火/雷達影像用最近可用日最保險。 */
function yesterdayYmd(): string {
  return new Date(Date.now() - 86400000).toISOString().slice(0, 10)
}

/**
 * AIS 船舶圖層。只在 ais 模式運行：訂閱 AIS → 畫出船隻（三角形依航向旋轉）
 * → 點擊看船名/MMSI/航速/船種。離開模式時取消訂閱（關 WebSocket / 清 timer）。
 */
export function AisLayer({ map }: { map: L.Map }) {
  const mode = useTacticalStore((s) => s.mode)
  const setVessels = useTacticalStore((s) => s.setVessels)
  const setStatus = useTacticalStore((s) => s.setStatus)
  const showBoatLights = useTacticalStore((s) => s.showBoatLights)
  const showRadarVessels = useTacticalStore((s) => s.showRadarVessels)
  const groupRef = useRef<L.LayerGroup | null>(null)
  const lightsRef = useRef<L.TileLayer | null>(null)
  const radarRef = useRef<L.TileLayer | null>(null)

  useEffect(() => {
    if (mode !== 'ais') return

    const group = L.layerGroup().addTo(map)
    groupRef.current = group
    setStatus(
      isAisConfigured()
        ? 'AIS：連線 aisstream.io 即時船位（等船回報，約數十秒）'
        : 'AIS：模擬船隻展示中（⚙️ 設定填 AISStream 金鑰可接真實資料）',
    )

    // 進 AIS 若地圖放太大（看不到船），縮到「目前位置周邊」而非硬跳台灣，
    // 這樣使用者在哪裡就看哪裡的船（訂閱框跟著視野走）。
    if (map.getZoom() > 9) map.setZoom(8)

    // 點船「攔截／推算此船」：把船位與 COG/SOG 帶進對應面板（免手打）。
    const store = useTacticalStore.getState()
    const toTool = (v: Vessel, tool: 'intercept' | 'dr') => {
      store.setTargetPrefill({ lat: v.lat, lng: v.lng, cog: v.cog, sog: v.sog, name: v.name })
      store.setOpenTool(tool)
      map.closePopup()
    }

    // 目前視野的邊界框（AISStream 格式：[[南,西],[北,東]]）。
    const boxOf = (): BBox => {
      const b = map.getBounds()
      return [
        [b.getSouth(), b.getWest()],
        [b.getNorth(), b.getEast()],
      ]
    }

    const handle = subscribeAIS(
      (vessels) => {
        setVessels(vessels)
        group.clearLayers()
        for (const v of vessels) drawVessel(group, v, toTool)
      },
      (s) => setStatus(s), // 連線狀態回報到狀態列
      boxOf(),
    )

    // 移動/縮放地圖 → 更新訂閱範圍（防抖，避免拖曳時狂送）。
    let moveTimer: ReturnType<typeof setTimeout> | null = null
    const onMove = () => {
      if (moveTimer) clearTimeout(moveTimer)
      moveTimer = setTimeout(() => handle.setBox(boxOf()), 400)
    }
    map.on('moveend zoomend', onMove)

    return () => {
      map.off('moveend zoomend', onMove)
      if (moveTimer) clearTimeout(moveTimer)
      handle.stop() // 取消訂閱：關 WebSocket / 清 interval
      group.clearLayers()
      map.removeLayer(group)
      groupRef.current = null
      // 注意：不清空 store 的 vessels——保留最後已知 AIS，供光學亮點掃描做
      //「無AIS=可疑暗船」比對（見 BrightSpotLayer / store setMode 的說明）。
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  // ── 🌙 VIIRS 夜間漁火 疊層（免金鑰）──────────────────
  useEffect(() => {
    const remove = () => {
      if (lightsRef.current) {
        map.removeLayer(lightsRef.current)
        // @ts-expect-error 清 Leaflet 內部圖磚快取，釋放記憶體
        lightsRef.current._tiles = {}
        lightsRef.current = null
      }
    }
    if (mode === 'ais' && showBoatLights) {
      const layer = buildGibsBoatLights(yesterdayYmd())
      layer.addTo(map)
      lightsRef.current = layer
      setStatus('🌙 已疊夜間漁火（VIIRS）：外海亮點＝開燈作業漁船；夜間才有、白天無效')
    } else {
      remove()
    }
    return remove
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, showBoatLights])

  // ── 📡 Sentinel-1 雷達暗船 疊層（需金鑰）─────────────
  useEffect(() => {
    const remove = () => {
      if (radarRef.current) {
        map.removeLayer(radarRef.current)
        // @ts-expect-error 清 Leaflet 內部圖磚快取，釋放記憶體
        radarRef.current._tiles = {}
        radarRef.current = null
      }
    }
    if (mode === 'ais' && showRadarVessels && isSentinelConfigured()) {
      const { url, params } = buildWmsConfig({ layer: LAYERS.sarVV, date: yesterdayYmd(), lookbackDays: 12 })
      const wms = L.tileLayer.wms(url, {
        ...params,
        opacity: 0.75,
        errorTileUrl:
          'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
      } as L.WMSOptions)
      wms.addTo(map)
      radarRef.current = wms
      setStatus('📡 已疊 Sentinel-1 雷達：亮點＝金屬船身。雷達有亮點但無 AIS 三角形＝可疑暗船')
    } else {
      remove()
    }
    return remove
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, showRadarVessels])

  return null
}

function drawVessel(
  group: L.LayerGroup,
  v: Vessel,
  toTool: (v: Vessel, tool: 'intercept' | 'dr') => void,
) {
  const { alerts, level } = analyzeVessel(v)
  const color = level === 'alert' ? '#f43f5e' : level === 'warn' ? '#f59e0b' : '#22d3ee'
  const pulse = level === 'alert' ? ' ais-alert' : ''
  const marker = L.marker([v.lat, v.lng], {
    icon: L.divIcon({
      className: '',
      html: `<div class="ais-vessel${pulse}" style="transform:rotate(${v.cog}deg);color:${color}">▲</div>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    }),
  })
  const alertHtml = alerts.length
    ? `<br/><span style="color:${color}">⚠ ${alerts.join('、')}</span>`
    : ''
  // 用 DOM 元素當 popup，才能掛按鈕點擊事件（字串 HTML 無法綁 onclick）。
  const el = document.createElement('div')
  el.style.cssText = 'font-family:ui-monospace,monospace;line-height:1.5'
  el.innerHTML = `<b style="color:${color}">${v.name}</b><br/>
    MMSI ${v.mmsi}<br/>船種：${v.type}<br/>
    航速 ${v.sog.toFixed(1)} kn · 航向 ${Math.round(v.cog)}°${alertHtml}`
  const btnRow = document.createElement('div')
  btnRow.style.cssText = 'display:flex;gap:6px;margin-top:6px'
  const mkBtn = (label: string, tool: 'intercept' | 'dr', bg: string) => {
    const b = document.createElement('button')
    b.textContent = label
    b.style.cssText = `flex:1;padding:4px 6px;border-radius:6px;border:1px solid ${bg};background:${bg}22;color:${bg};font-weight:700;font-size:12px;cursor:pointer`
    b.onclick = () => toTool(v, tool)
    return b
  }
  btnRow.appendChild(mkBtn('🎯 攔截', 'intercept', '#22d3ee'))
  btnRow.appendChild(mkBtn('🧭 推算', 'dr', '#38bdf8'))
  el.appendChild(btnRow)
  marker.bindPopup(el)
  marker.addTo(group)
}
