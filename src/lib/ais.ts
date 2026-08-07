// ── AIS 船舶識別資料源 ──────────────────────────────────────
//
// 預設：本機「模擬船隻」持續移動，讓你先看效果（免金鑰、開箱即用）。
// 進階：設定 VITE_AISSTREAM_KEY 後，連 aisstream.io 免費 WebSocket 取即時真實船舶。
//
// 介面用 subscribe(callback) 回傳「取消訂閱」函式，方便圖層卸載時徹底停掉
// （關掉 WebSocket / 清 interval），符合本專案的防爆原則。

export interface Vessel {
  mmsi: string
  name: string
  lat: number
  lng: number
  /** 航向（度） */
  cog: number
  /** 航速（節 kn） */
  sog: number
  /** 船種（漁船/貨船/油輪…） */
  type: string
}

import { getConfig, isAisConfigured } from './config'

export { isAisConfigured }

type Listener = (vessels: Vessel[]) => void
type StatusListener = (status: string) => void
/** AISStream 邊界框：[[南緯,西經],[北緯,東經]]。 */
export type BBox = [[number, number], [number, number]]
/** 訂閱控制代把手：停止 + 動態更新訂閱範圍（跟著地圖視野）。 */
export interface AisHandle {
  stop: () => void
  setBox: (box: BBox) => void
}

/** 台灣周邊預設框（初次訂閱用）。 */
const TW_BOX: BBox = [
  [21.0, 118.0],
  [26.5, 124.0],
]

/** 限制訂閱框最大跨度（避免極低縮放訂閱全球被灌爆）；超過就以中心裁切。 */
function capBox(box: BBox, maxSpan = 40): BBox {
  let [[s, w], [nn, e]] = box
  const cLat = (s + nn) / 2
  const cLng = (w + e) / 2
  if (nn - s > maxSpan) { s = cLat - maxSpan / 2; nn = cLat + maxSpan / 2 }
  if (e - w > maxSpan) { w = cLng - maxSpan / 2; e = cLng + maxSpan / 2 }
  return [[s, w], [nn, e]]
}

/** 船是否在框內（含小邊界）。 */
function inBox(v: Vessel, box: BBox): boolean {
  const [[s, w], [nn, e]] = box
  return v.lat >= s - 0.5 && v.lat <= nn + 0.5 && v.lng >= w - 0.5 && v.lng <= e + 0.5
}

/** 台灣周邊模擬船隻。 */
const SIM_FLEET: Vessel[] = [
  { mmsi: '416001001', name: 'HAI HUNG', lat: 24.9, lng: 121.9, cog: 210, sog: 11, type: '貨船' },
  { mmsi: '416002002', name: 'FU YUAN 66', lat: 24.2, lng: 121.6, cog: 340, sog: 6, type: '漁船' },
  { mmsi: '477553000', name: 'COSCO STAR', lat: 25.3, lng: 122.4, cog: 260, sog: 15, type: '貨櫃輪' },
  { mmsi: '416003003', name: 'SHENG LI', lat: 23.8, lng: 121.3, cog: 30, sog: 9, type: '油輪' },
  { mmsi: '416004004', name: '(無船名)', lat: 24.6, lng: 122.2, cog: 150, sog: 4, type: '不明' },
  { mmsi: '416005005', name: 'DA CHANG', lat: 25.0, lng: 121.4, cog: 300, sog: 12, type: '漁船' },
]

const DEG = Math.PI / 180

/**
 * 訂閱 AIS。回傳 { stop, setBox }：setBox 可隨地圖視野更新訂閱範圍，
 * 讓「看到哪裡就訂閱哪裡的船」。onStatus 回報連線狀態給 UI。
 */
export function subscribeAIS(onUpdate: Listener, onStatus?: StatusListener, box: BBox = TW_BOX): AisHandle {
  const key = getConfig().aisKey
  if (key) return subscribeReal(onUpdate, key, onStatus, box)
  return subscribeSim(onUpdate)
}

/** 模擬：每 2 秒依航向/航速推進船位。 */
function subscribeSim(onUpdate: Listener): AisHandle {
  const fleet: Vessel[] = SIM_FLEET.map((v) => ({ ...v }))
  const step = () => {
    for (const v of fleet) {
      // 1 節 ≈ 0.5144 m/s；2 秒位移；換算成經緯度
      const dist = v.sog * 0.5144 * 2
      const dNorth = dist * Math.cos(v.cog * DEG)
      const dEast = dist * Math.sin(v.cog * DEG)
      v.lat += (dNorth / 6371000) / DEG
      v.lng += (dEast / (6371000 * Math.cos(v.lat * DEG))) / DEG
      // 偶爾微調航向，看起來自然些（用 mmsi 尾數當偽隨機，避免用 Math.random）
      v.cog = (v.cog + ((Number(v.mmsi) % 7) - 3) * 0.5 + 360) % 360
    }
    onUpdate(fleet.map((v) => ({ ...v })))
  }
  step()
  const timer = setInterval(step, 2000)
  return { stop: () => clearInterval(timer), setBox: () => {} }
}

