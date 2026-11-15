import { useEffect, useRef, useState } from 'react'
import { useTacticalStore } from '../store/tacticalStore'
import {
  altitudeKm,
  heightForZoom,
  nextOrbitEcef,
  periodMin,
  satEcefMeters,
  satrecOf,
  viewRadiusNm,
  zoomForHeight,
  type SatRec,
} from '../lib/globeMath'
import {
  addShot,
  durationText,
  heightText,
  loadShots,
  moveShot,
  persistShots,
  removeShot,
  updateShot,
  type Shot,
} from '../lib/director'
import {
  adsbAnchor,
  aircraftName,
  altText,
  emergencyText,
  fetchAdsb,
  isHelicopter,
  normalizeAircraft,
  ADSB_MAX_DIST_NM,
  type Aircraft,
} from '../lib/adsb'
import { analyzeVessel } from '../lib/aisAnomaly'
import type { Vessel } from '../lib/aisStore'
import { fetchTleGroup } from '../lib/satFleet'
import { parseTle } from '../lib/tle'
import { classifyDevice, readDeviceFacts } from '../lib/device'
import { errText } from '../lib/feedState'
import type { GlobeEngine, PickRef } from './cesiumEngine'

/** 衛星群組（Worker 允許的 celestrak 群組）與顏色。 */
const SAT_GROUPS = [
  { group: 'stations', color: '#f8fafc', text: '太空站' },
  { group: 'resource', color: '#facc15', text: '地球觀測（光學為主）' },
  { group: 'sar', color: '#fb923c', text: '雷達衛星（穿雲、夜間可拍）' },
  { group: 'weather', color: '#38bdf8', text: '氣象衛星' },
] as const
/** 只幫跟這個 App 有關的幾顆標名字，不然整顆地球都是字。 */
const LABELLED = /^(ISS|SENTINEL|LANDSAT|NOAA 2|ICEYE|CAPELLA|UMBRA|RCM|NISAR|CSS|TIANHE)/

const AIRCRAFT_EVERY_MS = 15_000
const FLY_CHOICES = [2, 4, 6, 8, 10, 15]
const HOLD_CHOICES = [0, 2, 3, 5, 10, 20]

interface SatItem {
  id: string
  name: string
  group: (typeof SAT_GROUPS)[number]
  rec: SatRec
}

/** 選中的東西給人看的幾行字。 */
type Detail = { title: string; color: string; lines: string[] }

function shipColor(v: Vessel): string {
  if (v.kind === 'aton') return '#a78bfa'
  const level = analyzeVessel(v).level
  return level === 'alert' ? '#f43f5e' : level === 'warn' ? '#f59e0b' : '#22d3ee'
}

function planeColor(a: Aircraft): string {
  return emergencyText(a) ? '#f43f5e' : a.military ? '#f59e0b' : isHelicopter(a) ? '#4ade80' : '#f8fafc'
}

const sleep = (ms: number, token: { stop: boolean }) =>
  new Promise<void>((resolve) => {
    const end = Date.now() + ms
    const tick = () => (token.stop || Date.now() >= end ? resolve() : setTimeout(tick, 100))
    tick()
  })

/**
 * 3D 地球：船（AIS）、飛機（adsb.lol，畫在真實高度）、衛星（畫在軌道高度）＋導演鏡頭。
 * 整個元件是延遲載入的；Cesium 本體又再延遲一層（cesiumEngine.ts），先顯示「載入中」。
 */
