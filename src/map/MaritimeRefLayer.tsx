import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useTacticalStore } from '../store/tacticalStore'
import { WIND_FARMS, MEDIAN_LINE, PORTS, RESTRICTED_ZONES, ENFORCEMENT_LINES, SHOALS } from '../lib/maritimeRef'
import { fetchWindFarmsOsm, type OsmWindFarm } from '../lib/windfarmOsm'
import { fetchFairways, fetchCables, fetchShoals } from '../lib/osmMaritime'

/**
 * 離岸風電場圖層（跨模式）：由圖層視窗打勾開啟。畫各離岸風電場示意範圍圈＋風機標記，
 * 提醒作業區/限制航行/避碰熱點。
 */
/** 三葉片風機 SVG（正確的離岸風電圖示，非漩渦；避免與颱風符號混淆）。 */
function turbineSvg(color: string, size = 22): string {
  return (
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="${color}" ` +
    `stroke-width="1.7" stroke-linecap="round">` +
    `<line x1="12" y1="12" x2="12" y2="23"/>` + // 塔身
    `<line x1="12" y1="12" x2="12" y2="3"/>` + // 葉片（上）
    `<line x1="12" y1="12" x2="20.5" y2="16.5"/>` + // 葉片（右下）
    `<line x1="12" y1="12" x2="3.5" y2="16.5"/>` + // 葉片（左下）
    `<circle cx="12" cy="12" r="1.6" fill="${color}" stroke="none"/>` + // 輪轂
    `</svg>`
  )
}

/** 內建示意離岸風電場（方形區塊＋風機陣列）——即時可見，OSM 抓到前先墊著。 */
function drawApproxWindFarms(g: L.LayerGroup) {
  for (const wf of WIND_FARMS) {
    const built = wf.status === '營運'
    const color = built ? '#38bdf8' : '#a78bfa'
    const dLat = wf.radiusKm / 111
    const dLng = wf.radiusKm / (111 * Math.cos((wf.lat * Math.PI) / 180))
    L.rectangle(
      [
        [wf.lat - dLat, wf.lng - dLng],
        [wf.lat + dLat, wf.lng + dLng],
      ],
      { color, weight: 1.5, opacity: 0.7, dashArray: '6 4', fillColor: color, fillOpacity: 0.07 },
    ).addTo(g)
    L.marker([wf.lat, wf.lng], {
      icon: L.divIcon({
        className: '',
        html: `<div class="wf-marker">${turbineSvg(color, 24)}<div class="wf-label" style="color:${color}">${wf.name}</div></div>`,
        iconSize: [24, 34],
        iconAnchor: [12, 20],
      }),
    })
      .bindPopup(
        `<b style="color:${color}">🗼 ${wf.name}</b><br/>離岸風電場（${wf.status}）<br/>` +
          `<span style="color:#94a3b8;font-size:11px">內建示意範圍；正在載入 OSM 精準邊界…</span>`,
      )
      .addTo(g)
  }
}

/** OSM 精準邊界（向量常駐，任何縮放都在）＋我方中文名。 */
function drawOsmWindFarms(g: L.LayerGroup, farms: OsmWindFarm[]) {
  for (const wf of farms) {
    const built = wf.status === '營運'
    const color = wf.status === '' ? '#5eead4' : built ? '#38bdf8' : '#a78bfa'
    L.polygon(wf.ring, {
      color,
      weight: 1.8,
      opacity: 0.85,
      fillColor: color,
      fillOpacity: 0.08,
      lineJoin: 'round',
    })
      .bindPopup(
        `<b style="color:${color}">🗼 ${wf.name}</b><br/>離岸風電場${wf.status ? `（${wf.status}）` : ''}<br/>` +
          `<span style="color:#94a3b8;font-size:11px">邊界來源：OpenStreetMap（精準）；風機作業區/限制航行，注意避碰</span>`,
      )
      .addTo(g)
    L.marker(wf.center, {
      icon: L.divIcon({
        className: '',
        html: `<div class="wf-marker">${turbineSvg(color, 22)}<div class="wf-label" style="color:${color}">${wf.name}</div></div>`,
        iconSize: [22, 32],
        iconAnchor: [11, 18],
      }),
    }).addTo(g)
  }
}

export function WindFarmLayer({ map }: { map: L.Map }) {
  const show = useTacticalStore((s) => s.showWindFarms)
  const setStatus = useTacticalStore((s) => s.setStatus)
  const groupRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!show) return
    const g = L.layerGroup().addTo(map)
    groupRef.current = g
    let cancelled = false
    // 1) 先畫內建示意（即時可見）
    drawApproxWindFarms(g)
    // 2) 再抓 OSM 精準邊界取代（合併：精準＋中文＋向量常駐）
    fetchWindFarmsOsm()
      .then((farms) => {
        if (cancelled || !groupRef.current || !farms.length) return
        g.clearLayers()
        drawOsmWindFarms(g, farms)
        setStatus(`離岸風電場：已載入 ${farms.length} 座 OSM 精準邊界（中文對照）`)
      })
      .catch(() => {
        /* 保留內建示意 */
      })
    return () => {
      cancelled = true
      g.clearLayers()
      map.removeLayer(g)
      groupRef.current = null
    }
  }, [show, map, setStatus])

  return null
}

/**
 * 主要漁港／避風港圖層：救難後送、就近調度、颱風避風用。
 */
export function PortLayer({ map }: { map: L.Map }) {
  const show = useTacticalStore((s) => s.showPorts)
  const groupRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!show) return
    const g = L.layerGroup().addTo(map)
    groupRef.current = g
    for (const port of PORTS) {
      L.marker([port.lat, port.lng], {
        icon: L.divIcon({
          className: '',
          html: `<div class="port-marker">⚓<div class="port-label">${port.name}</div></div>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        }),
      })
        .bindPopup(
          `<b style="color:#34d399">⚓ ${port.name}</b><br/>漁港／避風港<br/>` +
            `<span style="font-family:ui-monospace,monospace">${port.lat.toFixed(4)}, ${port.lng.toFixed(4)}</span>`,
        )
        .addTo(g)
    }
    return () => {
      g.clearLayers()
      map.removeLayer(g)
      groupRef.current = null
    }
  }, [show, map])

  return null
}

