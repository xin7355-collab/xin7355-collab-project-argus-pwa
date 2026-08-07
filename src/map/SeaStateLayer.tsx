import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useTacticalStore } from '../store/tacticalStore'
import { fetchEnvGrid, type MarineEnv } from '../lib/marineEnv'
import { sstColorDyn, waveColorDyn } from '../lib/colorScale'
import { isCwaConfigured } from '../lib/config'
import { fetchCwaSeaAreas } from '../lib/cwaMarine'

/**
 * 海況熱力圖：把當前視野的海溫或浪高畫成彩色網格（免金鑰，Open-Meteo）。
 * 進模式 / 平移地圖 → 抓網格 → 依數值上色。切海溫/浪高即時重畫。
 */
export function SeaStateLayer({ map }: { map: L.Map }) {
  const mode = useTacticalStore((s) => s.mode)
  const field = useTacticalStore((s) => s.seaStateField)
  const setStatus = useTacticalStore((s) => s.setStatus)
  const setCwaSeaAreas = useTacticalStore((s) => s.setCwaSeaAreas)
  const setSeaStateRange = useTacticalStore((s) => s.setSeaStateRange)

  const groupRef = useRef<L.LayerGroup | null>(null)
  const envRef = useRef<MarineEnv[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (mode !== 'seastate') return
    const group = L.layerGroup().addTo(map)
    groupRef.current = group
    let gen = 0 // 世代序號：慢回應不覆蓋新視野

    const draw = () => {
      if (!groupRef.current) return
      group.clearLayers()
      const cols = 10
      const rows = 12
      const b = map.getBounds()
      const dLat = (b.getNorth() - b.getSouth()) / rows
      const dLng = (b.getEast() - b.getWest()) / cols
      // 只用「海上」格算動態範圍（陸地無海溫，排除；否則海溫幾乎同色看不出差異）。
      const seaVals = envRef.current
        .filter((e) => !e.onLand)
        .map((e) => (field === 'sst' ? e.sst : e.waveHeight))
      let min = Math.min(...seaVals)
      let max = Math.max(...seaVals)
      if (!Number.isFinite(min) || !Number.isFinite(max)) {
        min = field === 'sst' ? 24 : 0
        max = field === 'sst' ? 30 : 3
      }
      if (max - min < (field === 'sst' ? 0.5 : 0.2)) max = min + (field === 'sst' ? 0.5 : 0.2)
      setSeaStateRange({ min, max })

      envRef.current.forEach((e, idx) => {
        const r = Math.floor(idx / cols)
        const c = idx % cols
        const south = b.getSouth() + r * dLat
        const west = b.getWest() + c * dLng
        const cell: [[number, number], [number, number]] = [
          [south, west],
          [south + dLat, west + dLng],
        ]
        if (e.onLand) {
          // 陸地：不畫海溫，改淡灰斜紋、popup 標明「陸地」，避免誤標海溫。
          L.rectangle(cell, { stroke: false, fillColor: '#334155', fillOpacity: 0.12 })
            .bindPopup('🏝 陸地（無海面資料）')
            .addTo(group)
          return
        }
        const val = field === 'sst' ? e.sst : e.waveHeight
        const color = field === 'sst' ? sstColorDyn(e.sst, min, max) : waveColorDyn(e.waveHeight, min, max)
        L.rectangle(cell, { stroke: false, fillColor: color, fillOpacity: 1 })
          .bindPopup(field === 'sst' ? `海溫 ${val.toFixed(1)} °C` : `浪高 ${val.toFixed(1)} m`)
          .addTo(group)
      })
    }

    const refresh = async () => {
      const b = map.getBounds()
      const cols = 10
      const rows = 12
      const pts: [number, number][] = []
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const lat = b.getSouth() + ((b.getNorth() - b.getSouth()) * (r + 0.5)) / rows
          const lng = b.getWest() + ((b.getEast() - b.getWest()) * (c + 0.5)) / cols
          pts.push([lat, lng])
        }
      }
      const myGen = ++gen
      setStatus('載入海況熱力圖…')
      const envs = await fetchEnvGrid(pts)
      if (myGen !== gen || !groupRef.current) return // 已被更新視野的抓取取代
      envRef.current = envs
      draw()
      const rng = useTacticalStore.getState().seaStateRange
      const rangeTxt = rng
        ? field === 'sst'
          ? `此區 ${rng.min.toFixed(1)}–${rng.max.toFixed(1)}°C`
          : `此區 ${rng.min.toFixed(1)}–${rng.max.toFixed(1)}m`
        : ''
      setStatus(
        field === 'sst'
          ? `海況：海表溫度（動態色階放大差異，${rangeTxt}；陸地不上色）`
          : `海況：浪高（動態色階，${rangeTxt}；陸地不上色）`,
      )
    }

    const onMoveEnd = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(refresh, 600)
    }

    map.on('moveend', onMoveEnd)
    refresh()

    // CWA 台灣各海域海面天氣/波浪官方預報（有設定才抓，一次即可）。
    let cancelled = false
    setCwaSeaAreas(null)
    if (isCwaConfigured()) {
      fetchCwaSeaAreas().then((s) => {
        if (!cancelled) setCwaSeaAreas(s)
      })
    }

    return () => {
      cancelled = true
      map.off('moveend', onMoveEnd)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      group.clearLayers()
      map.removeLayer(group)
      groupRef.current = null
      envRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, field])

  return null
}
