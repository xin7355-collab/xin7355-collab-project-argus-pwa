import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useTacticalStore } from '../store/tacticalStore'
import { SatelliteCanvasLayer } from './SatelliteCanvasLayer'
import { buildWmsConfig, LAYERS, isSentinelConfigured } from '../lib/sentinel'
import {
  buildGibsTrueColor,
  buildGibsViirs,
  buildEsriImagery,
  buildS2Cloudless,
  buildEsriOcean,
} from '../lib/gibs'
import type { DetectionCollection } from '../types'

/**
 * LayerControl —— 監聽三個「戰術模式狀態」，動態 add/remove 圖層。
 *
 * 圖層堆疊（Z 由低到高）：
 *   1. Base（OSM）      — 由 MapContainer 常駐
 *   2. Tile（WMS 影像） — 本檔管理，SAR / Optical 模式才掛
 *   3. Vector（AI 分析）— 本檔管理，SAR 模式的偵測框
 *   4. Canvas（動態）   — 本檔管理，Orbit 模式的即時衛星
 *
 * 互斥原則：切模式時，先把「不屬於新模式」的重度圖層卸載並清快取，
 * 再掛上新模式需要的圖層。任何時刻只有一種重度資源在跑。
 */
export function LayerControl({ map }: { map: L.Map }) {
  const mode = useTacticalStore((s) => s.mode)
  const maxCloudCover = useTacticalStore((s) => s.maxCloudCover)
  const observationDate = useTacticalStore((s) => s.observationDate)
  const opticalSource = useTacticalStore((s) => s.opticalSource)
  const opticalRadar = useTacticalStore((s) => s.opticalRadar)
  const detections = useTacticalStore((s) => s.detections)
  const setStatus = useTacticalStore((s) => s.setStatus)

  // 各圖層的參照（用 ref 才能在 cleanup 時精準卸載）
  // WMS 與一般 TileLayer(GIBS) 都是 TileLayer 的子/同類，用 TileLayer 兼容兩者。
  const tileRef = useRef<L.TileLayer | null>(null)
  const vectorRef = useRef<L.GeoJSON | null>(null)
  const canvasRef = useRef<SatelliteCanvasLayer | null>(null)

  // 徹底卸載 WMS 影像層 + 清快取（防 Leaflet memory leak）
  const removeTile = () => {
    if (tileRef.current) {
      map.removeLayer(tileRef.current)
      // Leaflet 內部 _tiles 快取在 removeLayer 後仍可能殘留，強制清空
      // @ts-expect-error 存取內部快取以釋放 <img> 記憶體
      tileRef.current._tiles = {}
      tileRef.current = null
    }
  }
  const removeVector = () => {
    if (vectorRef.current) {
      map.removeLayer(vectorRef.current)
      vectorRef.current.clearLayers()
      vectorRef.current = null
    }
  }
  const removeCanvas = () => {
    if (canvasRef.current) {
      map.removeLayer(canvasRef.current) // 觸發 onRemove → cancelAnimationFrame + worker.terminate
      canvasRef.current = null
    }
  }

  // ── 主效果：模式 / 參數改變時重建圖層 ──────────────────
  useEffect(() => {
    // 每次都先全部卸載，確保乾淨、互斥
    removeTile()
    removeVector()
    removeCanvas()

    // 註：orbit 模式已改為「衛星過境預報」（純資訊面板，不掛地圖動畫層）。
    // 觀測窗：光學 Sentinel-2 約每 5 天過境一次、雷達 Sentinel-1 更疏，用範圍取
    // 窗內最新一景，影像才不會忽有忽無（單一日期多半空白）。
    if (mode === 'sar') {
      // Sentinel-1 SAR 影像層（Canvas 已卸載，釋放 RAM）
      mountWms(LAYERS.sarVV, undefined, 12, 'mostRecent')
    } else if (mode === 'optical') {
      // 有 Sentinel 金鑰 → 用 Sentinel-2（10m，可過濾雲量）；
      // 沒有 → 用 NASA GIBS 免金鑰真彩色（約 250m），開箱即用。
      if (isSentinelConfigured()) {
        // 穿雲模式：同日期改用 Sentinel-1 雷達（雲天/夜間看船）；否則 Sentinel-2 真彩。
        // 光學取近 10 天「最少雲」一景，最看得到海面/船，避免多雲季全黑。
        if (opticalRadar) mountWms(LAYERS.sarVV, undefined, 12, 'mostRecent')
        else mountWms(LAYERS.opticalTrueColor, maxCloudCover, 10, 'leastCC')
      } else {
        mountGibs()
      }
    }

    function mountGibs() {
      if (opticalSource === 'esri') {
        const esri = buildEsriImagery()
        esri.on('load', () => setStatus('高解析空拍影像（Esri · 沿岸最銳利、非每日）'))
        esri.addTo(map)
        tileRef.current = esri
        setStatus('載入高解析空拍影像中（Esri）…')
        return
      }
      if (opticalSource === 'ocean') {
        const oc = buildEsriOcean()
        oc.on('load', () => setStatus('海底地形（Esri Ocean · 覆蓋外海：水深/海脊/淺灘）'))
        oc.addTo(map)
        tileRef.current = oc
        setStatus('載入海底地形圖中（Esri Ocean）…')
        return
      }
      if (opticalSource === 'eox') {
        const eox = buildS2Cloudless()
        let eoxErr = 0
        eox.on('load', () => setStatus('Sentinel-2 無雲真彩色（10m · 乾淨平滑、非每日）'))
        eox.on('tileerror', () => {
          eoxErr++
          // EOX 若無回應 → 自動退回 Esri，不讓使用者卡住。
          if (eoxErr === 3) {
            removeTile()
            const esri = buildEsriImagery()
            esri.addTo(map)
            tileRef.current = esri
            setStatus('Sentinel-2 無雲來源無回應，已改用 Esri 高解析空拍')
          }
        })
        eox.addTo(map)
        tileRef.current = eox
        setStatus('載入 Sentinel-2 無雲影像中（EOX · 免金鑰）…')
        return
      }
      // 每日影像：先用 VIIRS（等同 Worldview，較新較乾淨），無資料時退回 MODIS。
      const viirs = buildGibsViirs(observationDate)
      let vErr = 0
      viirs.on('load', () =>
        setStatus('每日衛星影像（VIIRS NOAA-20 · 等同 Worldview，含外海）。想更清晰切「高解析／無雲」'),
      )
      viirs.on('tileerror', () => {
        vErr++
        if (vErr === 3) {
          removeTile()
          const modis = buildGibsTrueColor(observationDate)
          modis.addTo(map)
          tileRef.current = modis
          setStatus('VIIRS 該日無資料，改用 MODIS 每日影像（把日期往回調 1–2 天更保險）')
        }
      })
      viirs.addTo(map)
      tileRef.current = viirs
      setStatus('載入每日衛星影像中（VIIRS）…若空白請把日期往回調 1–2 天')
    }

    function mountWms(
      layer: string,
      maxcc: number | undefined,
      lookbackDays = 0,
      priority: 'leastCC' | 'mostRecent' = 'mostRecent',
    ) {
      if (!isSentinelConfigured()) {
        // SAR 沒有免金鑰替代來源，僅提示。
        setStatus('⚠ 雷達影像需要 Sentinel 金鑰（⚙️ 設定貼上後啟用）')
        return
      }
      const { url, params } = buildWmsConfig({ layer, date: observationDate, maxCloudCover: maxcc, lookbackDays, priority })
      const wms = L.tileLayer.wms(url, {
        ...params,
        // 圖磚無資料（該區/時間沒過境或被雲篩掉）時給透明像素，露出底圖、不破圖。
        errorTileUrl: transparentPixel,
      } as L.WMSOptions)

      // 只提示、不再自動跳成另一種來源——維持「同一種真實影像」，避免忽真彩忽鑲嵌
      // 讓人誤會（使用者回饋：一般人會以為是同一時間的畫面）。無資料就改日期/穿雲。
      let warned = false
      const isRadar = layer === LAYERS.sarVV
      wms.on('tileerror', () => {
        if (!warned) {
          warned = true
          setStatus(
            isRadar
              ? '⚠ 此區近日無 Sentinel-1 雷達影像：把日期往回調，或改晴天真彩'
              : '⚠ 此區近日無 Sentinel-2 影像（雲篩掉或未過境）：調日期、按🔎自動找、或切☁️穿雲雷達',
          )
        }
      })
      wms.on('load', () => {
        setStatus(
          isRadar
            ? `雷達影像載入完成（Sentinel-1 · ≤${observationDate} 近日最新）`
            : `光學影像載入完成（Sentinel-2 10m · ≤${observationDate} 近10日最少雲一景）。仍全黑=近日皆濃雲，改☁️穿雲雷達`,
        )
      })
      wms.addTo(map)
      tileRef.current = wms
    }

    return () => {
      // 卸載元件時（例如熱重載）也要清乾淨
      removeTile()
      removeVector()
      removeCanvas()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, maxCloudCover, observationDate, opticalSource, opticalRadar])

  // ── Vector 層：AI 偵測結果單獨更新（不重建影像層）──────
  useEffect(() => {
    removeVector()
    if (mode === 'sar' && detections && detections.features.length > 0) {
      vectorRef.current = buildDetectionLayer(detections).addTo(map)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detections, mode])

  return null // 純副作用元件，無 DOM 輸出
}

/** 1x1 透明 PNG，當作圖磚載入失敗的替代，避免灰色破圖方塊。 */
const transparentPixel =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

/** 把 AI 偵測 GeoJSON 畫成紅色警示框（疑似無名船隻）。 */
function buildDetectionLayer(fc: DetectionCollection): L.GeoJSON {
  return L.geoJSON(fc as unknown as GeoJSON.GeoJsonObject, {
    pointToLayer: (feature, latlng) => {
      const suspicious = (feature.properties as { suspicious?: boolean })?.suspicious
      const color = suspicious ? '#f43f5e' : '#22d3ee'
      const marker = L.marker(latlng, {
        icon: L.divIcon({
          className: '',
          html: `<div class="detection-box" style="border-color:${color};box-shadow:0 0 8px ${color}"></div>`,
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        }),
      })
      const p = feature.properties as { label: string; confidence: number }
      marker.bindPopup(
        `<div style="font-family:ui-monospace,monospace">
           <b style="color:${color}">${p.label}</b><br/>
           信心度 ${(p.confidence * 100).toFixed(0)}%<br/>
           ${suspicious ? '⚠ 疑似無名船隻' : '一般目標'}
         </div>`,
      )
      return marker
    },
  })
}