/**
 * 即時降雨雷達圖層（RainViewer，免金鑰）：全球雷達回波圖磚，出海避雷雨用。
 * 先抓最新影格路徑，再組圖磚 URL。
 */
export function RainRadarLayer({ map }: { map: L.Map }) {
  const show = useTacticalStore((s) => s.showRainRadar)
  const setStatus = useTacticalStore((s) => s.setStatus)
  const layerRef = useRef<L.TileLayer | null>(null)

  useEffect(() => {
    if (!show) return
    let cancelled = false
    const remove = () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current)
        layerRef.current = null
      }
    }
    setStatus('即時降雨雷達：載入中…')
    fetch('https://api.rainviewer.com/public/weather-maps.json')
      .then((r) => r.json())
      .then((data: { host: string; radar?: { past?: { path: string }[]; nowcast?: { path: string }[] } }) => {
        if (cancelled) return
        const frames = [...(data.radar?.past ?? []), ...(data.radar?.nowcast ?? [])]
        const last = frames[frames.length - 1]
        if (!last) {
          setStatus('即時降雨雷達：目前無資料')
          return
        }
        const url = `${data.host}${last.path}/256/{z}/{x}/{y}/4/1_1.png`
        const tl = L.tileLayer(url, { opacity: 0.6, maxZoom: 19, attribution: '降雨雷達 © RainViewer' })
        tl.addTo(map)
        layerRef.current = tl
        setStatus('即時降雨雷達（RainViewer）：藍→綠→黃→紅 雨勢增強')
      })
      .catch(() => {
        if (!cancelled) setStatus('⚠ 降雨雷達載入失敗')
      })
    return () => {
      cancelled = true
      remove()
    }
  }, [show, map, setStatus])

  return null
}

/**
 * 金馬外離島 禁止／限制水域（示意）圖層：處置大陸漁船越界抽砂/捕撈用。
 * 內圈＝禁止水域（紅實線），外圈＝限制水域（橘虛線）。
 */
export function RestrictedZoneLayer({ map }: { map: L.Map }) {
  const show = useTacticalStore((s) => s.showRestricted)
  const groupRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!show) return
    const g = L.layerGroup().addTo(map)
    groupRef.current = g
    for (const z of RESTRICTED_ZONES) {
      // 限制水域（外緣）
      L.circle([z.lat, z.lng], {
        radius: z.limitKm * 1000,
        color: '#fb923c',
        weight: 1.5,
        opacity: 0.75,
        dashArray: '6 5',
        fillColor: '#fb923c',
        fillOpacity: 0.05,
      })
        .bindPopup(`<b style="color:#fb923c">${z.name} 限制水域（示意）</b><br/>外緣約 ${z.limitKm} km；大陸船舶進入即屬越界`)
        .addTo(g)
      // 禁止水域（近岸）
      L.circle([z.lat, z.lng], {
        radius: z.banKm * 1000,
        color: '#f43f5e',
        weight: 2,
        opacity: 0.9,
        fillColor: '#f43f5e',
        fillOpacity: 0.1,
      })
        .bindPopup(`<b style="color:#f43f5e">${z.name} 禁止水域（示意）</b><br/>近岸約 ${z.banKm} km；最優先驅離/查扣範圍`)
        .addTo(g)
      L.marker([z.lat, z.lng], {
        icon: L.divIcon({
          className: '',
          html: `<div class="restrict-label">🚫 ${z.name}</div>`,
          iconSize: [96, 16],
          iconAnchor: [48, 8],
        }),
      }).addTo(g)
    }
    return () => {
      g.clearLayers()
      map.removeLayer(g)
      groupRef.current = null
    }
  }, [show, map])

  return null
}

