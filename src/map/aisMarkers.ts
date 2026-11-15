import L from 'leaflet'
import { analyzeVessel } from '../lib/aisAnomaly'
import { ageText, bowDeg, cogText, sogText, type TrackPoint, type Vessel } from '../lib/aisStore'

// ── AIS 船隻圖示：只更新有變的，不整批重建 ─────────────────────
//
// 以前每收到一筆 AIS，圖層就把全部船的圖示、彈出視窗砍掉重建（divIcon 不吃 preferCanvas，
// 每個都是 DOM 元素）。船一多 iPhone 就發燙、耗電、操作卡頓。
// 做法參考 gods-eye-view（MIT，見 docs/licenses/gods-eye-view-MIT.txt）的 src/layers/vessels/rendering.js：
// 以 MMSI 為鍵留住每個圖示，新的加、沒了的拿掉、還在的只移位置與轉向；
// 彈出視窗只在打開時才建，開著的那一個才跟著資料更新。
//
// 船名一律用 textContent 放進畫面：AIS 船名是任何人都能廣播的文字，
// 用 innerHTML 等於讓任何一艘船在你的 App 裡執行程式。

/** 多久沒回報就把圖示變淡（位置可能已經過時）。 */
const STALE_FADE_SEC = 600

type Tool = 'intercept' | 'dr'

interface Entry {
  marker: L.Marker
  v: Vessel
  /** 圖示外觀的鍵：變了才重建圖示元素（轉向不算，轉向直接改 style）。 */
  look: string
  bow: number | null
}

interface Look {
  color: string
  glyph: string
  cls: string
  key: string
}

function lookOf(v: Vessel): Look & { alerts: string[] } {
  if (v.kind === 'aton') {
    const cls = `ais-vessel ais-aton${v.ageSec > STALE_FADE_SEC ? ' ais-stale' : ''}`
    return { color: '#a78bfa', glyph: v.virtual ? '◇' : '◆', cls, key: cls + v.virtual, alerts: [] }
  }
  const { alerts, level } = analyzeVessel(v)
  const color = level === 'alert' ? '#f43f5e' : level === 'warn' ? '#f59e0b' : '#22d3ee'
  // 不知道船頭朝哪就畫圓點，不要畫一個指向北方的假三角形
  const glyph = bowDeg(v) === null ? '●' : '▲'
  const cls = `ais-vessel${level === 'alert' ? ' ais-alert' : ''}${v.ageSec > STALE_FADE_SEC ? ' ais-stale' : ''}`
  return { color, glyph, cls, key: `${cls}|${color}|${glyph}`, alerts }
}

function iconOf(look: Look): L.DivIcon {
  const el = document.createElement('div')
  el.className = look.cls
  el.style.color = look.color
  el.textContent = look.glyph
  return L.divIcon({ className: '', html: el, iconSize: [22, 22], iconAnchor: [11, 11] })
}

function applyBow(marker: L.Marker, bow: number | null) {
  const el = marker.getElement()?.firstElementChild as HTMLElement | null | undefined
  if (el) el.style.transform = bow === null ? '' : `rotate(${bow}deg)`
}

function line(parent: HTMLElement, text: string, color?: string): HTMLElement {
  const d = document.createElement('div')
  d.textContent = text
  if (color) d.style.color = color
  parent.appendChild(d)
  return d
}

function popupOf(v: Vessel, look: Look & { alerts: string[] }, onTool: (v: Vessel, t: Tool) => void): HTMLElement {
  const el = document.createElement('div')
  el.style.cssText = 'font-family:ui-monospace,monospace;line-height:1.5'
  const title = line(el, v.name, look.color)
  title.style.fontWeight = '700'
  if (v.kind === 'aton') {
    line(el, `${v.virtual ? '虛擬航標' : '航標'}：${v.type}`)
    line(el, `MMSI ${v.mmsi}`)
  } else {
    line(el, `MMSI ${v.mmsi}`)
    line(el, `船種：${v.type}`)
    const hd = v.heading !== null ? ` · 船艏 ${cogText(v.heading)}°` : ''
    line(el, `航速 ${sogText(v.sog, 1)} kn · 航向 ${cogText(v.cog)}°${hd}`)
    if (v.length || v.beam) line(el, `長 ${v.length ?? '—'} m × 寬 ${v.beam ?? '—'} m`)
    if (v.destination) line(el, `目的地：${v.destination}`)
  }
  line(el, `最後回報：${ageText(v.ageSec)}${v.reckoned ? '（圖上是依航向航速推算的位置）' : ''}`, v.ageSec > STALE_FADE_SEC ? '#f59e0b' : '#94a3b8')
  if (look.alerts.length) line(el, `⚠ ${look.alerts.join('、')}`, look.color)
  if (v.kind === 'ship') {
    const row = document.createElement('div')
    row.style.cssText = 'display:flex;gap:6px;margin-top:6px'
    const btn = (label: string, tool: Tool, c: string) => {
      const b = document.createElement('button')
      b.textContent = label
      b.style.cssText = `flex:1;padding:6px;border-radius:6px;border:1px solid ${c};background:${c}22;color:${c};font-weight:700;font-size:12px;cursor:pointer`
      b.onclick = () => onTool(v, tool)
      return b
    }
    row.appendChild(btn('🎯 攔截', 'intercept', '#22d3ee'))
    row.appendChild(btn('🧭 推算', 'dr', '#38bdf8'))
    el.appendChild(row)
  }
  return el
}

