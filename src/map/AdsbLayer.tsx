import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useTacticalStore } from '../store/tacticalStore'
import { adsbAnchor, aircraftName, emergencyText, fetchAdsb, isHelicopter, normalizeAircraft, AdsbError, ADSB_MAX_DIST_NM, type AdsbAnchor } from '../lib/adsb'
import {
  accumulateGnssObservations,
  binGnssCells,
  gnssCellText,
  normalizeGnssAircraft,
  pruneGnssObservations,
  GNSS_LEVEL_COLORS,
  GNSS_WINDOW_MS,
  type GnssStore,
} from '../lib/gnssIntegrity'
import { errText } from '../lib/feedState'
import { AircraftMarkers } from './aircraftMarkers'

/** 地圖右下的資料出處（ODbL 要求註明）。字是固定的，不含外部資料。 */
const ATTRIBUTION = '飛機 © <a href="https://adsb.lol" target="_blank" rel="noopener">adsb.lol</a> 貢獻者（ODbL）'
/** 只看飛機時 15 秒更新一次（Worker 快取 12 秒，再快也拿到同一份）；只看 GPS 干擾時 1 分鐘就夠。 */
const AIRCRAFT_EVERY_MS = 15_000
const GNSS_ONLY_EVERY_MS = 60_000
/** 連續失敗時最多隔多久再試。 */
const MAX_BACKOFF_MS = 5 * 60_000
/** 飛機資料超過這麼久沒更新就收掉：飛機兩分鐘可以飛 15 浬，留著是錯的位置。 */
const AIRCRAFT_STALE_MS = 2 * 60_000

const keyOf = (a: AdsbAnchor) => `${a.lat},${a.lon},${a.dist}`
const agoText = (ms: number) => (ms < 90_000 ? `${Math.round(ms / 1000)} 秒` : `${Math.round(ms / 60_000)} 分鐘`)

function popupLines(lines: string[]): HTMLElement {
  const el = document.createElement('div')
  el.style.cssText = 'line-height:1.5;max-width:15rem'
  lines.forEach((t, i) => {
    const d = document.createElement('div')
    d.textContent = t
    if (i === 0) d.style.fontWeight = '700'
    else if (i >= 2) d.style.cssText = 'color:#94a3b8;font-size:11px'
    el.appendChild(d)
  })
  return el
}

/**
 * 飛機（ADS-B）＋ GPS 干擾推估。兩個圖層用同一份資料（adsb.lol 經 Worker /api/adsb），
 * 開哪一個就抓，兩個都開也只抓一次。手機、桌機都能用（飛機是 DOM 圖示、干擾格子畫在 canvas）。
 */
