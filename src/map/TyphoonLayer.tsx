import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useTacticalStore } from '../store/tacticalStore'
import { demoTyphoon, currentPoint, hasForecast, type Typhoon } from '../lib/typhoon'
import { isCwaConfigured } from '../lib/config'
import { fetchCwaTyphoons } from '../lib/cwa'
import { fetchGdacsTyphoon } from '../lib/gdacs'
import { estimateWarnings } from '../lib/typhoonWarning'
import { offsetRing, TAIWAN_BASELINE } from '../lib/territorialWaters'
import { fmtDay, fmtDayHour, fmtClockShort } from '../lib/timefmt'

/**
 * 颱風路徑圖層：現在位置（旋轉符號）+ 暴風圈 + 預報路徑 + 潛勢範圍錐 + 時間點。
 * 有設定 CWA 授權碼＋Worker → 抓中央氣象署『颱風路徑潛勢預報』真實資料；
 * 否則用示範颱風。無颱風期間 CWA 會回空 → 亦退回示範以展示能力。
 */
export function TyphoonLayer({ map }: { map: L.Map }) {
  const mode = useTacticalStore((s) => s.mode)
  const setStatus = useTacticalStore((s) => s.setStatus)
  const setActiveTyphoon = useTacticalStore((s) => s.setActiveTyphoon)
  const setActiveTyphoons = useTacticalStore((s) => s.setActiveTyphoons)
  const activeTyphoon = useTacticalStore((s) => s.activeTyphoon)
  const activeTyphoons = useTacticalStore((s) => s.activeTyphoons)
  const tyScrubHours = useTacticalStore((s) => s.tyScrubHours)
  const setTyScrubHours = useTacticalStore((s) => s.setTyScrubHours)
  const groupRef = useRef<L.LayerGroup | null>(null)
  const scrubRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (mode !== 'typhoon') return
    const group = L.layerGroup().addTo(map)
    groupRef.current = group
    let cancelled = false

    // CWA 為何沒用上：'none'=沒設金鑰、'no-warning'=已連上但無發布警報、
    // 'unreachable'=連線/授權失敗。用來在 GDACS 分支如實說明原因。
    let cwaState: 'none' | 'no-warning' | 'unreachable' = 'none'

    // 只設狀態列與 store；實際繪圖交給下方「依選定颱風重畫」的 effect。
    const render = (tys: Typhoon[], source: 'cwa' | 'gdacs' | 'demo', demoReason?: 'none' | 'offline') => {
      if (cancelled || !tys.length) return
      const primary = tys[0]
      setActiveTyphoons(tys)
      setActiveTyphoon(primary) // 預設選最接近台灣者，可點其他颱風切換
      const fc = hasForecast(primary)
      const nm = primary.nameEn && primary.nameEn !== primary.name ? `${primary.name}（${primary.nameEn}）` : primary.name
      const more = tys.length > 1 ? `（另 ${tys.length - 1} 個活動颱風同圖）` : ''
      const estNote = primary.estTrack && primary.estTrack.length ? '；已附青色簡易外推預測（非官方，颱風常轉向僅供概略參考）' : ''
      setStatus(
        source === 'demo'
          ? demoReason === 'offline'
            ? '颱風路徑（示範）：⚠ 即時颱風來源連不上，暫用示範。確認網路後重進此模式；官方預報可設定 CWA 金鑰'
            : '颱風路徑（示範）：目前無活躍颱風（GDACS 未列出近台颱風）。有颱風時會自動切換即時資料'
          : source === 'cwa'
            ? `颱風路徑（中央氣象署 CWA 官方）：${nm}${more}`
            : fc
              ? `颱風（GDACS 含預報時刻）：${nm}${more}`
              : cwaState === 'unreachable'
                ? `颱風（GDACS 觀測軌跡）：${nm}｜紅=已行經、青虛線=簡易外推${estNote}；⚠ 有 CWA 金鑰但連不上（手機瀏覽器多被 CORS 擋）——要拿官方預報路徑須到 ⚙️ 設定填「邊緣 Worker 網址」代理`
                : cwaState === 'no-warning'
                  ? `颱風（GDACS 觀測軌跡）：${nm}｜紅=已行經、青虛線=簡易外推${estNote}；ℹ️ CWA 已連線但未回傳此颱風的官方路徑（可能尚未納入潛勢預報）`
                  : `颱風（GDACS 觀測軌跡）：${nm}｜紅=已行經路徑${estNote}。官方預報請設定 CWA 金鑰＋Worker 代理`,
      )
    }

    // 不先畫示範（避免「示範→即時」閃跳）。查詢中先顯示載入訊息，
    // 有真實資料才畫；CWA(官方) 優先 → GDACS(即時) → 都沒有才退示範。
    setActiveTyphoon(null)
    setActiveTyphoons([])
    setStatus('颱風路徑：查詢即時颱風資料中…')
    const load = async () => {
      if (isCwaConfigured()) {
        try {
          const cwa = await fetchCwaTyphoons(Date.now())
          if (cwa.length && !cancelled) return render(cwa, 'cwa')
          cwaState = 'no-warning' // 已連上 CWA，但目前無活動颱風
        } catch {
          cwaState = 'unreachable' // 連線/授權失敗（CORS/網路/授權碼）
        }
      }
      let gd: Awaited<ReturnType<typeof fetchGdacsTyphoon>> = null
      let offline = false
      try {
        gd = await fetchGdacsTyphoon()
      } catch {
        offline = true // 來源連不上（網路/CORS）——與「沒有颱風」分開告知
      }
      if (gd && !cancelled) return render([gd], 'gdacs')
      if (!cancelled) render([demoTyphoon()], 'demo', offline ? 'offline' : 'none')
    }
    load()

    return () => {
      cancelled = true
      setActiveTyphoon(null)
      setActiveTyphoons([])
      setTyScrubHours(0)
      group.clearLayers()
      map.removeLayer(group)
      groupRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  // ── 依「選定颱風」重畫：選定＝紅色完整（警戒門檻/潛勢錐/可拖曳預判）；
  //    其餘＝琥珀輕量。點任一颱風即切換選定，時間軸拖曳就跟著那顆。──
  useEffect(() => {
    if (mode !== 'typhoon' || !groupRef.current) return
    const group = groupRef.current
    group.clearLayers()
    const sel = activeTyphoon
    if (!sel || !activeTyphoons.length) return
    const setSel = useTacticalStore.getState().setActiveTyphoon
    // 次要（未選）颱風先畫（墊底、可點選）；選定的畫最上層。
    for (const t of activeTyphoons) {
      if (t === sel) continue
      drawSecondary(group, t, () => { setSel(t); setTyScrubHours(0) })
    }
    draw(group, sel)
    const cur = currentPoint(sel)
    const own = useTacticalStore.getState().ownPosition
    if (own) drawRelative(group, own.lat, own.lng, cur.lat, cur.lng)
    map.setView([cur.lat + 1.5, cur.lng - 1.5], 6)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTyphoon, activeTyphoons, mode])

  // ── 時間軸拖曳：畫「+N 小時」暴風圈預判位置（青色圈，隨拖曳移動）──
  useEffect(() => {
    const remove = () => {
      if (scrubRef.current) {
        scrubRef.current.clearLayers()
        map.removeLayer(scrubRef.current)
        scrubRef.current = null
      }
    }
    remove()
    // 無可信未來預報（GDACS 觀測軌跡）時不顯示預判圈——避免畫出停在現在位置的假預判。
    if (mode !== 'typhoon' || !activeTyphoon || tyScrubHours <= 0 || !hasForecast(activeTyphoon)) return
    const s = interpTyphoonAt(activeTyphoon, tyScrubHours)
    if (!s) return
    const g = L.layerGroup().addTo(map)
    scrubRef.current = g
    // 預判暴風圈（青色，與現在的紅圈區隔）
    L.circle([s.lat, s.lng], {
      radius: s.galeRadiusKm * 1000,
      color: '#22d3ee',
      weight: 2,
      dashArray: '5 5',
      fillColor: '#22d3ee',
      fillOpacity: 0.08,
    }).addTo(g)
    L.marker([s.lat, s.lng], {
      icon: L.divIcon({
        className: '',
        html: `<div class="ty-scrub">${fmtDayHour(Date.now() + s.hours * 3600000)} 預判<br/>+${Math.round(s.hours)}h · 近中心風 ${s.windKt} kt</div>`,
        iconSize: [140, 30],
        iconAnchor: [70, -6],
      }),
      zIndexOffset: 1400,
    }).addTo(g)
    return remove
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, activeTyphoon, tyScrubHours])

  return null
}

const DEG = Math.PI / 180
const R = 6371000

/** 畫「您的位置 ↔ 颱風中心」的相對線與距離標籤。 */
function drawRelative(group: L.LayerGroup, ownLat: number, ownLng: number, tyLat: number, tyLng: number) {
  const a =
    Math.sin(((tyLat - ownLat) * DEG) / 2) ** 2 +
    Math.cos(ownLat * DEG) * Math.cos(tyLat * DEG) * Math.sin(((tyLng - ownLng) * DEG) / 2) ** 2
  const km = ((2 * R * Math.asin(Math.sqrt(a))) / 1000).toFixed(0)
  L.polyline(
    [
      [ownLat, ownLng],
      [tyLat, tyLng],
    ],
    { color: '#38bdf8', weight: 1.5, dashArray: '3 5', opacity: 0.7 },
  ).addTo(group)
  const mid: [number, number] = [(ownLat + tyLat) / 2, (ownLng + tyLng) / 2]
  L.marker(mid, {
    icon: L.divIcon({
      className: '',
      html: `<div class="rel-label">距您 ${km} km</div>`,
      iconSize: [80, 16],
      iconAnchor: [40, 8],
    }),
  }).addTo(group)
}

/**
 * 畫「颱風警報門檻」：
 *  - 海上警報門檻線：台灣海岸外約 100km（暴風圈碰到＝達海警發布時機）。
 *  - 在預報路徑上標出「首次達海警/陸警門檻」的位置與時刻，直接看出何時可能發警報。
 */
function drawWarnThresholds(group: L.LayerGroup, ty: Typhoon) {
  // 100km ≈ 54 浬，用既有 offsetRing 由基線外偏，再 Chaikin 平滑成圓潤曲線。
  const seaLine = chaikinClosed(offsetRing(TAIWAN_BASELINE, 100 / 1.852), 3)
  L.polygon(seaLine, {
    color: '#f59e0b',
    weight: 1.5,
    dashArray: '4 6',
    opacity: 0.75,
    fill: false,
    lineJoin: 'round',
  })
    .bindPopup(
      '<b style="color:#f59e0b">海上警報門檻線（離岸約 100km）</b><br/>颱風七級暴風圈碰到此線，即達中央氣象署「海上颱風警報」發布時機（約 24h 前）。',
    )
    .addTo(group)

  const w = estimateWarnings(ty)
  const base = Date.now()
  const flag = (p: { lat: number; lng: number; hours: number }, color: string, label: string) => {
    L.marker([p.lat, p.lng], {
      icon: L.divIcon({
        className: '',
        html: `<div class="warn-flag" style="border-color:${color};color:${color}">⚠ ${label}<br/>${fmtDay(base + p.hours * 3600000)} +${p.hours}h</div>`,
        iconSize: [120, 30],
        iconAnchor: [60, 34],
      }),
      zIndexOffset: 1200,
    }).addTo(group)
  }
  if (w.seaPoint) flag(w.seaPoint, '#f59e0b', '達海警門檻')
  if (w.landPoint) flag(w.landPoint, '#f43f5e', '達陸警門檻')
}

/** Chaikin 角切平滑（封閉環）：把折線的尖角磨圓，看起來更漂亮。 */
function chaikinClosed(pts: [number, number][], iters = 2): [number, number][] {
  let p = pts
  for (let it = 0; it < iters; it++) {
    const out: [number, number][] = []
    const n = p.length
    for (let i = 0; i < n; i++) {
      const a = p[i]
      const b = p[(i + 1) % n]
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25])
      out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75])
    }
    p = out
  }
  return p
}

