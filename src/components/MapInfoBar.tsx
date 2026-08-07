import { useEffect, useState } from 'react'
import L from 'leaflet'
import { useTacticalStore } from '../store/tacticalStore'
import { isSentinelConfigured } from '../lib/sentinel'

/**
 * 畫面資訊條：即時顯示「畫面中心座標」，以及（光學模式）目前影像的時間注記，
 * 讓回放歷史影像時清楚知道「這張是哪時候的」。位於狀態列下方左側。
 */
export function MapInfoBar({ map }: { map: L.Map }) {
  const mode = useTacticalStore((s) => s.mode)
  const opticalSource = useTacticalStore((s) => s.opticalSource)
  const observationDate = useTacticalStore((s) => s.observationDate)
  const opticalRadar = useTacticalStore((s) => s.opticalRadar)
  const setMapView = useTacticalStore((s) => s.setMapView)
  const [center, setCenter] = useState<{ lat: number; lng: number; zoom: number }>(() => {
    const c = map.getCenter()
    return { lat: c.lat, lng: c.lng, zoom: map.getZoom() }
  })

  useEffect(() => {
    const update = () => {
      const c = map.getCenter()
      const v = { lat: c.lat, lng: c.lng, zoom: map.getZoom() }
      setCenter(v)
      setMapView(v) // 供「在畫面中心新增點位」讀取
    }
    update()
    map.on('move zoom', update)
    return () => {
      map.off('move zoom', update)
    }
  }, [map, setMapView])

  const coord = `${fmt(center.lat)}${center.lat >= 0 ? 'N' : 'S'} ${fmt(center.lng)}${center.lng >= 0 ? 'E' : 'W'}`

  // 影像時間注記：如實反映「當下地圖真正掛的那一層」，而非使用者挑的來源鈕。
  // 有 Sentinel 金鑰時，光學模式畫的一定是 Sentinel（真實日期），不是免金鑰鑲嵌。
  let imgTime: string | null = null
  if (mode === 'optical') {
    if (isSentinelConfigured()) {
      imgTime = opticalRadar
        ? `📡 ${observationDate} 前後 · Sentinel-1 雷達（穿雲/非真彩）`
        : `📅 ≤${observationDate} · Sentinel-2 10m（近10日最少雲一景 · 過境約上午10–11時 · 非即時）`
    } else if (opticalSource === 'nasa') imgTime = `📅 影像 ${observationDate}（VIIRS/MODIS 當日）`
    else if (opticalSource === 'eox') imgTime = '📅 Sentinel-2 無雲 2023 年合成（非每日）'
    else if (opticalSource === 'ocean') imgTime = '🌊 海底地形（非時間性）'
    else imgTime = '📅 高解析空拍鑲嵌（Esri · 非即時、非單一日期）'
  }

  return (
    <div className="map-info-pos pointer-events-none absolute left-3 z-[1000] flex flex-col gap-0.5">
      <span className="w-fit rounded bg-slate-900/80 px-2 py-0.5 font-mono text-[0.6875rem] text-tactical-cyan">
        ◎ {coord} · z{Math.round(center.zoom)}
      </span>
      {imgTime && (
        <span className="w-fit rounded bg-slate-900/80 px-2 py-0.5 font-mono text-[0.625rem] text-amber-300">
          {imgTime}
        </span>
      )}
    </div>
  )
}

function fmt(v: number): string {
  return Math.abs(v).toFixed(4)
}