export function AdsbLayer({ map }: { map: L.Map }) {
  const showAircraft = useTacticalStore((s) => s.showAircraft)
  const showGnss = useTacticalStore((s) => s.showGnss)
  // 30 分鐘的觀測紀錄放在元件層：關掉飛機、只留 GPS 干擾時不會從零開始累積
  const gnssStore = useRef<GnssStore>(new Map())

  useEffect(() => {
    if (!showAircraft && !showGnss) return
    const st = useTacticalStore.getState()
    const planeGroup = showAircraft ? L.layerGroup().addTo(map) : null
    const planes = planeGroup ? new AircraftMarkers(planeGroup) : null
    const cellGroup = showGnss ? L.layerGroup().addTo(map) : null
    if (planes) map.attributionControl.addAttribution(ATTRIBUTION)
    if (showAircraft) st.setFeed('aircraft', 'loading', '向 adsb.lol 要附近的飛機…')
    if (showGnss) st.setFeed('gnss', 'loading', '向 adsb.lol 要飛機回報的定位精度…')

    const every = showAircraft ? AIRCRAFT_EVERY_MS : GNSS_ONLY_EVERY_MS
    let stopped = false
    let timer: number | undefined
    let ctrl: AbortController | null = null
    let lastKey = ''
    let lastOkAt = 0
    let lastPollAt = 0
    let failures = 0
    /** 已經提醒過的緊急飛機：每架只跳一次提示，不要每 15 秒跳一次。 */
    const alerted = new Set<string>()

    const anchorNow = () => {
      const c = map.getCenter().wrap()
      const radiusNm = map.distance(map.getCenter(), map.getBounds().getNorthEast()) / 1852
      return { a: adsbAnchor(c.lat, c.lng, Math.max(5, Math.min(radiusNm, ADSB_MAX_DIST_NM))), clipped: radiusNm > ADSB_MAX_DIST_NM }
    }

    const drawCells = (stale: boolean) => {
      if (!cellGroup) return
      const now = Date.now()
      pruneGnssObservations(gnssStore.current, now)
      const cells = binGnssCells(gnssStore.current)
      cellGroup.clearLayers()
      for (const c of cells) {
        const color = GNSS_LEVEL_COLORS[c.level]
        L.rectangle(
          [
            [c.south, c.west],
            [c.north, c.east],
          ],
          {
            color,
            weight: c.anomaly ? 1.5 : 0.5,
            opacity: c.anomaly ? 0.9 : 0.35,
            fillColor: color,
            // 正常的格子只淡淡一層：重點是異常格，不要整片綠蓋住海圖
            fillOpacity: c.level === 'high' ? 0.35 : c.level === 'medium' ? 0.25 : 0.05,
          },
        )
          .bindPopup(() => popupLines(gnssCellText(c)))
          .addTo(cellGroup)
      }
      let oldest = now
      for (const o of gnssStore.current.values()) oldest = Math.min(oldest, o.seenAt)
      const minutes = Math.min(GNSS_WINDOW_MS / 60_000, Math.round((now - oldest) / 60_000))
      const anomalies = cells.filter((c) => c.anomaly).length
      const span = minutes < 1 ? '剛開始累積' : `已累積 ${minutes} 分鐘`
      if (cells.length === 0) {
        st.setFeed('gnss', 'empty', `還在累積：每格至少 3 架飛機才判斷（${span}，最多看 30 分鐘；遠離陸地沒有接收站的海域不會有格子）`)
      } else {
        const text = `${cells.length} 格有足夠飛機，${anomalies} 格定位異常（${span}）`
        st.setFeed('gnss', stale ? 'stale' : 'ok', stale ? `${text}；adsb.lol 暫時抓不到，用的是舊資料` : text)
      }
    }

    const schedule = (ms: number) => {
      window.clearTimeout(timer)
      if (!stopped) timer = window.setTimeout(() => void poll(), ms)
    }

    const poll = async () => {
      if (stopped) return
      // 背景時不抓（省電、省流量）；回到前景由 visibilitychange 馬上補一次
      if (document.hidden) return schedule(every)
      const { a, clipped } = anchorNow()
      if (!a) return schedule(every)
      ctrl?.abort()
      ctrl = new AbortController()
      lastPollAt = Date.now()
      try {
        const snap = await fetchAdsb(a, { signal: ctrl.signal })
        if (stopped) return
        failures = 0
        lastKey = keyOf(a)
        lastOkAt = Date.now()
        const now = Date.now()
        // 用伺服器算的資料年齡回推觀測時間：手機時鐘不準也不會把舊資料當新的
        const rows = normalizeGnssAircraft({ ac: snap.ac }) ?? []
        accumulateGnssObservations(gnssStore.current, rows, now, { observedAt: now - snap.ageSec * 1000 })
        drawCells(snap.stale)

        if (planes) {
          const list = normalizeAircraft({ ac: snap.ac }) ?? []
          planes.update(list, snap.ageSec)
          const emerg = list.filter((x) => emergencyText(x))
          for (const x of emerg) {
            if (alerted.has(x.hex)) continue
            alerted.add(x.hex)
            st.setStatus(`🆘 附近飛機發出緊急：${aircraftName(x)}（${emergencyText(x)}）——點紅色飛機看詳情`)
          }
          const clip = clipped ? '；畫面太大，只顯示中心 250 浬內' : ''
          if (list.length === 0) {
            st.setFeed('aircraft', 'empty', `這附近沒有收到飛機（遠離陸地沒有接收站，不代表天上沒有飛機）${clip}`)
          } else {
            const parts = [`${list.length} 架`]
            if (emerg.length) parts.push(`${emerg.length} 架發緊急`)
            const mil = list.filter((x) => x.military).length
            if (mil) parts.push(`${mil} 架軍機`)
            const heli = list.filter(isHelicopter).length
            if (heli) parts.push(`${heli} 架直升機`)
            const text = parts.join('、') + clip
            st.setFeed(
              'aircraft',
              snap.stale ? 'stale' : 'ok',
              snap.stale ? `${text}；adsb.lol 暫時抓不到，這是 ${agoText(snap.ageSec * 1000)}前的位置` : text,
            )
          }
        }
        schedule(every)
      } catch (e) {
        if (stopped || (e instanceof DOMException && e.name === 'AbortError')) return
        failures++
        const msg = errText(e, '飛機資料抓不到，稍後自動再試')
        const retryMs = e instanceof AdsbError && e.retryAfterSec ? e.retryAfterSec * 1000 : 0
        const wait = Math.max(retryMs, Math.min(MAX_BACKOFF_MS, every * 2 ** Math.min(failures - 1, 4)))
        const since = Date.now() - lastOkAt
        if (planes) {
          if (lastOkAt && since < AIRCRAFT_STALE_MS) {
            st.setFeed('aircraft', 'stale', `${msg}（畫面上是 ${agoText(since)}前的位置）`)
          } else {
            // 太舊的飛機位置不留：飛機跑得快，留著會誤導
            planes.clear()
            st.setFeed('aircraft', 'error', msg)
          }
        }
        if (cellGroup) {
          if (gnssStore.current.size) drawCells(true)
          else st.setFeed('gnss', 'error', msg)
        }
        schedule(wait)
      }
    }

    // 移動地圖：等停下來，換了查詢範圍才重抓（同一格內小移動用現有資料就好）
    let moveTimer: number | undefined
    const onMove = () => {
      window.clearTimeout(moveTimer)
      moveTimer = window.setTimeout(() => {
        const { a } = anchorNow()
        if (a && keyOf(a) !== lastKey) void poll()
      }, 800)
    }
    const onVisible = () => {
      if (!document.hidden && Date.now() - lastPollAt > every) void poll()
    }
    map.on('moveend', onMove)
    document.addEventListener('visibilitychange', onVisible)
    void poll()

    return () => {
      stopped = true
      window.clearTimeout(timer)
      window.clearTimeout(moveTimer)
      ctrl?.abort()
      map.off('moveend', onMove)
      document.removeEventListener('visibilitychange', onVisible)
      if (planes) {
        planes.clear()
        if (planeGroup) map.removeLayer(planeGroup)
        map.attributionControl.removeAttribution(ATTRIBUTION)
      }
      if (cellGroup) map.removeLayer(cellGroup)
    }
  }, [showAircraft, showGnss, map])

  return null
}