/** 沿預報路徑內插「+h 小時」的暴風圈預判位置（位置/暴風半徑/風速皆線性內插）。 */
export function interpTyphoonAt(
  ty: Typhoon,
  h: number,
): { lat: number; lng: number; galeRadiusKm: number; windKt: number; hours: number } | null {
  const pts = ty.track.filter((p) => p.hours >= 0).sort((a, b) => a.hours - b.hours)
  if (!pts.length) return null
  if (h <= pts[0].hours) return { ...pts[0], hours: pts[0].hours }
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    if (h >= a.hours && h <= b.hours) {
      const t = (h - a.hours) / ((b.hours - a.hours) || 1)
      return {
        lat: a.lat + (b.lat - a.lat) * t,
        lng: a.lng + (b.lng - a.lng) * t,
        galeRadiusKm: a.galeRadiusKm + (b.galeRadiusKm - a.galeRadiusKm) * t,
        windKt: Math.round(a.windKt + (b.windKt - a.windKt) * t),
        hours: h,
      }
    }
  }
  const last = pts[pts.length - 1]
  return { ...last, hours: last.hours }
}

function dest(lat: number, lng: number, bearingDeg: number, distM: number) {
  const b = bearingDeg * DEG
  return {
    lat: lat + ((distM * Math.cos(b)) / R) / DEG,
    lng: lng + ((distM * Math.sin(b)) / (R * Math.cos(lat * DEG))) / DEG,
  }
}

