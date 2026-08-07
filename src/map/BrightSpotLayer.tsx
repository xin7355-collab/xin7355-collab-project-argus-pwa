import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useTacticalStore } from '../store/tacticalStore'
import { detectBrightSpots } from '../lib/brightSpot'
import { classifyBySize, matchAis, distM, type Detection } from '../lib/detection'
import { isAisConfigured } from '../lib/config'

/**
 * 亮點掃描圖層：把目前畫面上的衛星影像圖磚畫到離屏 canvas，做亮點偵測，
 * 在暗海上突出的小亮點（疑似船/殘骸/反光）標成編號記號，幫助快速分辨。
 * 只在光學模式作用；靠 scanTick 觸發（按鈕按一次掃一次）。
 */
export function BrightSpotLayer({ map }: { map: L.Map }) {
  const mode = useTacticalStore((s) => s.mode)
  const scanTick = useTacticalStore((s) => s.scanTick)
  const sensitivity = useTacticalStore((s) => s.scanSensitivity)
  const brightSpots = useTacticalStore((s) => s.brightSpots)
  const setBrightSpots = useTacticalStore((s) => s.setBrightSpots)
  const setStatus = useTacticalStore((s) => s.setStatus)
  const groupRef = useRef<L.LayerGroup | null>(null)

  // 掃描（scanTick 改變時執行一次）
  useEffect(() => {
    if (mode !== 'optical' || scanTick === 0) return
    const container = map.getContainer()
    const imgs = container.querySelectorAll<HTMLImageElement>('img.gibs-imagery')
    if (!imgs.length) {
      setStatus('請先切到有衛星影像的來源（高解析/無雲/每日）再掃描')
      return
    }
    const size = map.getSize()
    const canvas = document.createElement('canvas')
    canvas.width = size.x
    canvas.height = size.y
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    const mapRect = container.getBoundingClientRect()
    let drew = 0
    imgs.forEach((img) => {
      if (!img.complete || !img.naturalWidth) return
      const r = img.getBoundingClientRect()
      try {
        ctx.drawImage(img, r.left - mapRect.left, r.top - mapRect.top, r.width, r.height)
        drew++
      } catch {
        /* 個別圖磚繪製失敗略過 */
      }
    })
    if (!drew) {
      setStatus('影像尚未載入完成，稍候再掃描')
      return
    }
    let data: ImageData
    try {
      data = ctx.getImageData(0, 0, size.x, size.y)
    } catch {
      setStatus('此影像來源不支援畫面分析（跨網域）；請切到「高解析(Esri)」或「每日(NASA)」')
      return
    }
    setStatus('目標掃描中…')
    const spots = detectBrightSpots(data, {
      step: 2,
      kStd: sensitivity,
      ringMargin: 14,
      minSize: 1,
      maxSize: 40,
      maxSpots: 60,
    })
    const vessels = useTacticalStore.getState().vessels
    const aisOn = isAisConfigured()
    const results: Detection[] = spots.map((s) => {
      const c = map.containerPointToLatLng(L.point(s.x, s.y))
      const sw = map.containerPointToLatLng(L.point(s.minX, s.maxY))
      const ne = map.containerPointToLatLng(L.point(s.maxX, s.minY))
      // 尺度：邊界框對角線的地理長度（公尺）
      const sizeM = distM(sw.lat, sw.lng, ne.lat, ne.lng)
      const m = matchAis(c.lat, c.lng, vessels, aisOn)
      return {
        lat: c.lat,
        lng: c.lng,
        score: s.score,
        south: sw.lat,
        west: sw.lng,
        north: ne.lat,
        east: ne.lng,
        sizeM,
        cls: classifyBySize(sizeM),
        ais: m.ais,
        aisName: m.aisName,
      }
    })
    setBrightSpots(results)
    const suspicious = results.filter((r) => r.ais === 'none').length
    setStatus(
      results.length
        ? aisOn
          ? `目標掃描：${results.length} 個，其中 ⚠${suspicious} 個無 AIS（紅框優先查）`
          : `目標掃描：${results.length} 個疑似目標（設定 AIS 後可自動比對「無AIS=可疑」）`
        : '目標掃描：此畫面沒有明顯目標（可調高靈敏度或放大）',
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanTick])

  // 依 brightSpots 畫記號
  useEffect(() => {
    if (!groupRef.current) groupRef.current = L.layerGroup().addTo(map)
    const g = groupRef.current
    g.clearLayers()
    if (mode !== 'optical') return
    brightSpots.forEach((s, i) => {
      // 無 AIS 訊號＝紅框(可疑)；有對到 AIS＝綠框(已知)；未比對＝青框。
      const color = s.ais === 'none' ? '#f43f5e' : s.ais === 'known' ? '#34d399' : '#22d3ee'
      const tag = s.ais === 'none' ? '⚠無AIS' : s.ais === 'known' ? `✓${s.aisName || 'AIS'}` : ''
      // 至少 18px 的框，太小看不見
      const sw = map.latLngToContainerPoint([s.south, s.west])
      const ne = map.latLngToContainerPoint([s.north, s.east])
      const padX = Math.max(0, (18 - Math.abs(ne.x - sw.x)) / 2)
      const padY = Math.max(0, (18 - Math.abs(sw.y - ne.y)) / 2)
      const p1 = map.containerPointToLatLng(L.point(Math.min(sw.x, ne.x) - padX, Math.max(sw.y, ne.y) + padY))
      const p2 = map.containerPointToLatLng(L.point(Math.max(sw.x, ne.x) + padX, Math.min(sw.y, ne.y) - padY))
      L.rectangle(
        [
          [p1.lat, p1.lng],
          [p2.lat, p2.lng],
        ],
        { color, weight: 2, fill: false, className: s.ais === 'none' ? 'det-box-alert' : '' },
      ).addTo(g)
      L.marker([p2.lat, p1.lng], {
        icon: L.divIcon({
          className: '',
          html: `<div class="det-label" style="color:${color};border-color:${color}">${i + 1}${tag ? ' ' + tag : ''}</div>`,
          iconSize: [80, 15],
          iconAnchor: [-2, 15],
        }),
        zIndexOffset: 1400,
      })
        .bindPopup(
          `<b style="color:${color}">目標 #${i + 1}${tag ? '｜' + tag : ''}</b><br/>` +
            `${s.cls}<br/>估計尺度 ~${Math.round(s.sizeM)} m｜突出度 ${s.score.toFixed(1)}σ<br/>` +
            `${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}<br/>` +
            `<span style="color:#94a3b8;font-size:11px">輔助分流，非確認身分</span>`,
        )
        .addTo(g)
    })
  }, [brightSpots, mode, map])

  useEffect(
    () => () => {
      if (groupRef.current) {
        groupRef.current.clearLayers()
        map.removeLayer(groupRef.current)
        groupRef.current = null
      }
    },
    [map],
  )

  return null
}
