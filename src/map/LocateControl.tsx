import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { useTacticalStore } from '../store/tacticalStore'

/**
 * 「我的位置」GPS 定位 + 航跡記錄。
 *  - 短按：單次定位（藍點 + 精度圈，地圖移到自己身上）。
 *  - 長按：切換「航跡記錄」（連續 GPS，畫出走過的路徑＝搜索覆蓋麵包屑）。
 */
export function LocateControl({ map }: { map: L.Map }) {
  const ownPosition = useTacticalStore((s) => s.ownPosition)
  const setOwnPosition = useTacticalStore((s) => s.setOwnPosition)
  const setStatus = useTacticalStore((s) => s.setStatus)
  const trackRecording = useTacticalStore((s) => s.trackRecording)
  const ownTrack = useTacticalStore((s) => s.ownTrack)
  const toggleTrackRecording = useTacticalStore((s) => s.toggleTrackRecording)
  const pushTrackPoint = useTacticalStore((s) => s.pushTrackPoint)
  const [busy, setBusy] = useState(false)
  const markerRef = useRef<L.LayerGroup | null>(null)
  const trackRef = useRef<L.LayerGroup | null>(null)
  const watchRef = useRef<number | null>(null)
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressed = useRef(false)

  // 依 store 的 ownPosition 畫/更新藍點
  useEffect(() => {
    if (!ownPosition) return
    if (!markerRef.current) markerRef.current = L.layerGroup().addTo(map)
    const g = markerRef.current
    g.clearLayers()
    L.circle([ownPosition.lat, ownPosition.lng], {
      radius: ownPosition.accuracy,
      color: '#38bdf8',
      weight: 1,
      fillColor: '#38bdf8',
      fillOpacity: 0.12,
    }).addTo(g)
    L.marker([ownPosition.lat, ownPosition.lng], {
      icon: L.divIcon({ className: '', html: `<div class="own-pos"></div>`, iconSize: [18, 18], iconAnchor: [9, 9] }),
    })
      .bindPopup('📍 我的位置')
      .addTo(g)
    return () => {
      g.clearLayers()
    }
  }, [ownPosition, map])

  // 航跡折線
  useEffect(() => {
    if (!trackRef.current) trackRef.current = L.layerGroup().addTo(map)
    const g = trackRef.current
    g.clearLayers()
    if (ownTrack.length >= 2) {
      L.polyline(
        ownTrack.map((p) => [p.lat, p.lng] as [number, number]),
        { color: '#38bdf8', weight: 3, opacity: 0.7 },
      ).addTo(g)
    }
  }, [ownTrack, map])

  // 航跡記錄：連續 watchPosition
  useEffect(() => {
    if (!trackRecording) {
      if (watchRef.current !== null) {
        navigator.geolocation?.clearWatch(watchRef.current)
        watchRef.current = null
      }
      return
    }
    if (!navigator.geolocation) {
      setStatus('⚠ 此裝置不支援定位')
      return
    }
    setStatus('🔴 航跡記錄中…（再長按停止）')
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords
        setOwnPosition({ lat: latitude, lng: longitude, accuracy })
        pushTrackPoint({ lat: latitude, lng: longitude })
      },
      (err) => setStatus(`⚠ 航跡記錄失敗：${err.message}`),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
    )
    return () => {
      if (watchRef.current !== null) {
        navigator.geolocation.clearWatch(watchRef.current)
        watchRef.current = null
      }
    }
  }, [trackRecording, setOwnPosition, pushTrackPoint, setStatus])

  const locateOnce = () => {
    if (!navigator.geolocation) {
      setStatus('⚠ 此裝置不支援定位')
      return
    }
    setBusy(true)
    setStatus('定位中…')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords
        setOwnPosition({ lat: latitude, lng: longitude, accuracy })
        map.setView([latitude, longitude], Math.max(map.getZoom(), 11))
        setStatus(`已定位：精度約 ${Math.round(accuracy)} m（長按可記錄航跡）`)
        setBusy(false)
      },
      (err) => {
        setStatus(`⚠ 定位失敗：${err.message}`)
        setBusy(false)
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 },
    )
  }

  // 長按偵測：按住 >500ms 觸發航跡切換，否則放開時單次定位。
  const onPressStart = () => {
    longPressed.current = false
    pressTimer.current = setTimeout(() => {
      longPressed.current = true
      toggleTrackRecording()
    }, 500)
  }
  const onPressEnd = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current)
    if (!longPressed.current) locateOnce()
  }

  // 我的位置為常駐快捷（與 ⚙️、🧰 同列），永遠顯示。

  return (
    <button
      onPointerDown={onPressStart}
      onPointerUp={onPressEnd}
      onPointerLeave={() => pressTimer.current && clearTimeout(pressTimer.current)}
      className={`safe-float-top3 pointer-events-auto absolute z-[1100] flex h-11 w-11 items-center justify-center rounded-full border text-xl active:scale-95 ${
        trackRecording ? 'border-red-500 bg-red-500/20' : 'border-slate-600 bg-tactical-panel/90'
      }`}
      aria-label="我的位置（長按記錄航跡）"
      title="短按定位 · 長按記錄航跡"
    >
      {busy ? '⏳' : trackRecording ? '🔴' : '📍'}
    </button>
  )
}