export default function GlobeView() {
  const setOpenTool = useTacticalStore((s) => s.setOpenTool)
  const setFlyTo = useTacticalStore((s) => s.setFlyTo)
  const vessels = useTacticalStore((s) => s.vessels)
  const aisLive = useTacticalStore((s) => s.mode === 'ais')
  const boxRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<GlobeEngine | null>(null)
  const [ready, setReady] = useState(false)
  const [status, setStatus] = useState('載入 3D 地球（第一次約 2–3 MB，比較久）…')
  const [fatal, setFatal] = useState<string | null>(null)
  const [layers, setLayers] = useState({
    ships: true,
    planes: true,
    sats: true,
  })
  const [planeInfo, setPlaneInfo] = useState('')
  const [satInfo, setSatInfo] = useState('')
  const [detail, setDetail] = useState<Detail | null>(null)
  const [shots, setShots] = useState<Shot[]>(() => loadShots())
  const [saveNote, setSaveNote] = useState('')
  const [director, setDirector] = useState(false)
  const [loop, setLoop] = useState(false)
  const [playing, setPlaying] = useState<string | null>(null)
  const planesRef = useRef<Aircraft[]>([])
  const satsRef = useRef<SatItem[]>([])
  const playToken = useRef<{ stop: boolean } | null>(null)
  const pickRef = useRef<(ref: PickRef | null) => void>(() => {})

  // ── 建立 3D 地球 ──
  useEffect(() => {
    let alive = true
    const box = boxRef.current
    if (!box) return // Cesium 的背景工作程式、圖示放在 /cesium/（build 時從套件複製過去）；要在載入 Cesium 前告訴它
    ;(window as Window & { CESIUM_BASE_URL?: string }).CESIUM_BASE_URL = import.meta.env.DEV
      ? '/node_modules/cesium/Build/Cesium/'
      : '/cesium/'
    const light = classifyDevice(readDeviceFacts()).kind !== 'desktop'
    const mv = useTacticalStore.getState().mapView
    import('./cesiumEngine')
      .then(({ GlobeEngine }) => {
        if (!alive) return
        try {
          engineRef.current = new GlobeEngine({
            container: box,
            start: {
              lon: mv.lng,
              lat: mv.lat,
              height: heightForZoom(mv.zoom, mv.lat, box.clientHeight || 800),
            },
            light,
            onPick: (ref) => pickRef.current(ref),
            onError: (m) => setFatal(m),
          })
          engineRef.current.addCredit('飛機 © adsb.lol 貢獻者（ODbL）')
          setReady(true)
          setStatus('')
        } catch {
          setFatal('3D 繪圖開不起來（這個瀏覽器或顯示晶片不支援 WebGL 2）。請改用電腦上新版的 Chrome、Edge 或 Safari。')
        }
      })
      .catch(() => {
        if (alive) setFatal('3D 地球的程式下載失敗（網路不穩或斷線）。關掉再開一次試試；海上訊號差時建議回港再用。')
      })
    return () => {
      alive = false
      playToken.current && (playToken.current.stop = true)
      engineRef.current?.destroy()
      engineRef.current = null
    }
  }, [])

  // ── 船：跟 2D 同一批（AIS 模式收到的）──
  useEffect(() => {
    const eng = engineRef.current
    if (!eng || !ready) return
    eng.setShips(
      vessels.map((v) => ({
        id: v.mmsi,
        lon: v.lng,
        lat: v.lat,
        alt: 5,
        color: shipColor(v),
        size: v.kind === 'aton' ? 5 : 7,
      })),
    )
  }, [vessels, ready])

  // ── 飛機：看哪裡就抓哪裡，15 秒一次 ──
  useEffect(() => {
    const eng = engineRef.current
    if (!eng || !ready || !layers.planes) return
    let stopped = false
    let timer: number | undefined
    const poll = async () => {
      if (stopped) return
      const c = engineRef.current?.centerOnGround()
      const a = c ? adsbAnchor(c.lat, c.lon, Math.max(25, Math.min(ADSB_MAX_DIST_NM, viewRadiusNm(c.height)))) : null
      if (!a) {
        setPlaneInfo('鏡頭朝著太空，沒有抓飛機')
      } else if (!document.hidden) {
        try {
          const snap = await fetchAdsb(a)
          if (stopped) return
          const list = normalizeAircraft({ ac: snap.ac }) ?? []
          planesRef.current = list
          engineRef.current?.setPlanes(
            list.map((p) => ({
              id: p.hex,
              lon: p.lng,
              lat: p.lat,
              alt: p.onGround ? 0 : (p.altFt ?? 0) * 0.3048,
              color: planeColor(p),
              size: 8,
            })),
          )
          const em = list.filter((p) => emergencyText(p)).length
          setPlaneInfo(`${list.length} 架${em ? `（${em} 架發緊急）` : ''}${snap.stale ? '；adsb.lol 暫時抓不到，是舊資料' : ''}`)
        } catch (e) {
          if (!stopped) setPlaneInfo(errText(e, '飛機資料抓不到，稍後自動再試'))
        }
      }
      if (!stopped) timer = window.setTimeout(() => void poll(), AIRCRAFT_EVERY_MS)
    }
    void poll()
    return () => {
      stopped = true
      window.clearTimeout(timer)
    }
  }, [ready, layers.planes])

  // ── 衛星：抓四組根數，每秒更新位置 ──
  useEffect(() => {
    if (!ready || !layers.sats) return
    let stopped = false
    let timer: number | undefined
    setSatInfo('抓衛星軌道根數…')
    Promise.allSettled(SAT_GROUPS.map((g) => fetchTleGroup(g.group))).then((res) => {
      if (stopped) return
      const items: SatItem[] = []
      const seen = new Set<string>()
      const problems: string[] = []
      res.forEach((r, i) => {
        const g = SAT_GROUPS[i]
        if (r.status === 'rejected') {
          problems.push(`${g.text}：${errText(r.reason, '抓不到')}`)
          return
        }
        if (r.value.stale) problems.push(r.value.stale)
        for (const t of parseTle(r.value.text)) {
          if (seen.has(t.noradId)) continue
          const rec = satrecOf(t.line1, t.line2)
          if (!rec) continue
          seen.add(t.noradId)
          items.push({ id: t.noradId, name: t.name, group: g, rec })
        }
      })
      satsRef.current = items
      const update = () => {
        const now = new Date()
        const pts = []
        for (const s of satsRef.current) {
          const pos = satEcefMeters(s.rec, now)
          if (pos)
            pts.push({
              id: s.id,
              pos,
              color: s.group.color,
              label: LABELLED.test(s.name) ? s.name : undefined,
            })
        }
        engineRef.current?.setSats(pts)
      }
      update()
      timer = window.setInterval(update, 1000)
      setSatInfo(
        items.length === 0
          ? `衛星都抓不到：${problems.join('；') || '沒有資料'}`
          : `${items.length} 顆${problems.length ? `（${problems.join('；')}）` : ''}`,
      )
    })
    return () => {
      stopped = true
      window.clearInterval(timer)
      engineRef.current?.setSats([])
      engineRef.current?.setOrbit([], '#fff')
    }
  }, [ready, layers.sats])

  // ── 圖層開關 ──
  useEffect(() => {
    const eng = engineRef.current
    if (!eng || !ready) return
    eng.showShips(layers.ships)
    eng.showPlanes(layers.planes)
    eng.showSats(layers.sats)
  }, [layers, ready])

  // ── 點地球上的東西：顯示資料；衛星另外畫接下來一圈 ──
  pickRef.current = (ref) => {
    const eng = engineRef.current
    eng?.setOrbit([], '#fff')
    if (!ref) return setDetail(null)
    if (ref.kind === 'ship') {
      const v = useTacticalStore.getState().vessels.find((x) => x.mmsi === ref.id)
      if (!v) return setDetail(null)
      return setDetail({
        title: `🚢 ${v.name}`,
        color: shipColor(v),
        lines: [`MMSI ${v.mmsi} · ${v.type}`, `航速 ${v.sog ?? '—'} kn · 航向 ${v.cog === null ? '—' : Math.round(v.cog) + '°'}`],
      })
    }
    if (ref.kind === 'plane') {
      const p = planesRef.current.find((x) => x.hex === ref.id)
      if (!p) return setDetail(null)
      const em = emergencyText(p)
      return setDetail({
        title: `✈ ${aircraftName(p)}`,
        color: planeColor(p),
        lines: [
          ...(em ? [`🆘 ${em}`] : []),
          [`ICAO ${p.hex.toUpperCase()}`, p.reg, p.typeCode].filter(Boolean).join(' · '),
          `高度 ${altText(p)} · 地速 ${p.gsKn === null ? '—' : Math.round(p.gsKn) + ' kn'}`,
          ...(p.military ? ['軍機（adsb.lol 資料庫標記）'] : []),
          '資料：adsb.lol 貢獻者（ODbL）',
        ],
      })
    }
    const s = satsRef.current.find((x) => x.id === ref.id)
    if (!s) return setDetail(null)
    const pos = satEcefMeters(s.rec, new Date())
    eng?.setOrbit(nextOrbitEcef(s.rec, Date.now()), s.group.color)
    setDetail({
      title: `🛰️ ${s.name}`,
      color: s.group.color,
      lines: [
        `${s.group.text} · NORAD ${s.id}`,
        `高度約 ${pos ? Math.round(altitudeKm(pos)).toLocaleString('en-US') : '—'} 公里 · 一圈 ${Math.round(periodMin(s.rec))} 分鐘`,
        '線＝接下來一圈會經過的上空（相對地球）',
      ],
    })
  }

  // ── 導演鏡頭 ──
  const saveShots = (next: Shot[]) => {
    setShots(next)
    setSaveNote(persistShots(next) ? '' : '⚠ 沒存到（無痕模式或空間不足），關掉就會不見')
  }
  const stopPlay = () => {
    if (playToken.current) playToken.current.stop = true
    playToken.current = null
    engineRef.current?.cancelFlight()
    setPlaying(null)
  }
  const play = async (from: number) => {
    const eng = engineRef.current
    if (!eng || shots.length === 0) return
    stopPlay()
    const token = { stop: false }
    playToken.current = token
    try {
      let start = from
      do {
        for (let i = start; i < shots.length && !token.stop; i++) {
          setPlaying(shots[i].id)
          await eng.flyTo(shots[i], shots[i].flySec)
          await sleep(shots[i].holdSec * 1000, token)
        }
        start = 0
      } while (loop && !token.stop)
    } catch {
      // 被打斷（使用者拖了畫面或按停止）：停下來就好
    } finally {
      if (playToken.current === token) {
        playToken.current = null
        setPlaying(null)
      }
    }
  }

  const close = () => {
    stopPlay()
    // 回 2D 時停在 3D 最後看的那片海
    const c = engineRef.current?.centerOnGround()
    if (c)
      setFlyTo({
        lat: c.lat,
        lng: c.lon,
        zoom: Math.round(zoomForHeight(c.height, c.lat, window.innerHeight)),
      })
    setOpenTool(null)
  }

  const chip = (key: keyof typeof layers, label: string, info: string) => (
    <button
      onClick={() => setLayers((l) => ({ ...l, [key]: !l[key] }))}
      aria-pressed={layers[key]}
      className={`min-h-[36px] rounded-full border px-3 text-xs font-semibold ${layers[key] ? 'border-tactical-cyan/70 bg-tactical-cyan/15 text-tactical-cyan' : 'border-slate-600 bg-slate-900/80 text-slate-400'}`}
      title={info}
    >
      {label}
    </button>
  )

  return (
    <div className="pointer-events-auto fixed inset-0 z-[3000] bg-black text-slate-100">
      <div ref={boxRef} className="absolute inset-0" />

      {/* 上方：標題、圖層、導演、回 2D，下面接狀態列。
          放在同一欄：手機上按鈕會折成兩行，狀態列要跟著往下排，不能疊在按鈕上把按鈕擋住。 */}
      <div className="safe-top pointer-events-none absolute inset-x-0 top-0 flex flex-col gap-1.5 bg-gradient-to-b from-black/80 to-transparent px-3 pb-6 pt-2">
        <div className="pointer-events-auto flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-sm font-bold text-tactical-cyan">🌐 3D 地球</span>
          {chip('ships', `🚢 船 ${vessels.length}`, '跟 2D 同一批船（先開 AIS 模式）')}
          {chip('planes', '✈️ 飛機', planeInfo)}
          {chip('sats', '🛰️ 衛星', satInfo)}
          <button
            onClick={() => setDirector((d) => !d)}
            aria-pressed={director}
            className={`min-h-[36px] rounded-full border px-3 text-xs font-semibold ${director ? 'border-amber-400/70 bg-amber-400/15 text-amber-300' : 'border-slate-600 bg-slate-900/80 text-slate-300'}`}
          >
            🎬 導演鏡頭
          </button>
          <button
            onClick={close}
            className="ml-auto min-h-[36px] rounded-full border border-slate-500 bg-slate-900/90 px-3 text-xs font-bold text-slate-100"
          >
            ✕ 回 2D
          </button>
        </div>

        {/* 狀態列：載入中、各圖層的資料狀況（只是說明，點擊穿透，不擋地球） */}
        <div className="max-w-[26rem] space-y-0.5 text-[0.6875rem] leading-snug">
          {status && <div className="rounded bg-black/70 px-2 py-1 text-slate-200">⏳ {status}</div>}
          {ready && layers.ships && vessels.length === 0 && (
            <div className="rounded bg-black/70 px-2 py-1 text-slate-300">
              🚢 還沒有船：在 2D 開「AIS 船位」，再按面板上的「🌐 3D」
            </div>
          )}
          {ready && layers.ships && vessels.length > 0 && !aisLive && (
            <div className="rounded bg-black/70 px-2 py-1 text-amber-300">
              🚢 AIS 沒在跑：船位停在關掉 AIS 那時。要即時船位，從 AIS 面板按「🌐 3D」
            </div>
          )}
          {ready && layers.planes && planeInfo && (
            <div className="rounded bg-black/70 px-2 py-1 text-slate-300">✈️ {planeInfo}</div>
          )}
          {ready && layers.sats && satInfo && <div className="rounded bg-black/70 px-2 py-1 text-slate-300">🛰️ {satInfo}</div>}
        </div>
      </div>

      {fatal && (
        <div className="absolute inset-x-4 top-1/3 mx-auto max-w-md rounded-xl border border-rose-500/60 bg-slate-900/95 p-4 text-sm leading-relaxed text-rose-200">
          {fatal}
          <button onClick={close} className="mt-3 block w-full rounded-lg border border-slate-500 py-2 text-slate-100">
            回 2D 地圖
          </button>
        </div>
      )}

      {/* 點到的東西 */}
      {detail && (
        <div className="absolute bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] left-3 max-w-[min(22rem,calc(100%-1.5rem))] rounded-xl border border-slate-600 bg-slate-900/95 p-3 font-mono text-xs leading-relaxed">
          <div className="mb-0.5 flex items-start justify-between gap-2">
            <span className="font-bold" style={{ color: detail.color }}>
              {detail.title}
            </span>
            <button onClick={() => pickRef.current(null)} className="text-slate-400" aria-label="關閉">
              ✕
            </button>
          </div>
          {detail.lines.map((l) => (
            <div key={l}>{l}</div>
          ))}
        </div>
      )}

      {/* 導演鏡頭：電腦在右側一欄，手機在下方 */}
      {director && (
        <div className="absolute inset-x-0 bottom-0 max-h-[48vh] overflow-y-auto rounded-t-2xl border-t border-slate-700 bg-slate-950/95 p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] md:inset-x-auto md:bottom-3 md:right-3 md:top-[calc(env(safe-area-inset-top)+3.5rem)] md:max-h-none md:w-80 md:rounded-2xl md:border">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {playing ? (
              <button onClick={stopPlay} className="min-h-[36px] rounded-lg bg-rose-500/90 px-3 text-xs font-bold text-white">
                ⏹ 停止
              </button>
            ) : (
              <button
                onClick={() => void play(0)}
                disabled={!ready || shots.length === 0}
                className="min-h-[36px] rounded-lg bg-amber-400 px-3 text-xs font-bold text-slate-900 disabled:opacity-40"
              >
                ▶ 從頭播放（{durationText(shots)}）
              </button>
            )}
            <label className="flex min-h-[36px] items-center gap-1 text-xs text-slate-300">
              <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
              循環
            </label>
            <button
              onClick={() =>
                engineRef.current && saveShots(addShot(shots, engineRef.current.getView(), `s${Date.now().toString(36)}`))
              }
              disabled={!ready}
              className="ml-auto min-h-[36px] rounded-lg border border-tactical-cyan/60 px-3 text-xs font-semibold text-tactical-cyan disabled:opacity-40"
            >
              ＋ 記下目前畫面
            </button>
          </div>
          {saveNote && <p className="mb-1 text-[0.6875rem] text-amber-300">{saveNote}</p>}
          {shots.length === 0 && <p className="text-xs text-slate-400">還沒有鏡頭：轉到想要的角度，按「＋ 記下目前畫面」。</p>}
          <ol className="space-y-1.5">
            {shots.map((s, i) => (
              <li
                key={s.id}
                className={`rounded-lg border p-2 ${playing === s.id ? 'border-amber-400/80 bg-amber-400/10' : 'border-slate-700 bg-slate-900/70'}`}
              >
                <div className="flex items-center gap-1">
                  <span className="w-5 text-center text-xs text-slate-400">{i + 1}</span>
                  <input
                    value={s.name}
                    onChange={(e) => saveShots(updateShot(shots, s.id, { name: e.target.value }))}
                    aria-label={`第 ${i + 1} 個鏡頭的名字`}
                    className="min-w-0 flex-1 rounded bg-slate-800 px-1.5 py-1 text-xs text-slate-100"
                  />
                  <button
                    onClick={() => void play(i)}
                    disabled={!ready}
                    className="min-h-[32px] min-w-[32px] text-sm"
                    aria-label="從這個鏡頭開始播"
                  >
                    ▶
                  </button>
                  <button
                    onClick={() => saveShots(moveShot(shots, s.id, -1))}
                    className="min-h-[32px] min-w-[28px] text-sm text-slate-300"
                    aria-label="往前"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => saveShots(moveShot(shots, s.id, 1))}
                    className="min-h-[32px] min-w-[28px] text-sm text-slate-300"
                    aria-label="往後"
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => saveShots(removeShot(shots, s.id))}
                    className="min-h-[32px] min-w-[28px] text-sm text-rose-300"
                    aria-label="刪除"
                  >
                    ✕
                  </button>
                </div>
                <div className="mt-1 flex items-center gap-2 pl-6 text-[0.6875rem] text-slate-400">
                  <span>{heightText(s.height)}</span>
                  <label className="flex items-center gap-1">
                    飛
                    <select
                      value={s.flySec}
                      onChange={(e) =>
                        saveShots(
                          updateShot(shots, s.id, {
                            flySec: Number(e.target.value),
                          }),
                        )
                      }
                      className="rounded bg-slate-800 px-1 text-slate-200"
                    >
                      {[...new Set([...FLY_CHOICES, s.flySec])]
                        .sort((a, b) => a - b)
                        .map((n) => (
                          <option key={n} value={n}>
                            {n} 秒
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-1">
                    停
                    <select
                      value={s.holdSec}
                      onChange={(e) =>
                        saveShots(
                          updateShot(shots, s.id, {
                            holdSec: Number(e.target.value),
                          }),
                        )
                      }
                      className="rounded bg-slate-800 px-1 text-slate-200"
                    >
                      {[...new Set([...HOLD_CHOICES, s.holdSec])]
                        .sort((a, b) => a - b)
                        .map((n) => (
                          <option key={n} value={n}>
                            {n} 秒
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-[0.625rem] leading-relaxed text-slate-500">
            鏡頭存在這台裝置，不會上傳。播放中拖動畫面會停止。
          </p>
        </div>
      )}
    </div>
  )
}
