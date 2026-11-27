import { useEffect } from 'react'
import L from 'leaflet'
import { useTacticalStore } from '../store/tacticalStore'
import { droneStore, DroneDataError, sourceText } from '../lib/droneClient'
import {
  CAA_PORTAL,
  checkPoint,
  ftToM,
  LEVEL_TEXT,
  NEAR_M,
  periodText,
  verdictText,
  zoneActive,
  zoneDesc,
  zoneTag,
  type DroneZone,
  type PointCheck,
} from '../lib/droneZones'
import { errText } from '../lib/feedState'

/** 地圖右下的資料出處。字是固定的，不含外部資料。 */
const ATTRIBUTION = '禁限航區：交通部民用航空局（僅供參考）'
const COLORS = { no: '#ef4444', limit: '#f59e0b', notice: '#22c55e' } as const

function styleFor(z: DroneZone): L.PolylineOptions {
  if (z.level === 'notice') {
    return { color: COLORS.notice, weight: 1.2, opacity: 0.8, fillColor: COLORS.notice, fillOpacity: 0.05, dashArray: '6 4', bubblingMouseEvents: false }
  }
  const color = COLORS[z.level]
  return {
    color,
    // 臨時公告（活動、煙火）框線加粗：最容易不知道、也最常臨時出現
    weight: z.layer === 'temporary' ? 2.5 : 1,
    opacity: 0.9,
    fillColor: color,
    fillOpacity: z.level === 'no' ? 0.2 : 0.13,
    dashArray: z.layer === 'port' ? '3 3' : undefined,
    bubblingMouseEvents: false,
  }
}

const toLatLngs = (z: DroneZone) => z.polys.map((poly) => poly.map((ring) => ring.map(([x, y]) => [y, x] as [number, number])))

function el(tag: string, text?: string, css?: string): HTMLElement {
  const e = document.createElement(tag)
  if (text !== undefined) e.textContent = text
  if (css) e.style.cssText = css
  return e
}

/** 點一個位置的彈出視窗：結論＋這裡所有的公告（資料是外部來的，一律 textContent）。 */
function popupFor(c: PointCheck): HTMLElement {
  const box = el('div', undefined, 'line-height:1.45;max-width:16rem;font-size:12px')
  box.appendChild(el('div', verdictText(c), 'font-weight:700;margin-bottom:4px'))
  for (const z of c.inside.slice(0, 4)) {
    const item = el('div', undefined, 'margin-top:4px;padding-top:4px;border-top:1px solid #334155')
    const dot = z.level === 'no' ? '🔴' : z.level === 'limit' ? '🟡' : '🟢'
    item.appendChild(el('div', `${dot} ${z.name}`, 'font-weight:600'))
    item.appendChild(el('div', `${zoneTag(z)}・${LEVEL_TEXT[z.level]}・${periodText(z)}`, 'color:#94a3b8;font-size:11px'))
    if (z.ceilingFt !== undefined) item.appendChild(el('div', `${z.ceilingFt} 呎（約 ${ftToM(z.ceilingFt)} 公尺）以上禁止`, 'font-size:11px'))
    const desc = zoneDesc(z)
    if (desc) item.appendChild(el('div', desc.length > 140 ? `${desc.slice(0, 140)}…` : desc, 'white-space:pre-line;font-size:11px'))
    box.appendChild(item)
  }
  if (c.inside.length > 4) box.appendChild(el('div', `還有 ${c.inside.length - 4} 筆，打開 🛸 無人機面板看全部`, 'color:#94a3b8;font-size:11px;margin-top:4px'))
  const foot = el('div', undefined, 'margin-top:6px;color:#94a3b8;font-size:10px')
  foot.appendChild(document.createTextNode('僅供參考，以民航局公告為準 · '))
  const a = el('a', '官方系統') as HTMLAnchorElement
  a.href = CAA_PORTAL
  a.target = '_blank'
  a.rel = 'noopener'
  foot.appendChild(a)
  box.appendChild(foot)
  return box
}

/**
 * 無人機禁限航區（民航局圖資）。畫在 canvas：紅＝禁止、黃＝有條件、綠虛線＝國家公園、
 * 商港區點線框、臨時公告粗框。縮得很小時只畫總覽（機場、限航區、商港、國家公園），
 * 放大才畫縣市公告的幾千筆小範圍（資料量的考量，燈號會講）。
 *
 * 🛸 面板開著時：點地圖（含點在區內）＝換檢查位置，畫 🛸 與 1 公里圈；
 * 面板關著時：點區域跳出「這裡有哪些公告」（重疊的一次列出來）。
 */
