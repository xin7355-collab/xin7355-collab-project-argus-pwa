import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useTacticalStore } from '../store/tacticalStore'
import { buildBaseLayer, SENTINEL_BASES } from '../lib/baseLayers'
import { isSentinelConfigured } from '../lib/config'

/**
 * 底圖管理（純副作用，無按鈕）。底圖的「切換」已移到統一圖層視窗 🗂️。
 * 中文底圖用內政部國土測繪中心（NLSC），台灣周邊才有圖磚，故底下永遠墊
 * 一層深色 CARTO 當「遠洋/無資料」底，不會全白。
 */
export function BaseLayerControl({ map }: { map: L.Map }) {
  const baseLayer = useTacticalStore((s) => s.baseLayer)
  const setStatus = useTacticalStore((s) => s.setStatus)
  const underRef = useRef<L.TileLayer | null>(null)
  const topRef = useRef<L.TileLayer | null>(null)

  // Sentinel 近期影像底圖：提示「需 Instance ID」或「顯示近期最新影像」。
  useEffect(() => {
    if (!SENTINEL_BASES.includes(baseLayer)) return
    if (!isSentinelConfigured()) {
      setStatus('⚠ 此底圖需先在 ⚙️ 設定填 Sentinel Instance ID；目前暫以深色底圖替代')
    } else {
      setStatus(
        baseLayer === 'sentinel1'
          ? 'Sentinel-1 雷達底圖：近 30 天最新影像；船＝亮點（穿雲/夜間）。某些海域當期可能無影像'
          : 'Sentinel-2 真彩底圖：近 120 天最新低雲影像；大船呈白色亮點。無當期影像時該格會空白',
      )
    }
  }, [baseLayer, setStatus])

  // 專屬底圖 pane（z 低於 tilePane，確保光學/雷達影像永遠疊在底圖之上）
  useEffect(() => {
    if (!map.getPane('basePane')) {
      map.createPane('basePane')
      const pane = map.getPane('basePane')
      if (pane) pane.style.zIndex = '150'
    }
    const under = buildBaseLayer('dark')
    under.options.pane = 'basePane'
    under.addTo(map)
    underRef.current = under
    return () => {
      map.removeLayer(under)
      underRef.current = null
    }
  }, [map])

  // 依選擇疊上中文/彩色底圖（dark 時不疊）
  useEffect(() => {
    if (topRef.current) {
      map.removeLayer(topRef.current)
      topRef.current = null
    }
    if (baseLayer !== 'dark') {
      const top = buildBaseLayer(baseLayer)
      top.options.pane = 'basePane'
      top.addTo(map)
      topRef.current = top
    }
    return () => {
      if (topRef.current) {
        map.removeLayer(topRef.current)
        topRef.current = null
      }
    }
  }, [baseLayer, map])

  return null
}