/**
 * 簡易外推預測（非官方）：從現在位置沿「近期移動方向」等速外推的青色虛線＋
 * 隨時間變寬的潛勢錐。刻意與官方紅色預報區隔，並清楚標「外推·非官方」。
 */
function drawExtrapolation(
  group: L.LayerGroup,
  cur: TyphoonPointLike,
  est: TyphoonPointLike[],
  base: number,
) {
  const path: [number, number][] = [[cur.lat, cur.lng], ...est.map((p) => [p.lat, p.lng] as [number, number])]
  // 潛勢錐（越遠越寬，虛線淡青）
  const left: [number, number][] = []
  const right: [number, number][] = []
  for (let i = 0; i < path.length; i++) {
    const p = path[i]
    const nx = path[Math.min(i + 1, path.length - 1)]
    const brg = (Math.atan2(nx[1] - p[1], nx[0] - p[0]) / DEG + 360) % 360
    const spread = (70 + i * 90) * 1000 // 外推不確定性大 → 錐更寬
    const l = dest(p[0], p[1], brg - 90, spread)
    const r = dest(p[0], p[1], brg + 90, spread)
    left.push([l.lat, l.lng])
    right.push([r.lat, r.lng])
  }
  const cone = [...left, ...right.reverse()]
  if (cone.length > 2) {
    L.polygon(chaikinClosed(cone, 2), {
      color: '#22d3ee',
      weight: 1,
      dashArray: '2 6',
      opacity: 0.4,
      fillColor: '#22d3ee',
      fillOpacity: 0.05,
      lineJoin: 'round',
    }).addTo(group)
  }
  // 外推路徑線（青色虛線）
  L.polyline(path, { color: '#22d3ee', weight: 2, dashArray: '2 7', opacity: 0.9 })
    .bindPopup(
      '<b style="color:#22d3ee">簡易外推預測（非官方）</b><br/><span style="color:#94a3b8;font-size:11px">用近期移動方向×速度等速直線外推，颱風常轉向，僅供概略參考。正式預報請看中央氣象署 CWA。</span>',
    )
    .addTo(group)
  // 外推時間點 + 標籤
  for (const p of est) {
    L.circleMarker([p.lat, p.lng], {
      radius: 3,
      color: '#22d3ee',
      fillColor: '#0e7490',
      fillOpacity: 1,
      weight: 1.5,
    }).addTo(group)
    L.marker([p.lat, p.lng], {
      icon: L.divIcon({
        className: '',
        html: `<div class="ty-est">外推 +${p.hours}h<br/>${fmtClockShort(base + p.hours * 3600000)}</div>`,
        iconSize: [74, 28],
        iconAnchor: [37, -6],
      }),
    }).addTo(group)
  }
}

