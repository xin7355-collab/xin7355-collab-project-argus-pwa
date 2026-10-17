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
import { backoffMs, evaluateWatchdog, initialWatchdogState, isAuthFailure, type AisHealth } from './aisWatchdog'
import {
  chooseRoute,
  diagnose,
  KEY_TEST_BOX,
  ROUTE_NAME,
  runKeyTest,
  type AisRoute,
  type ConnAttempt,
  type Diagnosis,
  type ProbeSocket,
} from './aisRoute'

export { isAisConfigured }

type Listener = (vessels: Vessel[]) => void
type StatusListener = (status: string) => void
/**
 * 回報「這份 AIS 資料現在可不可以信」。
 * usable=false 時，需要可信 AIS 的功能（例如亮點掃描的「無AIS=可疑」）
 * 必須改回報「比不了」，不可以拿過期船位硬比——那會兩個方向都判錯。
 */
type FreshListener = (usable: boolean, ageMs: number | null) => void
/** 每條連線結束時回報：診斷結論 + 最近幾次連線紀錄（面板顯示用）。 */
type DiagListener = (diag: Diagnosis, history: ConnAttempt[]) => void
/** AISStream 邊界框：[[南緯,西經],[北緯,東經]]。 */
export type BBox = [[number, number], [number, number]]
/** 訂閱控制代把手：停止 + 動態更新訂閱範圍（跟著地圖視野）。 */
export interface AisHandle {
  stop: () => void
  setBox: (box: BBox) => void
  /** 借英吉利海峽收 15 秒，分出「金鑰壞」還是「這片海沒資料」。回傳給人看的結論。 */
  testKey: () => Promise<string>
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
export function subscribeAIS(
  onUpdate: Listener,
  onStatus?: StatusListener,
  box: BBox = TW_BOX,
  onFresh?: FreshListener,
  onDiag?: DiagListener,
): AisHandle {
  const key = getConfig().aisKey
  if (key) return subscribeReal(onUpdate, key, onStatus, box, onFresh, onDiag)
  // 模擬資料永遠是「現做的」，但它不是真的——標成不可信任，
  // 免得沒金鑰時掃描拿假船位去判斷真目標。
  onFresh?.(false, null)
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
  return {
    stop: () => clearInterval(timer),
    setBox: () => {},
    testKey: async () => '目前是模擬船隻，沒有金鑰可測。先到 ⚙️ 設定填 AISStream 金鑰。',
  }
}

/**
 * 兩條路：
 * - relay：經自家 Worker 轉接（/api/ais，見 worker/index.js）。aisstream 官方不支援瀏覽器直連、
 *   建議走伺服器端，所以優先。
 * - direct：直連 aisstream。轉接被擋（例如對方擋 Cloudflare 的 IP）時的備援。
 */
function routeUrl(route: AisRoute): string {
  if (route === 'direct') return 'wss://stream.aisstream.io/v0/stream'
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/ais`
}

/** 診斷只看最近幾次：太舊的紀錄（例如換金鑰前的）會讓結論失準。 */
const HISTORY_MAX = 6

/** 真實：連 aisstream.io WebSocket（含狀態回報、斷線自動重連、換路、診斷、船名/船種）。 */
function subscribeReal(
  onUpdate: Listener,
  key: string,
  onStatus: StatusListener | undefined,
  initBox: BBox,
  onFresh?: FreshListener,
  onDiag?: DiagListener,
): AisHandle {
  const byMmsi = new Map<string, Vessel>()
  let ws: WebSocket | null = null
  let closedByUs = false
  let testing = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let noDataTimer: ReturnType<typeof setTimeout> | null = null
  let gotAny = false
  let attempt = 0
  // 每條連線的紀錄：用來選路線、也用來告訴使用者到底卡在哪（見 aisRoute.ts）
  let history: ConnAttempt[] = []
  let startRoute: AisRoute = 'relay'
  let route: AisRoute = 'relay'
  let msgsThisConn = 0
  let openedAt: number | null = null
  let badKey = false
  // 看門狗：存活看「有沒有資料」，不看 socket 狀態。詳見 aisWatchdog.ts。
  const wd = initialWatchdogState()
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let lastHealth: AisHealth | null = null
  const mono = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
  let curBox: BBox = capBox(initBox) // 目前訂閱範圍（跟著地圖視野更新）

  const status = (s: string) => onStatus?.(s)
  const subMsg = (box: BBox = curBox) =>
    JSON.stringify({
      APIKey: key,
      BoundingBoxes: [box],
      FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
    })
  const emit = () => onUpdate([...byMmsi.values()].filter((v) => inBox(v, curBox)))

  /** 一條連線結束：記下來、重新診斷。回傳診斷結論。 */
  const record = (code: number, reason: string): Diagnosis => {
    history = [
      ...history,
      {
        route,
        opened: openedAt !== null,
        aliveMs: openedAt === null ? null : Math.round(mono() - openedAt),
        msgs: msgsThisConn,
        code,
        reason,
      },
    ].slice(-HISTORY_MAX)
    const d = diagnose(history)
    onDiag?.(d, history)
    return d
  }

  /** 把舊連線拔乾淨再關：不拔的話它晚到的 onclose 會再排一次重連，變成同時兩條、互相擠掉。 */
  const detach = () => {
    if (!ws) return
    ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null
    try {
      ws.close()
    } catch {
      /* 已經壞掉就算了 */
    }
    ws = null
  }

  const connect = () => {
    if (closedByUs || testing) return
    route = chooseRoute(history, startRoute)
    // 已判定金鑰有問題時不要用「重新連線中」蓋掉那句說明
    if (!badKey) {
      status(
        attempt === 0
          ? `AIS：連線 aisstream.io（${ROUTE_NAME[route]}）…`
          : `AIS：重新連線中（第 ${attempt} 次，${ROUTE_NAME[route]}）…`,
      )
    }
    msgsThisConn = 0
    openedAt = null
    ws = new WebSocket(routeUrl(route))

    ws.onopen = () => {
      // 刻意不在這裡把 attempt 歸零：握手成功不代表這條連線會送資料。
      // 反覆「握手成功→沉默→斷線」的情況如果在這裡歸零，退避就永遠不會長大，
      // 變成持續猛敲。改成收到第一筆真資料才歸零。
      wd.connectedAt = mono()
      wd.lastDataAt = null
      openedAt = mono()
      status('AIS：已連線，訂閱畫面範圍船位，等待回報…（移動地圖即訂閱該區）')
      ws?.send(subMsg())
      // 15 秒內完全沒有任何訊息（連錯誤都沒有）→ 金鑰/連線數問題，或這片海沒接收站。
      if (noDataTimer) clearTimeout(noDataTimer)
      noDataTimer = setTimeout(() => {
        // 這條連線還沒斷，但已經可以下結論（多半是「這片海沒資料」）——不等它斷才更新面板，
        // 它可能永遠不會斷。
        if (msgsThisConn === 0 && openedAt !== null)
          onDiag?.(
            diagnose([...history, { route, opened: true, aliveMs: mono() - openedAt, msgs: 0, code: 0, reason: '仍連線中' }]),
            history,
          )
        if (!gotAny)
          status(
            'AIS：已連線但還沒有船位。可能是這片海附近沒有 aisstream 接收站，或金鑰有問題——' +
              '到 AIS 面板按「測試金鑰」就能分出來。',
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
          const text = String(msg.error || msg.Error || msg.message)
          // 金鑰被拒就不要再走退避重試——重試再多次也沒用，只是吃掉連線數、
          // 還會讓後來的通用錯誤蓋掉真正的原因。
          if (isAuthFailure(text)) {
            wd.authBlocked = true
            status(`AIS：aisstream 拒絕這把金鑰（「${text}」）。到 ⚙️ 設定換一把再試。`)
          } else {
            status(`AIS：aisstream 回報「${text}」（多為超額或訂閱範圍太大）`)
          }
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
        // 這裡才是「真的有資料」。看門狗與退避都以這個時間為準，
        // 不以握手成功為準——握手成功後長期沉默正是要抓的那種故障。
        wd.lastDataAt = mono()
        wd.authBlocked = false
        badKey = false
        attempt = 0
        // 第一筆資料就告訴面板「通了」，不用等這條連線結束才更新診斷。
        if (msgsThisConn++ === 0) onDiag?.({ verdict: 'ok', text: `連線正常（${ROUTE_NAME[route]}）。` }, history)
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
      ws = null
      wd.connectedAt = null
      if (noDataTimer) clearTimeout(noDataTimer)
      attempt++
      if (ev?.reason && isAuthFailure(String(ev.reason))) wd.authBlocked = true
      const d = record(ev?.code ?? 0, ev?.reason ?? '')
      badKey = d.verdict === 'badKey'
      if (badKey && !wd.authBlocked) {
        // aisstream 對無效金鑰是「連上一秒就切斷、不給任何原因」（實測），
        // 不在這裡講清楚，使用者只會看到無止盡的「重新連線中」。
        status(`AIS：${d.text}`)
        reconnectTimer = setTimeout(connect, 60_000)
        return
      }
      const next = chooseRoute(history, startRoute)
      // 金鑰被拒時用很慢的節奏探測，不要走正常退避梯子猛敲。
      // 換路線時不用退避：是另一條路，不是對同一個地方猛敲；越快試完越快知道是金鑰還是路線。
      const delay = wd.authBlocked ? 3_600_000 : next !== route ? 2_000 : backoffMs(attempt - 1)
      // aisstream 常把「金鑰無效」等原因放在 close reason，攤開顯示以利排查。
      const why = ev?.reason ? `（原因：${ev.reason}）` : ev?.code ? `（code ${ev.code}）` : ''
      const switching = next !== route ? `，改走${ROUTE_NAME[next]}` : ''
      status(
        wd.authBlocked
          ? `AIS：金鑰被拒${why}。換金鑰前重連沒有意義，已改為低頻探測。`
          : d.verdict === 'silent' || d.verdict === 'unreachable'
            ? `AIS：${d.text}`
            : `AIS：連線中斷${why}，${Math.round(delay / 1000)} 秒後重連${switching}…`,
      )
      reconnectTimer = setTimeout(connect, delay)
    }
  }

  connect()

  // 心跳：socket 不會自己告訴你它死了，只能定期檢查「上次收到資料多久了」。
  // 20 秒一次夠即時，又不至於在手機上一直喚醒。
  heartbeat = setInterval(() => {
    if (testing) return
    const v = evaluateWatchdog(wd, mono())
    onFresh?.(v.usable, v.ageMs)
    // 只在狀態「改變」時出聲，不要每 20 秒跳一次提示。
    if (v.health !== lastHealth) {
      lastHealth = v.health
      if (v.message) status(v.message)
    }
    if (v.health === 'recycle' && !closedByUs) {
      // 這條連線已經死了但不自知。主動砍掉——不能等 onclose，它不會來。
      wd.connectedAt = null
      wd.lastDataAt = null
      lastHealth = null
      detach()
      record(0, '太久沒資料，主動重連')
      attempt++
      if (reconnectTimer) clearTimeout(reconnectTimer)
      reconnectTimer = setTimeout(connect, 1000)
    }
  }, 20_000)

  return {
    stop: () => {
      closedByUs = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (noDataTimer) clearTimeout(noDataTimer)
      if (heartbeat) clearInterval(heartbeat)
      detach()
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
    testKey: async () => {
      if (testing) return '測試進行中…'
      // 先停掉正式連線：免費金鑰同時開兩條可能互相擠掉，測出來會不準。
      testing = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (noDataTimer) clearTimeout(noDataTimer)
      detach()
      wd.connectedAt = null
      status('AIS：測試金鑰中——借英吉利海峽收 15 秒…')
      try {
        const { result, text } = await runKeyTest(
          (r) => new WebSocket(routeUrl(r)) as unknown as ProbeSocket,
          subMsg(KEY_TEST_BOX),
        )
        if (result.msgs > 0) {
          // 測出哪條路通就從那條重來；舊紀錄是換路前的，留著會誤導診斷。
          startRoute = result.route
          history = []
          badKey = false
          wd.authBlocked = false
        }
        return `${text}（${ROUTE_NAME[result.route]}）`
      } finally {
        testing = false
        attempt = 0
        if (!closedByUs) connect()
      }
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
