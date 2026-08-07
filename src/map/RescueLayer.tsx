import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useTacticalStore } from '../store/tacticalStore'
import { fetchEnvAt, fetchEnvGrid, climatologyCurrent, type MarineEnv } from '../lib/marineEnv'
import { bearingToText } from '../lib/drift'
import { buildSearchPattern } from '../lib/searchPattern'
import {
  fetchHourlySeries,
  integrateDriftSeries,
  monteCarloSeries,
} from '../lib/marineSeries'
import { isCwaConfigured } from '../lib/config'
import { fetchCwaTide } from '../lib/cwaMarine'
import { fmtClock, fmtClockShort, driftEpoch } from '../lib/timefmt'

/**
 * 搜救推演圖層。只在 rescue 模式運行：
 *  1. 進模式 / 平移地圖 → 抓當前視野的風場 + 洋流網格 → 畫箭頭
 *  2. 點地圖 → 標記落海點 → 抓該點海象 → 算漂流 → 畫預測點與搜索圈
 *
 * 洋流箭頭（綠）＝水流去向；風箭頭（青、虛線）＝風吹去向。
 */
export function RescueLayer({ map }: { map: L.Map }) {
  const mode = useTacticalStore((s) => s.mode)
  const setManOverboard = useTacticalStore((s) => s.setManOverboard)
  const setRescueResult = useTacticalStore((s) => s.setRescueResult)
  const setRescueStatus = useTacticalStore((s) => s.setRescueStatus)
  const setStatus = useTacticalStore((s) => s.setStatus)

  const manOverboard = useTacticalStore((s) => s.manOverboard)
  const scrubHours = useTacticalStore((s) => s.scrubHours)
  const driftLeeway = useTacticalStore((s) => s.driftLeeway)
  const showProbability = useTacticalStore((s) => s.showProbability)
  const showSearchPattern = useTacticalStore((s) => s.showSearchPattern)
  const trackSpacingNm = useTacticalStore((s) => s.trackSpacingNm)
  const mcSummary = useTacticalStore((s) => s.mcSummary)
  const setMcSummary = useTacticalStore((s) => s.setMcSummary)
  const driftPoints = useTacticalStore((s) => s.driftPoints)
  const setDriftPoints = useTacticalStore((s) => s.setDriftPoints)
  const setSourcePoints = useTacticalStore((s) => s.setSourcePoints)
  const incidentTime = useTacticalStore((s) => s.incidentTime)
  const rescueSeries = useTacticalStore((s) => s.rescueSeries)
  const setRescueSeries = useTacticalStore((s) => s.setRescueSeries)
  const setCwaTide = useTacticalStore((s) => s.setCwaTide)

  const fieldRef = useRef<L.LayerGroup | null>(null) // 風/流箭頭
  const driftRef = useRef<L.LayerGroup | null>(null) // 落海點 + 漂流
  const scrubRef = useRef<L.LayerGroup | null>(null) // 時間軸 scrubber
  const probRef = useRef<L.LayerGroup | null>(null) // 蒙地卡羅機率密度
  const searchRef = useRef<L.LayerGroup | null>(null) // 搜索航線
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (mode !== 'rescue') return

    const field = L.layerGroup().addTo(map)
    const drift = L.layerGroup().addTo(map)
    fieldRef.current = field
    driftRef.current = drift
    let fieldGen = 0 // 世代序號：慢回應不覆蓋新視野

    const refreshField = async () => {
      const myGen = ++fieldGen
      const pts = sampleGrid(map.getBounds(), 9, 7)
      const envs = await fetchEnvGrid(pts)
      if (!fieldRef.current || myGen !== fieldGen) return // 期間已卸載或被更新視野取代
      field.clearLayers()
      for (const e of envs) drawEnvArrows(field, e)
      if (envs[0] && !envs[0].live)
        setStatus('搜救推演：即時海象離線，改用黑潮氣候平均（隨位置變化，非即時）')
    }

    const onMoveEnd = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(refreshField, 700)
    }

    // 點地圖只設標記點；海象抓取交給下方 effect（點選或手動輸入座標都適用）。
    // 量測工具啟用時，讓量測優先（不搶點）。
    const onClick = (e: L.LeafletMouseEvent) => {
      if (useTacticalStore.getState().measuring) return
      setManOverboard({ lat: e.latlng.lat, lng: e.latlng.lng })
    }

    map.on('moveend', onMoveEnd)
    map.on('click', onClick)
    refreshField()

    return () => {
      map.off('moveend', onMoveEnd)
      map.off('click', onClick)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      field.clearLayers()
      drift.clearLayers()
      map.removeLayer(field)
      map.removeLayer(drift)
      if (scrubRef.current) {
        scrubRef.current.clearLayers()
        map.removeLayer(scrubRef.current)
        scrubRef.current = null
      }
      if (probRef.current) {
        probRef.current.clearLayers()
        map.removeLayer(probRef.current)
        probRef.current = null
      }
      if (searchRef.current) {
        searchRef.current.clearLayers()
        map.removeLayer(searchRef.current)
        searchRef.current = null
      }
      fieldRef.current = null
      driftRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  // ── 標記點/回報時間一變：抓該點「即時海象」(面板) + 「逐時序列」(時變積分) ──
  useEffect(() => {
    if (mode !== 'rescue' || !manOverboard) return
    let cancelled = false
    setRescueStatus('loading')
    setStatus('已標記位置，讀取歷史/即時海象中…')
    if (!map.getBounds().contains([manOverboard.lat, manOverboard.lng])) {
      map.setView([manOverboard.lat, manOverboard.lng], Math.max(map.getZoom(), 8))
    }
    // 即時海象快照（給面板顯示風/流/浪）
    fetchEnvAt(manOverboard.lat, manOverboard.lng).then((env) => {
      if (!cancelled) setRescueResult(env, [])
    })
    // 逐時序列（給時變漂流積分）。past_days 依回報時間往前多抓一天。
    const pastDays = Math.min(
      14,
      Math.max(2, Math.ceil((Date.now() - incidentTime) / 86400000) + 1),
    )
    setRescueSeries(null)
    fetchHourlySeries(manOverboard.lat, manOverboard.lng, pastDays, 4).then((s) => {
      if (!cancelled) setRescueSeries(s)
    })
    // CWA 在地潮汐（有設定才抓；影響近岸漂流/擱淺判斷）。
    setCwaTide(null)
    if (isCwaConfigured()) {
      fetchCwaTide(manOverboard.lat, manOverboard.lng).then((t) => {
        if (!cancelled) setCwaTide(t)
      })
    }
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, manOverboard, incidentTime])

  // ── 漂流計算：落海點 / 海象 / 物體類型(leeway) 任一改變就重算重畫 ──
  useEffect(() => {
    if (mode !== 'rescue') return
    const drift = driftRef.current
    if (!drift) return
    drift.clearLayers()
    if (!manOverboard) {
      setDriftPoints([])
      setSourcePoints([])
      return
    }
    drawManOverboard(drift, manOverboard.lat, manOverboard.lng, false)
    if (!rescueSeries) {
      setDriftPoints([])
      setSourcePoints([])
      return
    }
    // 離線(氣候平均)時用「空間黑潮場」逐步取流→軌跡隨位置彎曲，不再假直線。
    const spatial = rescueSeries.live ? undefined : climatologyCurrent
    const milestones = [1, 6, 12, 24, 48, 72]
    const fullHours = Array.from({ length: 72 }, (_, i) => i + 1)
    const base = incidentTime // datum 時刻＝回報/落海時間
    const integ = (hrs: number[], rev: boolean) =>
      integrateDriftSeries(manOverboard.lat, manOverboard.lng, rescueSeries, base, hrs, driftLeeway, rev, 0, spatial)

    // 一次算好「順推(未來漂)」與「逆推(來源)」兩個方向——一條時間軸都呈現。
    const fwd = integ(milestones, false)
    const fwdFull = integ(fullHours, false)
    const bwd = integ(milestones, true)
    const bwdFull = integ(fullHours, true)

    // 逆推來源軌跡（琥珀）+ 順推漂流軌跡（紅），都從 datum(✚) 出發。
    drawDrift(drift, manOverboard.lat, manOverboard.lng, bwd, bwdFull, true, incidentTime, '#f59e0b')
    drawDrift(drift, manOverboard.lat, manOverboard.lng, fwd, fwdFull, false, incidentTime, '#f43f5e')
    setDriftPoints(fwd)
    setSourcePoints(bwd)

    // 回報時間在過去 → 標出「現在」的預測位置（最重要）。
    const elapsedH = (Date.now() - incidentTime) / 3600000
    if (elapsedH >= 1) {
      const [nowP] = integ([Math.min(72, Math.round(elapsedH))], false)
      if (nowP) drawNowMarker(drift, nowP.lat, nowP.lng, elapsedH, nowP.radiusMeters)
    }

    setRescueStatus('done')
    const src = rescueSeries.live ? '逐時歷史/預報海象' : '黑潮氣候平均(離線)'
    const lf = fwd[fwd.length - 1]
    setStatus(
      `漂流雙向推演(${src})：紅=順推未來、橙=逆推來源；72h 順推 ${bearingToText(lf.bearingDeg)}方 ${(lf.driftMeters / 1852).toFixed(1)} 浬`,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, manOverboard, rescueSeries, driftLeeway, incidentTime])

  // ── 時間軸 scrubber：一條軸 −72(來源)…0(落海點)…+72(漂流)，畫該時刻位置 ──
  useEffect(() => {
    if (mode !== 'rescue') return
    if (!scrubRef.current) scrubRef.current = L.layerGroup().addTo(map)
    const g = scrubRef.current
    g.clearLayers()
    if (scrubHours !== 0 && manOverboard && rescueSeries) {
      const rev = scrubHours < 0
      const absH = Math.abs(scrubHours)
      const [p] = integrateDriftSeries(
        manOverboard.lat,
        manOverboard.lng,
        rescueSeries,
        incidentTime,
        [absH],
        driftLeeway,
        rev,
        0,
        rescueSeries.live ? undefined : climatologyCurrent,
      )
      if (!p) return
      const col = rev ? '#f59e0b' : '#fbbf24'
      L.circle([p.lat, p.lng], {
        radius: p.radiusMeters,
        color: col,
        weight: 2,
        fillColor: col,
        fillOpacity: 0.15,
      }).addTo(g)
      L.marker([p.lat, p.lng], {
        icon: L.divIcon({
          className: '',
          html: `<div class="scrub-label">${fmtClock(driftEpoch(incidentTime, absH, rev))}<br/><span style="opacity:.75">${rev ? '−' : '+'}${absH}h ${rev ? '來源' : '漂流'}</span></div>`,
          iconSize: [92, 28],
          iconAnchor: [46, 14],
        }),
        zIndexOffset: 1100,
      }).addTo(g)
    }
    return () => {
      g.clearLayers()
    }
  }, [mode, scrubHours, manOverboard, rescueSeries, driftLeeway, incidentTime, map])

  // ── 蒙地卡羅機率密度圖 (SAROPS 式) ──────────────────────
  useEffect(() => {
    if (mode !== 'rescue') return
    if (!probRef.current) probRef.current = L.layerGroup().addTo(map)
    const g = probRef.current
    g.clearLayers()
    if (!showProbability || !manOverboard || !rescueSeries) {
      setMcSummary(null)
      return
    }

    // 依時間軸拉桿：正=順推機率、負=逆推來源機率、0=預設 6h 順推。
    const hours = scrubHours !== 0 ? Math.abs(scrubHours) : 6
    const mcRev = scrubHours < 0
    const mc = monteCarloSeries({
      lat: manOverboard.lat,
      lng: manOverboard.lng,
      series: rescueSeries,
      baseEpoch: incidentTime,
      hours,
      leeway: driftLeeway,
      reverse: mcRev,
      n: 800,
      spatialCurrent: rescueSeries.live ? undefined : climatologyCurrent,
    })
    // 機率密度格：越密→越紅
    for (const cell of mc.cells) {
      const t = cell.count / mc.maxCount
      L.rectangle(
        [
          [cell.south, cell.west],
          [cell.north, cell.east],
        ],
        { stroke: false, fillColor: densityColor(t), fillOpacity: 0.45 + t * 0.4 },
      ).addTo(g)
    }
    // 最高機率點
    if (mc.peak) {
      L.marker([mc.peak.lat, mc.peak.lng], {
        icon: L.divIcon({
          className: '',
          html: `<div class="mc-peak">◎</div>`,
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        }),
        zIndexOffset: 1200,
      })
        .bindPopup(
          `<b style="color:#f43f5e">最高機率位置</b><br/>${hours}h ${mcRev ? '前(來源)' : '後(漂流)'}｜95% 範圍半徑 ${(mc.radius95 / 1852).toFixed(1)} 浬<br/>800 粒子蒙地卡羅（時變）`,
        )
        .addTo(g)
    }
    setMcSummary({ peak: mc.peak, centroid: mc.centroid, radius95: mc.radius95 })
    setStatus(
      `蒙地卡羅機率圖：${hours}h${mcRev ? '前(來源)' : '後(漂流)'}，800 粒子(時變)，95% 範圍半徑 ${(mc.radius95 / 1852).toFixed(1)} 浬`,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, showProbability, manOverboard, rescueSeries, driftLeeway, scrubHours, incidentTime])

  // ── 平行梳掃搜索航線 ──────────────────────────────────
  useEffect(() => {
    if (mode !== 'rescue') return
    if (!searchRef.current) searchRef.current = L.layerGroup().addTo(map)
    const g = searchRef.current
    g.clearLayers()
    if (!showSearchPattern || !manOverboard) return

    // 搜索中心與半徑：優先用蒙地卡羅結果，否則用最後一個漂流點。
    let center = mcSummary?.centroid ?? null
    let radiusM = mcSummary?.radius95 ?? 0
    if (!center) {
      const last = driftPoints[driftPoints.length - 1]
      if (last) {
        center = { lat: last.lat, lng: last.lng }
        radiusM = last.radiusMeters
      }
    }
    if (!center || radiusM <= 0) return

    const sp = buildSearchPattern({
      centerLat: center.lat,
      centerLng: center.lng,
      radiusM,
      spacingM: trackSpacingNm * 1852,
    })
    L.polyline(sp.path, { color: '#22d3ee', weight: 2, opacity: 0.9 }).addTo(g)
    // 起點
    if (sp.path[0]) {
      L.marker(sp.path[0], {
        icon: L.divIcon({
          className: '',
          html: `<div class="search-start">▶</div>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        }),
        zIndexOffset: 1150,
      })
        .bindPopup(
          `<b style="color:#22d3ee">搜索航線起點</b><br/>平行梳掃 ${sp.legs} 條腿｜間距 ${trackSpacingNm} 浬<br/>總航程 ${(sp.lengthM / 1852).toFixed(1)} 浬`,
        )
        .addTo(g)
    }
    setStatus(
      `搜索航線：${sp.legs} 條梳掃腿，間距 ${trackSpacingNm} 浬，總航程 ${(sp.lengthM / 1852).toFixed(1)} 浬`,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, showSearchPattern, trackSpacingNm, mcSummary, driftPoints, manOverboard])

  return null
}

/** 機率密度色階：低(藍紫透明) → 中(黃) → 高(紅)。 */
function densityColor(t: number): string {
  if (t < 0.33) return '#38bdf8'
  if (t < 0.66) return '#fbbf24'
  return '#f43f5e'
}

// ── 幾何工具 ────────────────────────────────────────────────
const DEG = Math.PI / 180
const R = 6371000

function dest(lat: number, lng: number, bearingDeg: number, distM: number) {
  const b = bearingDeg * DEG
  const dN = distM * Math.cos(b)
  const dE = distM * Math.sin(b)
  return {
    lat: lat + (dN / R) / DEG,
    lng: lng + (dE / (R * Math.cos(lat * DEG))) / DEG,
  }
}

/** 在 bounds 內取 cols×rows 網格點（邊緣內縮）。 */
function sampleGrid(bounds: L.LatLngBounds, cols: number, rows: number): [number, number][] {
  const s = bounds.getSouth()
  const n = bounds.getNorth()
  const w = bounds.getWest()
  const e = bounds.getEast()
  const pts: [number, number][] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lat = s + ((n - s) * (r + 0.5)) / rows
      const lng = w + ((e - w) * (c + 0.5)) / cols
      pts.push([lat, lng])
    }
  }
  return pts
}

/** 畫一支帶箭頭的向量（方向為 toward）。 */
function drawArrow(
  group: L.LayerGroup,
  lat: number,
  lng: number,
  bearingToward: number,
  lengthM: number,
  color: string,
  dashed = false,
) {
  const tip = dest(lat, lng, bearingToward, lengthM)
  const style: L.PolylineOptions = {
    color,
    weight: 2,
    opacity: 0.85,
    ...(dashed ? { dashArray: '4 3' } : {}),
  }
  L.polyline([[lat, lng], [tip.lat, tip.lng]], style).addTo(group)
  // 箭頭兩翼
  const wingLen = lengthM * 0.32
  const left = dest(tip.lat, tip.lng, bearingToward + 150, wingLen)
  const right = dest(tip.lat, tip.lng, bearingToward - 150, wingLen)
  L.polyline([[tip.lat, tip.lng], [left.lat, left.lng]], style).addTo(group)
  L.polyline([[tip.lat, tip.lng], [right.lat, right.lng]], style).addTo(group)
}

/** 一個網格點畫「洋流（綠）＋風（青虛線）」兩支箭頭。 */
function drawEnvArrows(group: L.LayerGroup, e: MarineEnv) {
  // 洋流：流向 = toward，長度隨流速
  drawArrow(group, e.lat, e.lng, e.currentDir, 3500 + e.currentSpeed * 8000, '#34d399', false)
  // 風：來向 + 180 = 去向，長度隨風速
  const windToward = (e.windDir + 180) % 360
  drawArrow(group, e.lat, e.lng, windToward, 2500 + e.windSpeed * 600, '#22d3ee', true)
}

function drawManOverboard(group: L.LayerGroup, lat: number, lng: number, reverse: boolean) {
  L.marker([lat, lng], {
    icon: L.divIcon({
      className: '',
      html: `<div class="mob-marker">✚</div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    }),
    zIndexOffset: 1000,
  })
    .bindPopup(
      reverse
        ? '<b style="color:#f43f5e">發現/目擊位置 (回推來源)</b>'
        : '<b style="color:#f43f5e">落海點 (最後已知位置)</b>',
    )
    .addTo(group)
}

/** 順推＋回報時間在過去時，標出「現在」的預測位置（搜救最該去的點）。 */
function drawNowMarker(
  group: L.LayerGroup,
  lat: number,
  lng: number,
  elapsedH: number,
  radiusM: number,
) {
  L.circle([lat, lng], {
    radius: radiusM,
    color: '#34d399',
    weight: 2,
    fillColor: '#34d399',
    fillOpacity: 0.15,
  }).addTo(group)
  L.marker([lat, lng], {
    icon: L.divIcon({
      className: '',
      html: `<div class="now-marker">⌖</div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    }),
    zIndexOffset: 1300,
  })
    .bindPopup(
      `<b style="color:#34d399">目標現在位置（預測）</b><br/>回報後約 ${elapsedH.toFixed(1)} 小時<br/>建議優先搜索此處`,
    )
    .addTo(group)
}

function drawDrift(
  group: L.LayerGroup,
  lat0: number,
  lng0: number,
  points: { hours: number; lat: number; lng: number; radiusMeters: number }[],
  fullPath: { hours: number; lat: number; lng: number }[],
  reverse: boolean,
  incidentTime: number,
  color = '#f43f5e',
) {
  // 漂流/回推軌跡線：用「每小時」完整路徑，隨風/流方向轉折成真實曲線（非直線）。
  const line: [number, number][] = [
    [lat0, lng0],
    ...fullPath.map((p) => [p.lat, p.lng] as [number, number]),
  ]
  L.polyline(line, { color, weight: 2, dashArray: '6 4' }).addTo(group)

  points.forEach((p, i) => {
    const emphasis = i === points.length - 1
    // 搜索圈
    L.circle([p.lat, p.lng], {
      radius: p.radiusMeters,
      color,
      weight: emphasis ? 2 : 1,
      opacity: 0.8,
      fillColor: color,
      fillOpacity: emphasis ? 0.12 : 0.06,
    }).addTo(group)
    // 時間標籤：顯示實際日期時間（比 +Nh 直覺），下方小字附相對時
    L.marker([p.lat, p.lng], {
      icon: L.divIcon({
        className: '',
        html: `<div class="drift-label">${fmtClockShort(driftEpoch(incidentTime, p.hours, reverse))}<br/><span style="opacity:.7">${reverse ? '−' : '+'}${p.hours}h</span></div>`,
        iconSize: [66, 26],
        iconAnchor: [33, 13],
      }),
    }).addTo(group)
  })
}
