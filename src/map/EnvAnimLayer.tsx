import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useTacticalStore } from '../store/tacticalStore'
import { fetchHourlySeriesGrid, fieldAt, type HourlySeries } from '../lib/marineSeries'

/**
 * 環境時間動畫：抓整個視野網格的「逐時」風場+洋流，用時間軸播放，
 * 看未來幾天海象怎麼變化（規劃出海/搜救時機用）。免金鑰（Open-Meteo）。
 */
export function EnvAnimLayer({ map }: { map: L.Map }) {
  const mode = useTacticalStore((s) => s.mode)
  const animEpoch = useTacticalStore((s) => s.animEpoch)
  const setAnimEpoch = useTacticalStore((s) => s.setAnimEpoch)
  const setAnimTimes = useTacticalStore((s) => s.setAnimTimes)
  const setStatus = useTacticalStore((s) => s.setStatus)

  const groupRef = useRef<L.LayerGroup | null>(null)
  const dataRef = useRef<{ pts: [number, number][]; series: HourlySeries[]; times: number[] }>({
    pts: [],
    series: [],
    times: [],
  })
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const genRef = useRef(0)

  // 依指定時刻重畫箭頭（load 完 & 拉時間軸都用同一支）
  const redraw = (epoch: number) => {
    const g = groupRef.current
    if (!g) return
    g.clearLayers()
    const { pts, series } = dataRef.current
    if (!epoch || series.length === 0) return
    pts.forEach((p, i) => {
      const s = series[i]
      if (!s || !s.times.length) return
      const f = fieldAt(s, epoch)
      drawArrow(g, p[0], p[1], f.currentDir, 3500 + f.currentSpeed * 8000, '#34d399', false)
      drawArrow(g, p[0], p[1], (f.windDir + 180) % 360, 2500 + f.windSpeed * 600, '#22d3ee', true)
    })
  }

  // 抓資料（進模式 / 平移地圖）
  useEffect(() => {
    if (mode !== 'envanim') return
    const group = L.layerGroup().addTo(map)
    groupRef.current = group

    const load = async () => {
      const myGen = ++genRef.current // 世代序號：舊回應不覆蓋新資料
      const b = map.getBounds()
      const cols = 8
      const rows = 6
      const pts: [number, number][] = []
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          const lat = b.getSouth() + ((b.getNorth() - b.getSouth()) * (r + 0.5)) / rows
          const lng = b.getWest() + ((b.getEast() - b.getWest()) * (c + 0.5)) / cols
          pts.push([lat, lng])
        }
      setStatus('環境動畫：載入逐時風/洋流…')
      const series = await fetchHourlySeriesGrid(pts, 1, 3)
      if (myGen !== genRef.current || !groupRef.current) return // 已被更新的抓取取代
      const times = series.find((s) => s.times.length)?.times ?? []
      dataRef.current = { pts, series, times }
      setAnimTimes(times)
      // 決定要畫的時刻：沿用目前 animEpoch（若在新時間範圍內），否則取最近「現在」
      const now = Date.now()
      const cur = useTacticalStore.getState().animEpoch
      const chosen = times.length
        ? times.includes(cur)
          ? cur
          : times.reduce((a, b) => (Math.abs(b - now) < Math.abs(a - now) ? b : a))
        : 0
      if (chosen && chosen !== cur) setAnimEpoch(chosen)
      redraw(chosen) // 直接重畫（不依賴 animEpoch 變動觸發），修正平移後箭頭不更新
      setStatus('環境動畫：▶ 播放看風/洋流隨時間變化')
    }

    const onMoveEnd = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(load, 700)
    }
    map.on('moveend', onMoveEnd)
    load()

    return () => {
      map.off('moveend', onMoveEnd)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      group.clearLayers()
      map.removeLayer(group)
      groupRef.current = null
      dataRef.current = { pts: [], series: [], times: [] }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  // 拉時間軸 → 重畫
  useEffect(() => {
    if (mode !== 'envanim') return
    redraw(animEpoch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animEpoch, mode])

  return null
}

// ── 箭頭繪製（與搜救圖層一致）──
const DEG = Math.PI / 180
const R = 6371000
function dest(lat: number, lng: number, bearingDeg: number, distM: number) {
  const b = bearingDeg * DEG
  const dN = distM * Math.cos(b)
  const dE = distM * Math.sin(b)
  return { lat: lat + (dN / R) / DEG, lng: lng + (dE / (R * Math.cos(lat * DEG))) / DEG }
}
function drawArrow(
  group: L.LayerGroup,
  lat: number,
  lng: number,
  bearing: number,
  lengthM: number,
  color: string,
  dashed: boolean,
) {
  const tip = dest(lat, lng, bearing, lengthM)
  const style: L.PolylineOptions = { color, weight: 2, opacity: 0.85, ...(dashed ? { dashArray: '4 3' } : {}) }
  L.polyline([[lat, lng], [tip.lat, tip.lng]], style).addTo(group)
  const wing = lengthM * 0.32
  const l = dest(tip.lat, tip.lng, bearing + 150, wing)
  const r = dest(tip.lat, tip.lng, bearing - 150, wing)
  L.polyline([[tip.lat, tip.lng], [l.lat, l.lng]], style).addTo(group)
  L.polyline([[tip.lat, tip.lng], [r.lat, r.lng]], style).addTo(group)
}
