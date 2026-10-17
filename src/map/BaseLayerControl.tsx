import { useEffect } from 'react'
import L from 'leaflet'
import { useTacticalStore } from '../store/tacticalStore'
import { buildBaseStyle, styleBackground, SENTINEL_BASES } from '../lib/baseLayers'
import { BASE_STYLES } from '../lib/basemaps'
import { isSentinelConfigured } from '../lib/config'
import { layerFor } from '../lib/sentinel'

/**
 * 底圖管理（純副作用，無按鈕；切換鈕是 BaseMapSwitcher）。
 *
 * 一個樣式由好幾層疊成（見 lib/basemaps.ts），全部放在自己的 basePane，
 * z 低於 tilePane，確保光學／雷達影像永遠疊在底圖之上。
 */
export function BaseLayerControl({ map }: { map: L.Map }) {
  const baseLayer = useTacticalStore((s) => s.baseLayer)
  // 金鑰改過就重建：以前要整頁重載才會生效，會把地圖位置與模式全洗掉。
  const configRev = useTacticalStore((s) => s.configRev)
  const setStatus = useTacticalStore((s) => s.setStatus)
  // 組態檢查完才知道該掛哪個圖層（或組態裡根本沒有）
  const sentinelCheck = useTacticalStore((s) => s.sentinelCheck)

  useEffect(() => {
    if (!SENTINEL_BASES.includes(baseLayer)) return
    if (!isSentinelConfigured()) {
      setStatus('⚠ 這個底圖需要先在 ⚙️ 設定填 Sentinel Instance ID；目前先用「地圖」代替')
    } else if (!layerFor(baseLayer === 'sentinel1' ? 'sar' : 'optical')) {
      setStatus(`⚠ ${sentinelCheck.message || '你的 Sentinel 組態裡沒有這種圖層'}　目前先用「地圖」代替`)
    } else {
      setStatus(
        baseLayer === 'sentinel1'
          ? 'Sentinel-1 雷達底圖：近 30 天最新影像；船＝亮點（穿雲/夜間）。某些海域當期可能無影像'
          : 'Sentinel-2 真彩底圖：近 120 天最新低雲影像；大船呈白色亮點。無當期影像時該格會空白',
      )
    }
  }, [baseLayer, setStatus, configRev, sentinelCheck])

  useEffect(() => {
    if (!map.getPane('basePane')) {
      map.createPane('basePane')
      const pane = map.getPane('basePane')
      if (pane) pane.style.zIndex = '150'
    }
    const layers = buildBaseStyle(baseLayer)
    for (const l of layers) {
      l.options.pane = 'basePane'
      l.addTo(map)
    }
    // 圖磚被藏掉或還沒載入時露出的顏色。跟海面同色，看起來就是海，不是破洞。
    map.getContainer().style.background = styleBackground(baseLayer)

    // 海圖樣式順便開航標；離開時還原成使用者原本的設定
    const store = useTacticalStore.getState()
    const wantSeamarks = BASE_STYLES[baseLayer].seamarks === true
    const hadSeamarks = store.showSeamark
    if (wantSeamarks && !hadSeamarks) store.setShowSeamark(true)

    return () => {
      for (const l of layers) map.removeLayer(l)
      if (wantSeamarks && !hadSeamarks) useTacticalStore.getState().setShowSeamark(false)
    }
  }, [baseLayer, map, configRev, sentinelCheck])

  return null
}
