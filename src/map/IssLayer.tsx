import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useTacticalStore } from '../store/tacticalStore'
import {
  fetchIssFix,
  isOverhead,
  issFootprintKm,
  ISS_INCLINATION_DEG,
  orbitPeriodMin,
  type IssFix,
} from '../lib/issTrack'
import {
  coversPoint,
  groundTrack,
  splitAtDateline,
  type OrbitAnchor,
} from '../lib/groundTrack'
import { distanceKm, bearingDeg } from '../lib/windRadar'
import { bearingToText } from '../lib/drift'
import { formatDist } from '../lib/units'

// ── ISS 即時星下點圖層 ─────────────────────────────────────
//
// 每 10 秒抓一次位置，畫出：星下點、可見地平圈、最近一段航跡。
// 只在軌道模式且使用者打開開關時才跑——它會持續用網路。
//
// 誠實標註（跟 overpass.ts 同樣的風格）：
//  - 這是「星下點」，不是可見性預報。圈內代表「幾何上看得到」，
//    實際要看得見還要天黑、它被陽光照到、而且沒雲。
//  - 需要連網。離線時維持最後一筆，不會清空。
//  - 10 秒刷新 → 那顆點最多落後約 75 公里（ISS 對地約 7.66 km/s）。

const REFRESH_MS = 10000
/** 航跡最多留幾點（10 秒一點 → 約 10 分鐘）。 */
const MAX_TRAIL = 60

