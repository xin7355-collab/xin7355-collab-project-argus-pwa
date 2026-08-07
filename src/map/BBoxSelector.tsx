import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useTacticalStore } from '../store/tacticalStore'
import { detectVessels } from '../lib/edgeAI'

/**
 * BBoxSelector —— 讓使用者在地圖上「框選一塊海域」。
 *
 * 流程：點「AI 框選」按鈕 → selecting=true → 在地圖拖拉出矩形
 *   → 放開 → 把 bbox 丟給邊緣 AI → 回傳 GeoJSON 存進 store。
 *
 * 框選時暫時停用地圖拖曳，避免「拉地圖」和「拉框」打架。
 */
export function BBoxSelector({ map }: { map: L.Map }) {
  const selecting = useTacticalStore((s) => s.selecting)
  const setSelecting = useTacticalStore((s) => s.setSelecting)
  const setSelectedBBox = useTacticalStore((s) => s.setSelectedBBox)
  const setDetections = useTacticalStore((s) => s.setDetections)
  const setAiStatus = useTacticalStore((s) => s.setAiStatus)
  const setStatus = useTacticalStore((s) => s.setStatus)
  const observationDate = useTacticalStore((s) => s.observationDate)

  const startRef = useRef<L.LatLng | null>(null)
  const rectRef = useRef<L.Rectangle | null>(null)

  useEffect(() => {
    const container = map.getContainer()
    if (!selecting) {
      // 離開框選模式：恢復地圖拖曳、還原觸控行為
      map.dragging.enable()
      container.style.cursor = ''
      container.style.touchAction = ''
      return
    }

    // 進入框選：停用地圖拖曳，並用 touchAction:none 阻止手機頁面捲動，
    // 這樣手指拖動才會被我們用來畫框，而不是滑地圖/捲頁面。
    map.dragging.disable()
    container.style.cursor = 'crosshair'
    container.style.touchAction = 'none'

    // 用原生 Pointer Events：滑鼠與觸控（手機）統一處理。
    const toLatLng = (ev: PointerEvent) => {
      const rect = container.getBoundingClientRect()
      return map.containerPointToLatLng([ev.clientX - rect.left, ev.clientY - rect.top])
    }

    const onDown = (ev: PointerEvent) => {
      container.setPointerCapture?.(ev.pointerId)
      startRef.current = toLatLng(ev)
      if (rectRef.current) {
        map.removeLayer(rectRef.current)
        rectRef.current = null
      }
    }

    const onMove = (ev: PointerEvent) => {
      if (!startRef.current) return
      const bounds = L.latLngBounds(startRef.current, toLatLng(ev))
      if (rectRef.current) {
        rectRef.current.setBounds(bounds)
      } else {
        rectRef.current = L.rectangle(bounds, {
          color: '#22d3ee',
          weight: 1.5,
          fillColor: '#22d3ee',
          fillOpacity: 0.1,
          dashArray: '4',
        }).addTo(map)
      }
    }

    const onUp = async () => {
      if (!startRef.current || !rectRef.current) {
        startRef.current = null
        return
      }
      const b = rectRef.current.getBounds()
      startRef.current = null
      const bbox = {
        west: b.getWest(),
        south: b.getSouth(),
        east: b.getEast(),
        north: b.getNorth(),
      }
      setSelectedBBox(bbox)
      setSelecting(false) // 框完自動退出框選模式

      // ── 呼叫邊緣 AI ──
      setAiStatus('loading')
      setStatus('已送出海域座標，等待邊緣 AI 辨識…')
      try {
        const fc = await detectVessels(bbox, observationDate)
        setDetections(fc)
        setAiStatus('done')
        const susp = fc.features.filter((f) => f.properties.suspicious).length
        setStatus(`AI 辨識完成：${fc.features.length} 個目標，其中 ${susp} 個疑似無名船隻`)
      } catch (err) {
        setAiStatus('error', err instanceof Error ? err.message : String(err))
        setStatus('⚠ 邊緣 AI 連線失敗，請確認網路或稍後再試')
      }
    }

    container.addEventListener('pointerdown', onDown)
    container.addEventListener('pointermove', onMove)
    container.addEventListener('pointerup', onUp)
    container.addEventListener('pointercancel', onUp)

    return () => {
      container.removeEventListener('pointerdown', onDown)
      container.removeEventListener('pointermove', onMove)
      container.removeEventListener('pointerup', onUp)
      container.removeEventListener('pointercancel', onUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selecting])

  return null
}