/**
 * 暫定執法線／重疊海域（示意）圖層：台日漁業協議外緣、台菲巴士海峽中線。
 * 供對外漁業執法邊界態勢參考。
 */
export function EnforcementLineLayer({ map }: { map: L.Map }) {
  const show = useTacticalStore((s) => s.showEnforceLine)
  const groupRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!show) return
    const g = L.layerGroup().addTo(map)
    groupRef.current = g
    for (const line of ENFORCEMENT_LINES) {
      L.polyline(line.path, { color: line.color, weight: 2.5, dashArray: '12 7', opacity: 0.85 })
        .bindPopup(`<b style="color:${line.color}">${line.name}</b><br/><span style="color:#94a3b8;font-size:11px">概略示意，非官方劃界；以主管機關執法海域圖為準</span>`)
        .addTo(g)
      const mid = line.path[Math.floor(line.path.length / 2)]
      L.marker(mid, {
        icon: L.divIcon({
          className: '',
          html: `<div class="enforce-label" style="border-color:${line.color};color:${line.color}">${line.name}</div>`,
          iconSize: [150, 16],
          iconAnchor: [75, 8],
        }),
      }).addTo(g)
    }
    return () => {
      g.clearLayers()
      map.removeLayer(g)
      groupRef.current = null
    }
  }, [show, map])

  return null
}

/**
 * 航道 / 分道通航（TSS）圖層：抓 OSM seamark fairway/separation，畫成航線。
 * 對海上：掌握商船船流動線，研判可疑船是否偏離正常航道。
 */
export function FairwayLayer({ map }: { map: L.Map }) {
  const show = useTacticalStore((s) => s.showFairway)
  const setStatus = useTacticalStore((s) => s.setStatus)
  const groupRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!show) return
    const g = L.layerGroup().addTo(map)
    groupRef.current = g
    let cancelled = false
    setStatus('航道：載入 OSM 航道／分道通航中…')
    fetchFairways()
      .then((fs) => {
        if (cancelled || !groupRef.current) return
        if (!fs.length) {
          setStatus('航道：此區 OSM 無標定資料')
          return
        }
        for (const f of fs) {
          const line = L.polyline(f.coords, { color: '#38bdf8', weight: 2, opacity: 0.8, dashArray: '2 6' })
          line.bindPopup(`<b style="color:#38bdf8">🚢 ${f.name || '航道 / 分道通航'}</b><br/>來源：OpenStreetMap`)
          line.addTo(g)
        }
        setStatus(`航道：已載入 ${fs.length} 條（OSM）`)
      })
      .catch(() => {
        if (!cancelled) setStatus('⚠ 航道載入失敗')
      })
    return () => {
      cancelled = true
      g.clearLayers()
      map.removeLayer(g)
      groupRef.current = null
    }
  }, [show, map, setStatus])

  return null
}

/**
 * 海底電纜圖層：抓 OSM submarine cable，畫成洋紅線（海圖慣例色）。
 * 對海上：電纜保護區/禁拋錨；近年常有越界船拋錨損纜，需監控電纜沿線可疑滯留。
 */
export function CableLayer({ map }: { map: L.Map }) {
  const show = useTacticalStore((s) => s.showCable)
  const setStatus = useTacticalStore((s) => s.setStatus)
  const groupRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!show) return
    const g = L.layerGroup().addTo(map)
    groupRef.current = g
    let cancelled = false
    setStatus('海底電纜：載入 OSM 電纜路由中…')
    fetchCables()
      .then((fs) => {
        if (cancelled || !groupRef.current) return
        if (!fs.length) {
          setStatus('海底電纜：此區 OSM 無標定資料（電纜位置多不公開）')
          return
        }
        for (const f of fs) {
          L.polyline(f.coords, { color: '#ec4899', weight: 2, opacity: 0.85, dashArray: '1 5' })
            .bindPopup(
              `<b style="color:#ec4899">⚡ ${f.name || '海底電纜'}</b><br/>電纜保護區／禁拋錨；監控沿線可疑滯留<br/>` +
                `<span style="color:#94a3b8;font-size:11px">來源：OpenStreetMap（示意，實際以海圖公告為準）</span>`,
            )
            .addTo(g)
        }
        setStatus(`海底電纜：已載入 ${fs.length} 條（OSM）`)
      })
      .catch(() => {
        if (!cancelled) setStatus('⚠ 海底電纜載入失敗')
      })
    return () => {
      cancelled = true
      g.clearLayers()
      map.removeLayer(g)
      groupRef.current = null
    }
  }, [show, map, setStatus])

  return null
}