export function IssLayer({ map }: { map: L.Map }) {
  const mode = useTacticalStore((s) => s.mode)
  const showIss = useTacticalStore((s) => s.showIss)
  const issFix = useTacticalStore((s) => s.issFix)
  const issTrail = useTacticalStore((s) => s.issTrail)
  const setIssFix = useTacticalStore((s) => s.setIssFix)
  const setStatus = useTacticalStore((s) => s.setStatus)
  const unit = useTacticalStore((s) => s.distUnit)
  const groupRef = useRef<L.LayerGroup | null>(null)

  // ── 輪詢 ──────────────────────────────────────────────
  useEffect(() => {
    if (mode !== 'orbit' || !showIss) return
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | undefined

    const load = async () => {
      try {
        const fix = await fetchIssFix()
        if (cancelled) return
        setIssFix(fix, MAX_TRAIL)
      } catch (e) {
        if (cancelled) return
        // 取不到就維持上一筆，不清空——海上網路本來就會斷斷續續。
        setStatus(`⚠ ${e instanceof Error ? e.message : 'ISS 位置取得失敗'}`)
      }
    }
    load()
    timer = setInterval(load, REFRESH_MS)
    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
    }
  }, [mode, showIss, setIssFix, setStatus])

  // ── 繪製 ──────────────────────────────────────────────
  useEffect(() => {
    const g = L.layerGroup().addTo(map)
    groupRef.current = g
    if (mode !== 'orbit' || !showIss || !issFix) {
      return () => {
        g.clearLayers()
        map.removeLayer(g)
        groupRef.current = null
      }
    }

    const fix: IssFix = issFix
    const c = map.getCenter()
    const km = distanceKm(c.lat, c.lng, fix.lat, fix.lng)
    const brg = bearingDeg(c.lat, c.lng, fix.lat, fix.lng)
    const overhead = isOverhead(km, fix.altKm)
    const footKm = issFootprintKm(fix.altKm)
    const color = overhead ? '#34d399' : '#22d3ee'

    // 可見地平圈：圈內「幾何上」看得到
    L.circle([fix.lat, fix.lng], {
      radius: footKm * 1000,
      color,
      weight: 1,
      opacity: 0.55,
      fillColor: color,
      fillOpacity: 0.06,
      dashArray: '5 5',
    }).addTo(g)

    // ── 接下來會飛過哪裡（未來一圈的地面軌跡）────────────
    //
    // 錨點用的是「剛抓到的真實星下點」，不是假造的軌道根數——
    // 傾角與週期只決定軌跡的形狀，位置完全由這個真實錨點決定。
    // 上升/下降由最近兩筆航跡判斷；只有一筆時先當上升段（下一輪就會修正）。
    const prev = issTrail.length > 1 ? issTrail[issTrail.length - 2] : null
    const ascending = prev ? fix.lat >= prev.lat : true
    const anchor: OrbitAnchor = {
      at: fix.at,
      lat: fix.lat,
      lng: fix.lng,
      inclinationDeg: ISS_INCLINATION_DEG,
      periodMin: orbitPeriodMin(fix.altKm),
      ascending,
    }
    const periodMs = anchor.periodMin * 60 * 1000
    const track = groundTrack(anchor, fix.at, fix.at + periodMs, 30)
    for (const seg of splitAtDateline(track)) {
      L.polyline(
        seg.map((p) => [p.lat, p.lng] as [number, number]),
        { color, weight: 1.5, opacity: 0.5, dashArray: '4 6' },
      )
        .bindPopup(
          '<b>ISS 接下來一圈的地面軌跡</b><br/>' +
            '<span style="color:#94a3b8;font-size:11px">圓軌道近似，錨定在剛抓到的真實星下點。' +
            '一兩圈內夠準，不要拿來預報好幾天以後。</span>',
        )
        .addTo(g)
    }

    // 最接近畫面中心的時刻——這才是「它什麼時候會到我頭上」
    const pass = coversPoint(track, 2 * footKm, c.lat, c.lng)

    // 航跡
    if (issTrail.length > 1) {
      L.polyline(
        issTrail.map((p) => [p.lat, p.lng] as [number, number]),
        { color, weight: 2, opacity: 0.6 },
      ).addTo(g)
    }

    const sunny = fix.visibility === 'daylight'
    const age = Math.max(0, Math.round((Date.now() - fix.at) / 1000))
    L.marker([fix.lat, fix.lng], {
      icon: L.divIcon({
        className: '',
        html:
          `<div class="radio-marker" style="border-color:${color};color:${color}">🛰️` +
          `<div class="radio-label" style="color:${color}">ISS` +
          (fix.altKm ? ` ${Math.round(fix.altKm)}km` : '') +
          `</div></div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      }),
    })
      .bindPopup(
        `<b style="color:${color}">🛰️ ISS 國際太空站</b><br/>` +
          `星下點 ${fix.lat.toFixed(2)}, ${fix.lng.toFixed(2)}<br/>` +
          (fix.altKm ? `高度 ${Math.round(fix.altKm)} km` : '高度 無資料') +
          (fix.speedKmh ? `｜對地速度 ${Math.round(fix.speedKmh).toLocaleString()} km/h` : '') +
          '<br/>' +
          `距畫面中心 ${formatDist(km, unit)}　方位 ${bearingToText(brg)}（${Math.round(brg)}°）<br/>` +
          `${overhead ? '<b style="color:#34d399">在可見地平圈內</b>' : '在可見地平圈外'}` +
          `（半徑 ${formatDist(footKm, unit, 0)}）<br/>` +
          (pass
            ? `下次最接近畫面中心 ${new Date(pass.at).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}` +
              `（屆時距 ${formatDist(pass.km, unit)}${pass.covered ? '，在可見圈內' : '，仍在可見圈外'}）<br/>`
            : '') +
          `日照 ${fix.visibility ?? '無資料'}${sunny ? '（被陽光照到）' : ''}<br/>` +
          `<span style="color:#94a3b8;font-size:11px">資料 ${age}s 前 · 來源 ${fix.source}。` +
          '這是「它現在飛在哪」的星下點，不是可見性預報——圈內只代表幾何上看得到，' +
          '真的要看見還得天黑、它被陽光照到、而且沒雲。</span>',
      )
      .addTo(g)

    return () => {
      g.clearLayers()
      map.removeLayer(g)
      groupRef.current = null
    }
  }, [mode, showIss, issFix, issTrail, unit, map])

  return null
}