type TyphoonPointLike = { lat: number; lng: number; hours: number }

/**
 * 次要颱風（非最近台灣者）：輕量畫——琥珀色軌跡線＋現在暴風圈＋名稱，
 * 不畫警戒門檻/潛勢錐，避免多颱時滿版雜亂。點擊看詳情。
 */
function drawSecondary(group: L.LayerGroup, ty: Typhoon, onSelect: () => void) {
  const cur = currentPoint(ty)
  const base = Date.now()
  // 軌跡線（琥珀色，與主要颱風的紅色區隔；點擊亦可切換選定）
  L.polyline(
    ty.track.map((p) => [p.lat, p.lng] as [number, number]),
    { color: '#f59e0b', weight: 1.6, dashArray: '5 5', opacity: 0.75 },
  )
    .on('click', onSelect)
    .addTo(group)
  // 預報點小圈 + 時間
  for (const p of ty.track) {
    if (p.hours < 0) continue
    L.circleMarker([p.lat, p.lng], {
      radius: p === cur ? 4 : 2.5,
      color: '#f59e0b',
      fillColor: '#b45309',
      fillOpacity: 1,
      weight: 1,
    }).addTo(group)
  }
  // 現在暴風圈
  L.circle([cur.lat, cur.lng], {
    radius: cur.galeRadiusKm * 1000,
    color: '#f59e0b',
    weight: 1.5,
    dashArray: '4 4',
    fillColor: '#f59e0b',
    fillOpacity: 0.06,
  }).addTo(group)
  // 颱風符號 + 名稱標籤
  L.marker([cur.lat, cur.lng], {
    icon: L.divIcon({ className: '', html: `<div class="ty-eye" style="filter:hue-rotate(25deg)">🌀</div>`, iconSize: [30, 30], iconAnchor: [15, 15] }),
    zIndexOffset: 1100,
  })
    .bindPopup(
      `<b style="color:#f59e0b">${ty.name}${ty.nameEn && ty.nameEn !== ty.name ? `（${ty.nameEn}）` : ''}</b><br/>${cur.cat}｜近中心風 ${cur.windKt} kt<br/>暴風半徑 ${cur.galeRadiusKm} km<br/><span style="color:#22d3ee;font-size:11px">👆 點我切換：改看這顆的預報＋拖曳預判</span>`,
    )
    .on('click', onSelect)
    .addTo(group)
  L.marker([cur.lat, cur.lng], {
    icon: L.divIcon({
      className: '',
      html: `<div class="ty-time" style="background:rgba(180,83,9,.85);border-color:#f59e0b;color:#fde68a">${ty.name}<br/>${fmtClockShort(base)}</div>`,
      iconSize: [72, 28],
      iconAnchor: [36, -8],
    }),
    zIndexOffset: 1090,
  })
    .on('click', onSelect)
    .addTo(group)
}

