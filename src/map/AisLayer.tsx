import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useTacticalStore } from '../store/tacticalStore'
import { subscribeAIS, isAisConfigured, type AisHandle, type Vessel, type BBox } from '../lib/ais'
import { VesselMarkers } from './aisMarkers'
import { buildGibsBoatLights } from '../lib/gibs'
import { buildWmsConfig, isSentinelConfigured, layerFor } from '../lib/sentinel'

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
  const observationDate = useTacticalStore((s) => s.observationDate)
  // 金鑰改過就重建：以前要整頁重載才會生效，會把地圖位置與模式全洗掉。
  const configRev = useTacticalStore((s) => s.configRev)
  const showRadarVessels = useTacticalStore((s) => s.showRadarVessels)
  const sentinelCheck = useTacticalStore((s) => s.sentinelCheck)
  const groupRef = useRef<L.LayerGroup | null>(null)
  const lightsRef = useRef<L.TileLayer | null>(null)
  const radarRef = useRef<L.TileLayer | null>(null)
  const handleRef = useRef<AisHandle | null>(null)
  const keyTestTick = useTacticalStore((s) => s.aisKeyTestTick)

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

    // 航跡要向連線把手要；把手在 subscribeAIS 回來之後才有，所以先用 ref 包一層
    const markers = new VesselMarkers(group, toTool, (mmsi) => handleRef.current?.track(mmsi) ?? [])
    const handle = subscribeAIS(
      (vessels) => {
        setVessels(vessels)
        markers.update(vessels)
      },
      (s) => setStatus(s), // 連線狀態回報到狀態提示
      boxOf(),
      // 把「這份 AIS 現在可不可以信」送進 store，掃描才不會拿過期船位下結論。
      (usable, ageMs) => useTacticalStore.getState().setAisFresh(usable, ageMs),
      (diag, history) => useTacticalStore.getState().setAisDiag({ ...diag, history }),
    )
    handleRef.current = handle

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
      handleRef.current = null
      useTacticalStore.getState().setAisDiag(null)
      // 測到一半離開 AIS：不清掉的話回來時按鈕會一直卡在「測試中」
      useTacticalStore.getState().setAisKeyTest({ running: false, text: '' })
      markers.clear()
      map.removeLayer(group)
      groupRef.current = null
      // 注意：不清空 store 的 vessels——保留最後已知 AIS，供光學亮點掃描做
      //「無AIS=可疑暗船」比對（見 BrightSpotLayer / store setMode 的說明）。
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, configRev])

  // ── 🔑 測試金鑰：面板按鈕只遞增 tick，連線把手在這裡，所以由這裡跑 ──
  useEffect(() => {
    const handle = handleRef.current
    if (keyTestTick === 0 || !handle) return
    const { setAisKeyTest } = useTacticalStore.getState()
    let alive = true
    setAisKeyTest({ running: true, text: '測試中——借英吉利海峽收 15 秒…' })
    handle.testKey().then((text) => {
      if (alive) setAisKeyTest({ running: false, text })
    })
    return () => {
      alive = false
    }
  }, [keyTestTick])

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
      // 跟著全域觀測日期走（本來寫死昨天，選了日期也不會動）。
      const layer = buildGibsBoatLights(observationDate || yesterdayYmd())
      layer.addTo(map)
      lightsRef.current = layer
      setStatus('🌙 已疊夜間漁火（VIIRS）：外海亮點＝開燈作業漁船；夜間才有、白天無效')
    } else {
      remove()
    }
    return remove
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, showBoatLights, observationDate, configRev])

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
    const layer = layerFor('sar')
    if (mode === 'ais' && showRadarVessels && isSentinelConfigured() && sentinelCheck.status !== 'checking') {
      if (!layer) {
        // 以前組態裡沒有雷達圖層時照樣掛上去，伺服器回錯、Leaflet 換成透明圖磚，
        // 看起來就是「開了沒反應」。面板上會顯示原因與加圖層的步驟。
        setStatus(`⚠ 雷達暗船：${sentinelCheck.message || '你的 Sentinel 組態裡沒有雷達圖層'}`)
        return remove
      }
      const { url, params } = buildWmsConfig({ layer, date: yesterdayYmd(), lookbackDays: 12 })
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
  }, [mode, showRadarVessels, configRev, sentinelCheck])

  return null
}