export class VesselMarkers {
  private entries = new Map<string, Entry>()
  private trackLine: L.Polyline | null = null
  private openMmsi: string | null = null

  constructor(
    private group: L.LayerGroup,
    private onTool: (v: Vessel, t: Tool) => void,
    private trackOf: (mmsi: string) => TrackPoint[],
  ) {}

  update(vessels: Vessel[]): void {
    const seen = new Set<string>()
    for (const v of vessels) {
      seen.add(v.mmsi)
      const look = lookOf(v)
      const bow = v.kind === 'aton' ? null : bowDeg(v)
      const e = this.entries.get(v.mmsi)
      if (!e) {
        const marker = L.marker([v.lat, v.lng], { icon: iconOf(look), keyboard: false })
        const entry: Entry = { marker, v, look: look.key, bow }
        // 彈出視窗用函式：打開時才建 DOM，平常一個都不建
        marker.bindPopup(() => popupOf(entry.v, lookOf(entry.v), this.onTool))
        marker.on('popupopen', () => this.showTrack(entry.v.mmsi))
        marker.on('popupclose', () => this.hideTrack(entry.v.mmsi))
        marker.on('add', () => applyBow(marker, entry.bow))
        marker.addTo(this.group)
        this.entries.set(v.mmsi, entry)
        continue
      }
      e.v = v
      const ll = e.marker.getLatLng()
      if (ll.lat !== v.lat || ll.lng !== v.lng) e.marker.setLatLng([v.lat, v.lng])
      if (e.look !== look.key) {
        e.look = look.key
        e.marker.setIcon(iconOf(look))
        e.bow = bow
        applyBow(e.marker, bow)
      } else if (e.bow !== bow) {
        e.bow = bow
        applyBow(e.marker, bow)
      }
      if (this.openMmsi === v.mmsi && e.marker.isPopupOpen()) {
        e.marker.getPopup()?.setContent(popupOf(v, look, this.onTool))
        this.drawTrack(v)
      }
    }
    for (const [mmsi, e] of this.entries) {
      if (seen.has(mmsi)) continue
      if (this.openMmsi === mmsi) this.hideTrack(mmsi)
      this.group.removeLayer(e.marker)
      this.entries.delete(mmsi)
    }
  }

  clear(): void {
    this.hideTrack(this.openMmsi)
    this.group.clearLayers()
    this.entries.clear()
  }

  private showTrack(mmsi: string) {
    this.openMmsi = mmsi
    const e = this.entries.get(mmsi)
    if (e) this.drawTrack(e.v)
  }

  private hideTrack(mmsi: string | null) {
    if (mmsi !== this.openMmsi) return
    this.openMmsi = null
    if (this.trackLine) this.group.removeLayer(this.trackLine)
    this.trackLine = null
  }

  /** 點開的那艘船畫最近航跡（虛線），接到目前位置。 */
  private drawTrack(v: Vessel) {
    const pts = this.trackOf(v.mmsi).map((p) => [p.lat, p.lng] as [number, number])
    if (pts.length === 0) {
      if (this.trackLine) this.group.removeLayer(this.trackLine)
      this.trackLine = null
      return
    }
    pts.push([v.lat, v.lng])
    if (this.trackLine) this.trackLine.setLatLngs(pts)
    else this.trackLine = L.polyline(pts, { color: '#22d3ee', weight: 2, opacity: 0.8, dashArray: '4 4', interactive: false }).addTo(this.group)
  }
}