/** 真實：連 aisstream.io WebSocket（含狀態回報、斷線自動重連、船名/船種）。 */
function subscribeReal(onUpdate: Listener, key: string, onStatus: StatusListener | undefined, initBox: BBox): AisHandle {
  const byMmsi = new Map<string, Vessel>()
  let ws: WebSocket | null = null
  let closedByUs = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let noDataTimer: ReturnType<typeof setTimeout> | null = null
  let gotAny = false
  let attempt = 0
  let curBox: BBox = capBox(initBox) // 目前訂閱範圍（跟著地圖視野更新）

  const status = (s: string) => onStatus?.(s)
  const subMsg = () =>
    JSON.stringify({
      APIKey: key,
      BoundingBoxes: [curBox],
      FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
    })
  const emit = () => onUpdate([...byMmsi.values()].filter((v) => inBox(v, curBox)))

  const connect = () => {
    status(attempt === 0 ? 'AIS：連線 aisstream.io…' : `AIS：重新連線中（第 ${attempt} 次）…`)
    ws = new WebSocket('wss://stream.aisstream.io/v0/stream')

    ws.onopen = () => {
      attempt = 0
      status('AIS：已連線，訂閱畫面範圍船位，等待回報…（移動地圖即訂閱該區）')
      ws?.send(subMsg())
      // 15 秒內完全沒有任何訊息（連錯誤都沒有）→ 幾乎必為金鑰/連線數問題。
      if (noDataTimer) clearTimeout(noDataTimer)
      noDataTimer = setTimeout(() => {
        if (!gotAny)
          status(
            'AIS：已連線但持續無回應。最可能：①同一金鑰在其它裝置/分頁也開著（免費版限 1 連線，請只留一處）②金鑰打錯/無效 ③額度用盡。到 aisstream.io 核對。',
          )
      }, 15000)
    }

    ws.onmessage = (ev) => {
      // 收到任何訊息（含錯誤）就取消「15 秒無回應」計時，避免通用訊息蓋掉真實原因。
      if (noDataTimer) {
        clearTimeout(noDataTimer)
        noDataTimer = null
      }
      try {
        const msg = JSON.parse(ev.data as string)
        // aisstream 若金鑰無效/超額/訂閱格式錯，會回一段 error 文字——攤開給使用者看。
        if (msg?.error || msg?.Error || msg?.message) {
          status(`AIS：aisstream 回報「${msg.error || msg.Error || msg.message}」（多為金鑰無效或超額）`)
          return
        }
        const type = msg?.MessageType
        const meta = msg?.MetaData
        // 非船位訊息（多為伺服器提示/錯誤）：把原文攤開，最有助於排查。
        if (!meta) {
          if (!gotAny) {
            const raw = (typeof ev.data === 'string' ? ev.data : '').slice(0, 160)
            if (raw) status(`AIS：伺服器回應非船位訊息——${raw}`)
          }
          return
        }
        const mmsi = String(meta.MMSI ?? meta.mmsi ?? '')
        if (!mmsi) return
        const prev = byMmsi.get(mmsi)

        if (type === 'PositionReport') {
          const pr = msg?.Message?.PositionReport
          if (!pr) return
          const lat = pr.Latitude ?? meta.latitude
          const lng = pr.Longitude ?? meta.longitude
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
          byMmsi.set(mmsi, {
            mmsi,
            name: prev?.name || (meta.ShipName || '(無船名)').trim(),
            lat,
            lng,
            cog: pr.Cog ?? prev?.cog ?? 0,
            sog: pr.Sog ?? prev?.sog ?? 0,
            type: prev?.type || '—',
          })
        } else if (type === 'ShipStaticData') {
          const sd = msg?.Message?.ShipStaticData
          if (!sd || !prev) return
          byMmsi.set(mmsi, {
            ...prev,
            name: (sd.Name || meta.ShipName || prev.name).trim(),
            type: shipTypeText(sd.Type) || prev.type,
          })
        } else return

        if (!gotAny) {
          gotAny = true
          if (noDataTimer) clearTimeout(noDataTimer)
        }
        const shown = [...byMmsi.values()].filter((v) => inBox(v, curBox))
        status(`AIS：畫面內即時船位 ${shown.length} 艘（aisstream.io · 移動地圖看其他海域）`)
        onUpdate(shown)
      } catch {
        /* 忽略單筆解析錯誤 */
      }
    }

    ws.onerror = () => {
      status('AIS：連線發生錯誤，將自動重連…')
    }

    ws.onclose = (ev) => {
      if (closedByUs) return
      attempt++
      const delay = Math.min(30000, 2000 * attempt)
      // aisstream 常把「金鑰無效」等原因放在 close reason，攤開顯示以利排查。
      const why = ev?.reason ? `（原因：${ev.reason}）` : ev?.code ? `（code ${ev.code}）` : ''
      status(`AIS：連線中斷${why}，${Math.round(delay / 1000)} 秒後重連…`)
      reconnectTimer = setTimeout(connect, delay)
    }
  }

  connect()

  return {
    stop: () => {
      closedByUs = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (noDataTimer) clearTimeout(noDataTimer)
      try {
        ws?.close()
      } catch {
        /* noop */
      }
    },
    // 更新訂閱範圍（地圖移動時呼叫）：重送訂閱訊息、清掉離開視野的舊船。
    setBox: (box: BBox) => {
      curBox = capBox(box)
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(subMsg())
        } catch {
          /* 送不出去就等下次重連時套用 */
        }
      }
      // 修剪掉離目前視野太遠的船（避免累積成滿圖殘影）。
      for (const [mmsi, v] of byMmsi) if (!inBox(v, curBox)) byMmsi.delete(mmsi)
      emit()
    },
  }
}

/** AIS 船種代碼→中文（簡化）。 */
function shipTypeText(t: unknown): string {
  const n = typeof t === 'number' ? t : parseInt(String(t), 10)
  if (!Number.isFinite(n)) return ''
  if (n >= 30 && n <= 30) return '漁船'
  if (n >= 60 && n <= 69) return '客船'
  if (n >= 70 && n <= 79) return '貨船'
  if (n >= 80 && n <= 89) return '油輪/化學船'
  if (n >= 40 && n <= 49) return '高速船'
  if (n >= 50 && n <= 59) return '特種船'
  return '其他'
}