function draw(group: L.LayerGroup, ty: Typhoon) {
  const future = ty.track.filter((p) => p.hours >= 0)
  const cur = currentPoint(ty)
  const base = Date.now() // 「現在」基準：+Nh 換算成實際日期/星期

  // 潛勢範圍錐（越遠越寬）：沿預報點左右各偏一個隨時間增大的半徑，連成多邊形
  const left: [number, number][] = []
  const right: [number, number][] = []
  for (let i = 0; i < future.length; i++) {
    const p = future[i]
    const next = future[Math.min(i + 1, future.length - 1)]
    const brg = (Math.atan2((next.lng - p.lng), (next.lat - p.lat)) / DEG + 360) % 360
    const spread = (60 + p.hours * 3) * 1000 // m，隨時間擴大
    const l = dest(p.lat, p.lng, brg - 90, spread)
    const r = dest(p.lat, p.lng, brg + 90, spread)
    left.push([l.lat, l.lng])
    right.push([r.lat, r.lng])
  }
  const cone = [...left, ...right.reverse()]
  if (cone.length > 2) {
    L.polygon(chaikinClosed(cone, 2), {
      color: '#f59e0b',
      weight: 1,
      opacity: 0.45,
      fillColor: '#f59e0b',
      fillOpacity: 0.07,
      lineJoin: 'round',
    }).addTo(group)
  }

  // ── 颱風警報門檻線（依 CWA 準則：暴風圈碰到即達發布時機）──────
  drawWarnThresholds(group, ty)

  // 預報路徑線
  L.polyline(
    ty.track.map((p) => [p.lat, p.lng] as [number, number]),
    { color: '#f43f5e', weight: 2, dashArray: '6 4', opacity: 0.9 },
  ).addTo(group)

  // 各時間點
  for (const p of ty.track) {
    const isNow = p === cur
    L.circleMarker([p.lat, p.lng], {
      radius: isNow ? 5 : 3,
      color: p.hours < 0 ? '#94a3b8' : '#f43f5e',
      fillColor: p.hours < 0 ? '#94a3b8' : '#f43f5e',
      fillOpacity: 1,
      weight: 1,
    })
      .bindPopup(
        `<b style="color:#f43f5e">${p.hours === 0 ? '現在' : p.hours < 0 ? `${-p.hours}h 前` : `+${p.hours}h`}</b>` +
          `<span style="color:#94a3b8"> · ${fmtDayHour(base + p.hours * 3600000)}</span><br/>` +
          `${p.cat}｜近中心風 ${p.windKt} kt<br/>暴風半徑 ${p.galeRadiusKm} km`,
      )
      .addTo(group)
    if (p.hours > 0) {
      L.marker([p.lat, p.lng], {
        icon: L.divIcon({
          className: '',
          html: `<div class="ty-time">${fmtClockShort(base + p.hours * 3600000)}<br/>+${p.hours}h</div>`,
          iconSize: [66, 28],
          iconAnchor: [33, -6],
        }),
      }).addTo(group)
    }
  }

  // 簡易外推預測（青色虛線，非官方）——只有無官方預報時才有 estTrack。
  if (ty.estTrack && ty.estTrack.length) drawExtrapolation(group, cur, ty.estTrack, base)

  // 暴風圈（現在位置）
  L.circle([cur.lat, cur.lng], {
    radius: cur.galeRadiusKm * 1000,
    color: '#f43f5e',
    weight: 2,
    fillColor: '#f43f5e',
    fillOpacity: 0.1,
  }).addTo(group)

  // 颱風符號
  L.marker([cur.lat, cur.lng], {
    icon: L.divIcon({ className: '', html: `<div class="ty-eye">🌀</div>`, iconSize: [34, 34], iconAnchor: [17, 17] }),
    zIndexOffset: 1300,
  })
    .bindPopup(
      `<b style="color:#f43f5e">${ty.name}${ty.nameEn && ty.nameEn !== ty.name ? `（${ty.nameEn}）` : ''}${ty.demo ? '（示範）' : ''}</b><br/>${cur.cat}｜近中心風 ${cur.windKt} kt<br/>暴風半徑 ${cur.galeRadiusKm} km`,
    )
    .addTo(group)
}
