import L from 'leaflet'
import { aircraftName, altText, categoryText, emergencyText, isHelicopter, sourceText, type Aircraft } from '../lib/adsb'

// ── 飛機圖示：跟 AIS 船一樣只更新有變的（見 aisMarkers.ts 的說明）─────────
//
// 以 ICAO 位址為鍵留住每個圖示；新的加、沒了的拿掉、還在的只移位置與轉向。
// 彈出視窗打開時才建。呼號、註冊號是飛機廣播的文字，一律用 textContent，不用 innerHTML。

/** 機頭朝北的飛機剪影（24×24），用航向旋轉。 */
const PLANE_PATH =
  'M12 2c.7 0 1.2.9 1.2 2v5.2l7.8 4.3v2l-7.8-2.4v4.6l2.2 1.6v1.6L12 20l-3.4.9v-1.6l2.2-1.6v-4.6L3 15.5v-2l7.8-4.3V4c0-1.1.5-2 1.2-2z'
const SVG_NS = 'http://www.w3.org/2000/svg'

interface Look {
  color: string
  cls: string
  key: string
  emerg: string | null
}

function lookOf(a: Aircraft): Look {
  const emerg = emergencyText(a)
  // 顏色依「要不要注意」：緊急 > 軍機 > 直升機（常是搜救、海巡）> 地面 > 一般
  const color = emerg ? '#f43f5e' : a.military ? '#f59e0b' : isHelicopter(a) ? '#4ade80' : a.onGround ? '#64748b' : '#e2e8f0'
  const shape = a.trackDeg === null ? 'dot' : 'plane'
  const cls = `adsb-ac${emerg ? ' adsb-emerg' : ''}`
  return { color, cls, key: `${cls}|${color}|${shape}`, emerg }
}

function iconOf(a: Aircraft, look: Look): L.DivIcon {
  const el = document.createElement('div')
  el.className = look.cls
  el.style.color = look.color
  if (a.trackDeg === null) {
    // 不知道機頭朝哪就畫圓點，不要畫一架指向北方的假飛機
    el.textContent = '●'
  } else {
    const svg = document.createElementNS(SVG_NS, 'svg')
    svg.setAttribute('viewBox', '0 0 24 24')
    svg.setAttribute('width', '20')
    svg.setAttribute('height', '20')
    const p = document.createElementNS(SVG_NS, 'path')
    p.setAttribute('d', PLANE_PATH)
    p.setAttribute('fill', 'currentColor')
    p.setAttribute('stroke', '#0f172a')
    p.setAttribute('stroke-width', '1')
    svg.appendChild(p)
    el.appendChild(svg)
  }
  return L.divIcon({ className: '', html: el, iconSize: [22, 22], iconAnchor: [11, 11] })
}

function applyTrack(marker: L.Marker, track: number | null) {
  const el = marker.getElement()?.firstElementChild as HTMLElement | null | undefined
  if (el) el.style.transform = track === null ? '' : `rotate(${track}deg)`
}

function line(parent: HTMLElement, text: string, color?: string): HTMLElement {
  const d = document.createElement('div')
  d.textContent = text
  if (color) d.style.color = color
  parent.appendChild(d)
  return d
}

function popupOf(a: Aircraft, look: Look, ageSec: number): HTMLElement {
  const el = document.createElement('div')
  el.style.cssText = 'font-family:ui-monospace,monospace;line-height:1.5'
  const title = line(el, `✈ ${aircraftName(a)}`, look.color)
  title.style.fontWeight = '700'
  if (look.emerg) line(el, `🆘 ${look.emerg}`, '#f43f5e').style.fontWeight = '700'
  const id = [`ICAO ${a.hex.toUpperCase()}`, a.reg, a.typeCode].filter(Boolean).join(' · ')
  line(el, id)
  const kind = [categoryText(a.category), a.military ? '軍機（adsb.lol 資料庫標記）' : ''].filter(Boolean).join('・')
  if (kind) line(el, kind, a.military ? '#f59e0b' : undefined)
  const gs = a.gsKn === null ? '—' : `${Math.round(a.gsKn)} kn`
  const trk = a.trackDeg === null ? '—' : `${String(Math.round(a.trackDeg) % 360).padStart(3, '0')}°`
  line(el, `高度 ${altText(a)}`)
  line(el, `地速 ${gs} · 航向 ${trk}`)
  if (a.squawk) line(el, `詢答碼 ${a.squawk}`)
  const age = Math.round(a.seenPosSec + ageSec)
  line(el, `${sourceText(a.source)} · 位置 ${age} 秒前`, age > 30 ? '#f59e0b' : '#94a3b8')
  line(el, '資料：adsb.lol 貢獻者（ODbL）', '#64748b').style.fontSize = '10px'
  return el
}

interface Entry {
  marker: L.Marker
  a: Aircraft
  look: string
  track: number | null
}

export class AircraftMarkers {
  private entries = new Map<string, Entry>()
  private ageSec = 0
  private openHex: string | null = null

  constructor(private group: L.LayerGroup) {}

  /** @param ageSec 這份快照在伺服器端已經多舊（秒），彈出視窗算「位置幾秒前」用 */
  update(list: Aircraft[], ageSec: number): void {
    this.ageSec = ageSec
    const seen = new Set<string>()
    for (const a of list) {
      seen.add(a.hex)
      const look = lookOf(a)
      const e = this.entries.get(a.hex)
      if (!e) {
        const marker = L.marker([a.lat, a.lng], {
          icon: iconOf(a, look),
          keyboard: false,
          // 發緊急的疊在最上面，不會被其他飛機蓋住
          zIndexOffset: look.emerg ? 1000 : 0,
        })
        const entry: Entry = { marker, a, look: look.key, track: a.trackDeg }
        marker.bindPopup(() => popupOf(entry.a, lookOf(entry.a), this.ageSec))
        marker.on('popupopen', () => (this.openHex = entry.a.hex))
        marker.on('popupclose', () => {
          if (this.openHex === entry.a.hex) this.openHex = null
        })
        marker.on('add', () => applyTrack(marker, entry.track))
        marker.addTo(this.group)
        this.entries.set(a.hex, entry)
        continue
      }
      e.a = a
      const ll = e.marker.getLatLng()
      if (ll.lat !== a.lat || ll.lng !== a.lng) e.marker.setLatLng([a.lat, a.lng])
      if (e.look !== look.key) {
        e.look = look.key
        e.marker.setIcon(iconOf(a, look))
        e.marker.setZIndexOffset(look.emerg ? 1000 : 0)
        e.track = a.trackDeg
        applyTrack(e.marker, e.track)
      } else if (e.track !== a.trackDeg) {
        e.track = a.trackDeg
        applyTrack(e.marker, e.track)
      }
      if (this.openHex === a.hex && e.marker.isPopupOpen()) e.marker.getPopup()?.setContent(popupOf(a, look, ageSec))
    }
    for (const [hex, e] of this.entries) {
      if (seen.has(hex)) continue
      this.group.removeLayer(e.marker)
      this.entries.delete(hex)
    }
  }

  clear(): void {
    this.group.clearLayers()
    this.entries.clear()
    this.openHex = null
  }
}