/** 內建示意沙洲（OSM 抓到前先墊著；沙洲會隨潮汐堆積移動）。 */
function drawApproxShoals(g: L.LayerGroup) {
  for (const s of SHOALS) {
    L.circle([s.lat, s.lng], {
      radius: s.radiusKm * 1000,
      color: '#ca8a04',
      weight: 1.5,
      opacity: 0.8,
      fillColor: '#eab308',
      fillOpacity: 0.2,
    })
      .bindPopup(`<b style="color:#ca8a04">🏖️ ${s.name}</b><br/>沙洲／淺灘（會隨潮汐堆積移動，擱淺危險）`)
      .addTo(g)
    L.marker([s.lat, s.lng], {
      icon: L.divIcon({
        className: '',
        html: `<div class="shoal-label">🏖️ ${s.name}</div>`,
        iconSize: [120, 16],
        iconAnchor: [60, 8],
      }),
    }).addTo(g)
  }
}

/**
 * 沙洲／淺灘圖層：抓 OSM natural=shoal/beach/tidalflat 面，畫沙色區；擱淺危險。
 * 抓不到就用內建示意（外傘頂洲等）。
 */
export function ShoalLayer({ map }: { map: L.Map }) {
  const show = useTacticalStore((s) => s.showShoal)
  const setStatus = useTacticalStore((s) => s.setStatus)
  const groupRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!show) return
    const g = L.layerGroup().addTo(map)
    groupRef.current = g
    let cancelled = false
    drawApproxShoals(g)
    fetchShoals()
      .then((fs) => {
        if (cancelled || !groupRef.current || !fs.length) return
        g.clearLayers()
        for (const f of fs) {
          const style = { color: '#ca8a04', weight: 1.5, opacity: 0.8, fillColor: '#eab308', fillOpacity: 0.22 }
          const shape = f.closed ? L.polygon(f.coords, style) : L.polyline(f.coords, style)
          shape.bindPopup(`<b style="color:#ca8a04">🏖️ ${f.name || '沙洲／淺灘'}</b><br/>擱淺危險（會隨潮汐堆積移動）<br/><span style="color:#94a3b8;font-size:11px">來源：OpenStreetMap</span>`)
          shape.addTo(g)
        }
        setStatus(`沙洲／淺灘：已載入 ${fs.length} 處 OSM 精準範圍`)
      })
      .catch(() => {
        /* 保留內建示意 */
      })
    return () => {
      cancelled = true
      g.clearLayers()
      map.removeLayer(g)
      groupRef.current = null
    }
  }, [show, map, setStatus])

  return null
}

/**
 * OpenSeaMap 航海標記疊層（免金鑰）：燈塔、浮標、燈桿、航道、水深、禁限制區
 * 等海圖記號，疊在任何底圖上。對海上：辨識助航設施、航道、危險區。
 */
export function SeamarkLayer({ map }: { map: L.Map }) {
  const show = useTacticalStore((s) => s.showSeamark)
  const layerRef = useRef<L.TileLayer | null>(null)

  useEffect(() => {
    if (!show) return
    const tl = L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', {
      maxZoom: 18,
      opacity: 0.9,
      attribution: '航海標記 © OpenSeaMap',
    })
    tl.addTo(map)
    layerRef.current = tl
    return () => {
      map.removeLayer(tl)
      layerRef.current = null
    }
  }, [show, map])

  return null
}

/**
 * 台灣海峽中線（示意）圖層：橫貫海峽的參考線，供越界態勢監控。
 */
export function MedianLineLayer({ map }: { map: L.Map }) {
  const show = useTacticalStore((s) => s.showMedianLine)
  const groupRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!show) return
    const g = L.layerGroup().addTo(map)
    groupRef.current = g
    L.polyline(MEDIAN_LINE, { color: '#f43f5e', weight: 2, dashArray: '10 6', opacity: 0.8 })
      .bindPopup('台灣海峽中線（示意，非官方劃界）：越界態勢監控參考')
      .addTo(g)
    const mid = MEDIAN_LINE[Math.floor(MEDIAN_LINE.length / 2)]
    L.marker(mid, {
      icon: L.divIcon({
        className: '',
        html: `<div class="median-label">台海中線（示意）</div>`,
        iconSize: [92, 16],
        iconAnchor: [46, 8],
      }),
    }).addTo(g)
    return () => {
      g.clearLayers()
      map.removeLayer(g)
      groupRef.current = null
    }
  }, [show, map])

  return null
}