export function DroneZoneLayer({ map }: { map: L.Map }) {
  const show = useTacticalStore((s) => s.showDroneZones)
  const panelOpen = useTacticalStore((s) => s.openTool === 'drone')
  const target = useTacticalStore((s) => s.droneTarget)

  // 區域
  useEffect(() => {
    if (!show) return
    const st = useTacticalStore.getState()
    const group = L.layerGroup().addTo(map)
    const drawn = new Map<string, L.Polygon>()
    let drawnDetail: boolean | null = null
    let ctrl: AbortController | null = null
    let timer: number | undefined
    let disposed = false
    map.attributionControl.addAttribution(ATTRIBUTION)
    st.setFeed('drone', 'loading', '讀取禁限航區資料…')

    const onZoneClick = (e: L.LeafletMouseEvent) => {
      const s = useTacticalStore.getState()
      const { lat, lng } = e.latlng
      if (s.openTool === 'drone') {
        s.setDroneTarget({ lat, lng })
        return
      }
      // 用那一格的完整圖磚判定（縮小時畫的是簡化過的總覽）
      const popup = L.popup({ maxWidth: 280 }).setLatLng(e.latlng).setContent('查詢中…').openOn(map)
      droneStore
        .zonesAt(lat, lng)
        .then((zones) => popup.setContent(popupFor(checkPoint(lat, lng, zones, Date.now()))))
        .catch((err) => popup.setContent(errText(err)))
    }

    const refresh = async () => {
      ctrl?.abort()
      const my = new AbortController()
      ctrl = my
      const b = map.getBounds()
      try {
        const { zones, detail } = await droneStore.zonesForView([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], my.signal)
        if (disposed || my.signal.aborted) return
        // 總覽與完整圖磚的同一筆幾何精細度不同：切換時整批重畫
        if (drawnDetail !== detail) {
          group.clearLayers()
          drawn.clear()
          drawnDetail = detail
        }
        const now = Date.now()
        const visible = zones.filter((z) => zoneActive(z, now))
        const want = new Set(visible.map((z) => z.id))
        for (const [id, poly] of drawn) {
          if (!want.has(id)) {
            group.removeLayer(poly)
            drawn.delete(id)
          }
        }
        const order = { notice: 0, limit: 1, no: 2 }
        let addedBelow = false
        for (const z of [...visible].sort((a, c) => order[a.level] - order[c.level])) {
          if (drawn.has(z.id)) continue
          const poly = L.polygon(toLatLngs(z), styleFor(z))
          poly.on('click', onZoneClick)
          poly.addTo(group)
          drawn.set(z.id, poly)
          if (z.level !== 'no') addedBelow = true
        }
        // 新加的黃區、國家公園會蓋在既有紅區上面：紅區拉回最上層（點的時候先點到禁止的）
        if (addedBelow) for (const z of visible) if (z.level === 'no') drawn.get(z.id)?.bringToFront()
        const idx = droneStore.currentIndex
        const n = (lv: DroneZone['level']) => visible.filter((z) => z.level === lv).length
        const src = idx ? sourceText(idx) : ''
        if (!detail) {
          st.setFeed('drone', 'ok', `縮小時只畫機場、限航區、商港、國家公園（${visible.length} 區）；放大到約 30 公里寬才畫縣市公告的範圍。${src}`)
        } else if (visible.length === 0) {
          st.setFeed('drone', 'empty', `畫面內沒有公告的禁限航區（仍要遵守 400 呎、日出到日落等規定）。${src}`)
        } else {
          st.setFeed('drone', 'ok', `畫面內 ${visible.length} 區：紅 ${n('no')}、黃 ${n('limit')}、國家公園 ${n('notice')}。${src}`)
        }
      } catch (e) {
        if (disposed || my.signal.aborted) return
        if (e instanceof DroneDataError && e.kind === 'not_ready') st.setFeed('drone', 'unconfigured', e.message)
        else st.setFeed('drone', 'error', errText(e))
      }
    }

    const onMove = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(refresh, 250)
    }
    map.on('moveend', onMove)
    void refresh()
    return () => {
      disposed = true
      ctrl?.abort()
      window.clearTimeout(timer)
      map.off('moveend', onMove)
      group.remove()
      map.attributionControl.removeAttribution(ATTRIBUTION)
    }
  }, [show, map])

  // 面板開著：點地圖換檢查位置；打開時把檢查位置挪到卡片上方看得到的地方
  useEffect(() => {
    if (!panelOpen) return
    const onClick = (e: L.LeafletMouseEvent) => useTacticalStore.getState().setDroneTarget({ lat: e.latlng.lat, lng: e.latlng.lng })
    map.on('click', onClick)
    const t = useTacticalStore.getState().droneTarget
    if (t) {
      const p = map.latLngToContainerPoint([t.lat, t.lng])
      const { x: w, y: h } = map.getSize()
      // 底部卡片大約蓋住下半部：位置在上方 40% 以外（或跑出畫面）就挪到水平置中、上方 30% 的地方
      if (p.y > h * 0.4 || p.y < 0 || p.x < 0 || p.x > w) map.panBy([p.x - w / 2, p.y - h * 0.3], { animate: false })
    }
    return () => {
      map.off('click', onClick)
    }
  }, [panelOpen, map])

  // 檢查位置：🛸 與 1 公里圈（附近的公告列到這麼遠）
  useEffect(() => {
    if (!panelOpen || !target) return
    const g = L.layerGroup().addTo(map)
    L.circle([target.lat, target.lng], {
      radius: NEAR_M,
      color: '#22d3ee',
      weight: 1,
      dashArray: '4 4',
      fill: false,
      interactive: false,
    }).addTo(g)
    L.marker([target.lat, target.lng], {
      interactive: false,
      keyboard: false,
      icon: L.divIcon({
        className: '',
        html: '<div style="font-size:26px;line-height:26px;transform:translate(-13px,-13px);filter:drop-shadow(0 0 2px #000)">🛸</div>',
        iconSize: [0, 0],
      }),
    }).addTo(g)
    return () => {
      g.remove()
    }
  }, [panelOpen, target, map])

  return null
}
