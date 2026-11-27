import { useEffect, useMemo, useState } from 'react'
import { useTacticalStore } from '../store/tacticalStore'
import { droneStore, DroneDataError, sourceText } from '../lib/droneClient'
import {
  CAA_GIS,
  CAA_PORTAL,
  checkPoint,
  ftToM,
  LEVEL_TEXT,
  periodText,
  twDate,
  verdictText,
  zoneDesc,
  zoneTag,
  type DroneZone,
  type PointCheck,
  type ZoneLevel,
} from '../lib/droneZones'
import {
  assessHour,
  COND_DOT,
  daylightWindow,
  fetchDroneWeather,
  fetchKp,
  kpLevel,
  kpSummary,
  loadWindLimit,
  lowTraffic,
  persistWindLimit,
  trafficLevel,
  TRAFFIC_MAX_ALT_FT,
  TRAFFIC_RADIUS_NM,
  WIND_LIMITS,
  type DroneHour,
  type KpPoint,
  type LowTraffic,
  type WindLimit,
} from '../lib/droneConditions'
import { adsbAnchor, aircraftName, emergencyText, fetchAdsb, isHelicopter, normalizeAircraft } from '../lib/adsb'
import { getSunTimes } from '../lib/astro'
import { errText } from '../lib/feedState'
import { formatDist } from '../lib/units'

type Load<T> = { state: 'loading' } | { state: 'ok'; data: T } | { state: 'error'; msg: string } | { state: 'not_ready'; msg: string }

const VERDICT_LOOK: Record<ZoneLevel | 'clear', { dot: string; cls: string }> = {
  no: { dot: '🔴', cls: 'border-rose-500/60 bg-rose-500/10 text-rose-200' },
  limit: { dot: '🟡', cls: 'border-amber-400/60 bg-amber-400/10 text-amber-100' },
  notice: { dot: '🟢', cls: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-100' },
  clear: { dot: '🟢', cls: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-100' },
}
const ZONE_DOT: Record<ZoneLevel, string> = { no: '🔴', limit: '🟡', notice: '🟢' }

/** Kp 每 30 分鐘才重抓（NOAA 每 3 小時一格，抓太勤沒意義）。 */
let kpCache: { at: number; pts: KpPoint[] } | null = null

const metersText = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} 公尺` : `${(m / 1000).toFixed(1)} 公里`)
const hourText = (ms: number) => {
  const t = new Date(ms + 8 * 3600_000)
  return `${String(t.getUTCHours()).padStart(2, '0')}時`
}

function ZoneItem({ z, dist }: { z: DroneZone; dist?: string }) {
  const desc = zoneDesc(z)
  return (
    <li className="rounded border border-slate-700/70 bg-slate-900/40 p-2">
      <div className="text-[0.75rem] font-semibold text-slate-100">
        {ZONE_DOT[z.level]} {z.name}
        {dist && <span className="ml-1 font-normal text-slate-400">・{dist}</span>}
      </div>
      <div className="text-[0.625rem] text-slate-400">
        {zoneTag(z)}・{LEVEL_TEXT[z.level]}・{periodText(z)}
      </div>
      {z.ceilingFt !== undefined && (
        <div className="text-[0.6875rem] text-amber-200">
          {z.ceilingFt} 呎（約 {ftToM(z.ceilingFt)} 公尺）以上禁止
        </div>
      )}
      {(desc || z.authority || z.consult || z.penalty || z.link) && (
        <details className="mt-1">
          <summary className="cursor-pointer text-[0.625rem] text-tactical-cyan">說明、機關、罰則</summary>
          {desc && <p className="mt-1 whitespace-pre-line text-[0.6875rem] leading-relaxed text-slate-300">{desc}</p>}
          {z.authority && <p className="mt-1 text-[0.625rem] text-slate-400">主管機關：{z.authority}</p>}
          {z.consult && <p className="text-[0.625rem] text-slate-400">會商機關（申請時要它同意）：{z.consult}</p>}
          {z.penalty && <p className="mt-1 whitespace-pre-line text-[0.625rem] text-slate-400">罰則：{z.penalty}</p>}
          {z.link && (
            <a href={z.link} target="_blank" rel="noopener" className="mt-1 inline-block text-[0.625rem] text-tactical-cyan underline">
              管理處的申請說明
            </a>
          )}
        </details>
      )}
    </li>
  )
}

function Row({ dot, title, children }: { dot: string; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 border-t border-slate-800 py-1.5 first:border-t-0">
      <span className="w-5 shrink-0 text-center">{dot}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[0.6875rem] font-semibold text-slate-200">{title}</div>
        <div className="text-[0.6875rem] leading-relaxed text-slate-400">{children}</div>
      </div>
    </div>
  )
}

/**
 * 🛸 無人機：點地圖選位置（預設 GPS，沒有就畫面中心），看這裡能不能飛、為什麼、找誰申請，
 * 加上飛行條件（高空風、降雨、能見度、日落、地磁 Kp、附近低空有人機）與法規重點。
 *
 * 做成貼底的卡片、不加暗色遮罩：上半部地圖要看得到禁限航區、可以直接點地圖換位置。
 */
export function DronePanel() {
  const open = useTacticalStore((s) => s.openTool === 'drone')
  const setOpenTool = useTacticalStore((s) => s.setOpenTool)
  const target = useTacticalStore((s) => s.droneTarget)
  const setDroneTarget = useTacticalStore((s) => s.setDroneTarget)
  const ownPosition = useTacticalStore((s) => s.ownPosition)
  const showZones = useTacticalStore((s) => s.showDroneZones)
  const setShowZones = useTacticalStore((s) => s.setShowDroneZones)
  const setShowGnss = useTacticalStore((s) => s.setShowGnss)
  const showGnss = useTacticalStore((s) => s.showGnss)
  const distUnit = useTacticalStore((s) => s.distUnit)
  const [windLimit, setWindLimit] = useState<WindLimit>(() => loadWindLimit())
  const [zones, setZones] = useState<Load<PointCheck>>({ state: 'loading' })
  const [wx, setWx] = useState<Load<DroneHour[]>>({ state: 'loading' })
  const [kp, setKp] = useState<Load<KpPoint[]>>({ state: 'loading' })
  const [air, setAir] = useState<Load<LowTraffic[]>>({ state: 'loading' })
  const [tick, setTick] = useState(0)

  const lat = target?.lat
  const lng = target?.lng
  // 天氣與飛機用約 1 公里的格子當 key：在附近點來點去不必每次重抓
  const coarse = lat !== undefined && lng !== undefined ? `${lat.toFixed(2)},${lng.toFixed(2)}` : ''

  // 每分鐘重算一次時段（日落倒數）與 Kp 目前格
  useEffect(() => {
    if (!open) return
    const id = window.setInterval(() => setTick((t) => t + 1), 60_000)
    return () => window.clearInterval(id)
  }, [open])

  // 禁限航區判定
  useEffect(() => {
    if (!open || lat === undefined || lng === undefined) return
    const ctrl = new AbortController()
    setZones({ state: 'loading' })
    droneStore
      .zonesAt(lat, lng, ctrl.signal)
      .then((z) => setZones({ state: 'ok', data: checkPoint(lat, lng, z, Date.now()) }))
      .catch((e) => {
        if (ctrl.signal.aborted) return
        if (e instanceof DroneDataError && e.kind === 'not_ready') setZones({ state: 'not_ready', msg: e.message })
        else setZones({ state: 'error', msg: errText(e) })
      })
    return () => ctrl.abort()
  }, [open, lat, lng])

  // 天氣（15 分鐘更新）
  useEffect(() => {
    if (!open || !coarse) return
    const [la, ln] = coarse.split(',').map(Number)
    let ctrl = new AbortController()
    const load = () => {
      ctrl.abort()
      ctrl = new AbortController()
      const my = ctrl
      fetchDroneWeather(la, ln, { signal: my.signal })
        .then((h) => setWx({ state: 'ok', data: h }))
        .catch((e) => !my.signal.aborted && setWx({ state: 'error', msg: errText(e) }))
    }
    setWx({ state: 'loading' })
    load()
    const id = window.setInterval(load, 15 * 60_000)
    return () => {
      ctrl.abort()
      window.clearInterval(id)
    }
  }, [open, coarse])

  // 地磁 Kp（30 分鐘快取）
  useEffect(() => {
    if (!open) return
    if (kpCache && Date.now() - kpCache.at < 30 * 60_000) {
      setKp({ state: 'ok', data: kpCache.pts })
      return
    }
    const ctrl = new AbortController()
    fetchKp({ signal: ctrl.signal })
      .then((pts) => {
        kpCache = { at: Date.now(), pts }
        setKp({ state: 'ok', data: pts })
      })
      .catch((e) => !ctrl.signal.aborted && setKp({ state: 'error', msg: errText(e) }))
    return () => ctrl.abort()
  }, [open])

  // 附近低空有人機（30 秒更新）
  useEffect(() => {
    if (!open || !coarse) return
    const [la, ln] = coarse.split(',').map(Number)
    const anchor = adsbAnchor(la, ln, 10)
    if (!anchor) return
    let ctrl = new AbortController()
    const load = () => {
      ctrl.abort()
      ctrl = new AbortController()
      const my = ctrl
      fetchAdsb(anchor, { signal: my.signal })
        .then((snap) => {
          const ac = normalizeAircraft({ ac: snap.ac }) ?? []
          const list = lowTraffic(
            ac.map((a) => ({
              lat: a.lat,
              lng: a.lng,
              altFt: a.altFt,
              onGround: a.onGround,
              name: aircraftName(a),
              heli: isHelicopter(a),
              emergency: !!emergencyText(a),
            })),
            la,
            ln,
          )
          setAir({ state: 'ok', data: list })
        })
        .catch((e) => !my.signal.aborted && setAir({ state: 'error', msg: errText(e) }))
    }
    setAir({ state: 'loading' })
    load()
    const id = window.setInterval(load, 30_000)
    return () => {
      ctrl.abort()
      window.clearInterval(id)
    }
  }, [open, coarse])

  const sun = useMemo(() => {
    if (lat === undefined || lng === undefined) return null
    const noon = Date.parse(`${twDate(Date.now())}T04:00:00Z`) // 台灣今天中午
    const s = getSunTimes(new Date(noon), lat, lng)
    const ok = (d: Date) => (Number.isFinite(d.getTime()) ? d : null)
    return { rise: ok(s.sunrise), set: ok(s.sunset) }
  }, [lat, lng])
  // tick：每分鐘重算倒數
  const daylight = useMemo(() => (sun ? daylightWindow(Date.now(), sun.rise, sun.set) : null), [sun, tick]) // eslint-disable-line react-hooks/exhaustive-deps
  /** 這一小時整段都在日落後或日出前：法規不能飛，逐時列不顯示天氣燈號，免得看到綠燈以為能飛。 */
  const isNight = (t: number) => !!sun?.rise && !!sun.set && (t >= sun.set.getTime() || t + 3600_000 <= sun.rise.getTime())

  if (!open) return null

  const close = () => setOpenTool(null)
  const useGps = () => ownPosition && setDroneTarget({ lat: ownPosition.lat, lng: ownPosition.lng })
  const atGps = !!ownPosition && !!target && Math.abs(ownPosition.lat - target.lat) < 1e-6 && Math.abs(ownPosition.lng - target.lng) < 1e-6

  const nowWx = wx.state === 'ok' ? wx.data[0] : null
  const nowWxA = nowWx ? assessHour(nowWx, windLimit) : null
  const kpS = kp.state === 'ok' ? kpSummary(kp.data, Date.now()) : null
  const idx = droneStore.currentIndex

  return (
    <div
      className="pointer-events-auto fixed inset-x-0 bottom-0 z-[1500] max-h-[55vh] overflow-y-auto rounded-t-xl border-t border-slate-700 bg-tactical-bg/95 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-2xl backdrop-blur md:inset-x-auto md:bottom-3 md:right-3 md:max-h-[80vh] md:w-[26rem] md:rounded-xl md:border"
      role="dialog"
      aria-label="無人機"
    >
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-base font-bold text-tactical-cyan">🛸 無人機</h2>
        <button onClick={close} className="h-9 w-9 text-slate-400 active:scale-95" aria-label="關閉">
          ✕
        </button>
      </div>
      <div className="mb-2 flex items-center justify-between gap-2 text-[0.625rem] text-slate-400">
        <span>
          {atGps ? '📍 我方 GPS' : '🎯 選的位置'}：{target ? `${target.lat.toFixed(4)}, ${target.lng.toFixed(4)}` : '—'}
          <span className="ml-1 text-slate-500">（點地圖換位置）</span>
        </span>
        {ownPosition && !atGps && (
          <button onClick={useGps} className="shrink-0 rounded border border-slate-600 px-2 py-1 text-[0.625rem] text-slate-200 active:scale-95">
            用我的位置
          </button>
        )}
      </div>

      {/* 這裡能不能飛 */}
      {zones.state === 'loading' && <div className="rounded-lg border border-slate-700 p-3 text-xs text-slate-400">⏳ 查禁限航區…</div>}
      {zones.state === 'not_ready' && <div className="rounded-lg border border-slate-700 p-3 text-xs text-slate-400">⚪ {zones.msg}</div>}
      {zones.state === 'error' && <div className="rounded-lg border border-rose-500/60 p-3 text-xs text-rose-200">🔴 {zones.msg}</div>}
      {zones.state === 'ok' && (
        <>
          <div className={`rounded-lg border p-3 text-sm font-bold leading-snug ${VERDICT_LOOK[zones.data.verdict].cls}`}>
            {VERDICT_LOOK[zones.data.verdict].dot} {verdictText(zones.data)}
          </div>
          {zones.data.nearEdge && (
            <div className="mt-1 text-[0.6875rem] text-amber-300">⚠️ 離某個範圍的邊界不到 50 公尺：GPS 誤差可能讓結果相反，以民航局系統為準</div>
          )}
          {zones.data.inside.length > 0 && (
            <>
              <h3 className="mt-2 text-[0.6875rem] font-semibold text-slate-300">這裡的公告（{zones.data.inside.length}）</h3>
              <ul className="mt-1 flex flex-col gap-1">
                {zones.data.inside.map((z) => (
                  <ZoneItem key={z.id} z={z} />
                ))}
              </ul>
            </>
          )}
          {zones.data.upcoming.length > 0 && (
            <>
              <h3 className="mt-2 text-[0.6875rem] font-semibold text-amber-300">即將生效（30 天內）</h3>
              <ul className="mt-1 flex flex-col gap-1">
                {zones.data.upcoming.map((z) => (
                  <ZoneItem key={z.id} z={z} />
                ))}
              </ul>
            </>
          )}
          {zones.data.near.length > 0 && (
            <details className="mt-2" open={zones.data.inside.length === 0}>
              <summary className="cursor-pointer text-[0.6875rem] font-semibold text-slate-300">
                附近 1 公里內（{zones.data.near.length}）：飛出去前看一下
              </summary>
              <ul className="mt-1 flex flex-col gap-1">
                {zones.data.near.slice(0, 12).map((n) => (
                  <ZoneItem key={n.zone.id} z={n.zone} dist={metersText(n.distM)} />
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      {/* 飛行條件 */}
      <h3 className="mb-1 mt-3 text-[0.6875rem] font-semibold text-slate-300">飛行條件（現在）</h3>
      <div className="rounded-lg border border-slate-700 bg-slate-900/40 px-2">
        {daylight && (
          <Row dot={COND_DOT[daylight.level]} title="法規時段（日出到日落）">
            {daylight.text}
          </Row>
        )}
        <Row
          dot={wx.state === 'ok' && nowWxA ? COND_DOT[nowWxA.level] : wx.state === 'error' ? '🔴' : '⏳'}
          title="風、降雨、能見度（Open-Meteo）"
        >
          {wx.state === 'loading' && '讀取中…'}
          {wx.state === 'error' && wx.msg}
          {wx.state === 'ok' && nowWx && nowWxA && (
            <>
              <div>
                風 地面 {nowWx.wind10.toFixed(1)}／80 公尺 {nowWx.wind80.toFixed(1)}／120 公尺 {nowWx.wind120.toFixed(1)} m/s，陣風 {nowWx.gust.toFixed(1)}；
                {nowWx.pop !== null ? `降雨機率 ${nowWx.pop}%；` : ''}
                {nowWx.vis !== null ? `能見度 ${(nowWx.vis / 1000).toFixed(0)} 公里；` : ''}
                {nowWx.temp.toFixed(0)}°C
              </div>
              {nowWxA.reasons.length > 0 && <div className="text-amber-200">{nowWxA.reasons.join('；')}</div>}
              <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[0.625rem]">
                {wx.data.map((h) => (
                  <span key={h.t}>
                    {hourText(h.t)} {isNight(h.t) ? '🌙' : COND_DOT[assessHour(h, windLimit).level]}
                  </span>
                ))}
                {wx.data.some((h) => isNight(h.t)) && <span className="text-slate-500">🌙＝日落後，法規不能飛</span>}
              </div>
              <label className="mt-1 flex items-center gap-1 text-[0.625rem]">
                機型抗風上限
                <select
                  value={windLimit}
                  onChange={(e) => {
                    const v = Number(e.target.value) as WindLimit
                    setWindLimit(v)
                    persistWindLimit(v)
                  }}
                  className="rounded border border-slate-600 bg-slate-800 px-1 py-0.5 text-slate-200"
                >
                  {WIND_LIMITS.map((w) => (
                    <option key={w} value={w}>
                      {w} m/s{w === 10 ? '（小型）' : w === 12 ? '（一般）' : '（工業級）'}
                    </option>
                  ))}
                </select>
                <span className="text-slate-500">以機型規格為準</span>
              </label>
            </>
          )}
        </Row>
        <Row
          dot={kpS?.now ? COND_DOT[kpLevel(Math.max(kpS.now.kp, kpS.max24 ?? 0))] : kp.state === 'error' ? '🔴' : '⏳'}
          title="地磁 Kp（NOAA）：磁暴時 GPS、羅盤可能不準"
        >
          {kp.state === 'loading' && '讀取中…'}
          {kp.state === 'error' && kp.msg}
          {kp.state === 'ok' &&
            (kpS?.now
              ? `現在 ${kpS.now.kp.toFixed(1)}${kpS.now.kind === 'predicted' ? '（預報）' : ''}，24 小時內最高 ${(kpS.max24 ?? kpS.now.kp).toFixed(1)}；5 以上是磁暴`
              : '沒有目前時段的資料')}
        </Row>
        <Row
          dot={air.state === 'ok' ? COND_DOT[trafficLevel(air.data)] : air.state === 'error' ? '🔴' : '⏳'}
          title={`附近低空有人機（${TRAFFIC_RADIUS_NM} 浬內、${TRAFFIC_MAX_ALT_FT.toLocaleString('en-US')} 呎以下，ADS-B）`}
        >
          {air.state === 'loading' && '讀取中…'}
          {air.state === 'error' && air.msg}
          {air.state === 'ok' &&
            (air.data.length === 0
              ? '沒有看到（沒裝 ADS-B 或沒被收到的飛機不會出現，仍要目視注意）'
              : air.data.slice(0, 4).map((a) => (
                  <div key={`${a.name}${a.distNm}`}>
                    {a.emergency ? '🆘 ' : a.heli ? '🚁 ' : '✈️ '}
                    {a.name}：{a.altFt === null ? '高度不明' : `${Math.round(a.altFt).toLocaleString('en-US')} 呎`}、
                    {formatDist(a.distNm * 1.852, distUnit)}、方位 {String(Math.round(a.bearing) % 360).padStart(3, '0')}°
                  </div>
                )))}
        </Row>
        <Row dot="📵" title="GPS 干擾（推估）">
          用飛機回報的定位精度推估，不是直接量到。
          <button
            onClick={() => setShowGnss(!showGnss)}
            className="ml-1 rounded border border-slate-600 px-2 py-0.5 text-[0.625rem] text-slate-200 active:scale-95"
          >
            {showGnss ? '關掉 📵 圖層' : '開 📵 圖層看'}
          </button>
        </Row>
      </div>

      {/* 法規重點 */}
      <details className="mt-3 rounded-lg border border-slate-700 bg-slate-900/40 p-2">
        <summary className="cursor-pointer text-[0.6875rem] font-semibold text-tactical-cyan">📜 法規重點（點開）</summary>
        <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-4 text-[0.6875rem] leading-relaxed text-slate-300">
          <li>
            <b>高度</b>：距地面或水面不得超過 400 呎（約 120 公尺）〔民用航空法 §99-14 第 1 項第 1 款〕；機場四周的黃區另有 200 呎（約 60 公尺）以上禁止。
          </li>
          <li>
            <b>時段</b>：日落後到日出前不得飛航〔§99-14 第 6 款〕。
          </li>
          <li>
            <b>目視</b>：在目視範圍內操作，不得用矯正鏡片以外的工具延伸距離〔§99-14 第 7 款〕；有目視觀察員的延伸視距，最遠以操作人為中心半徑 900 公尺〔遙控無人機管理規則 §2、§28〕。
          </li>
          <li>
            不得在人群聚集或室外集會遊行上空；不得投擲、噴灑；不得載危險物品；同一時間只控制一架〔§99-14 第 2、3、5、8 款〕。離高速公路、鐵路、捷運、建築物、障礙物 30 公尺以上〔管理規則 §28〕。
          </li>
          <li>
            <b>在船上起飛</b>：不得在移動中的航空器、車輛或船艦上操作〔管理規則 §28 第 1 項第 2 款〕。政府機關（構）依 §32 向民航局申請許可後，不受這項限制。
          </li>
          <li>
            <b>禁限航區、機場四周</b>：禁止飛航〔§99-13 第 1 項〕；政府機關（構）執行業務要申請民航局會商目的事業主管機關同意〔§99-13 第 3 項〕，活動日 15 天前申請，涉及軍事管理的 30 天前〔管理規則 §31〕。
          </li>
          <li>
            <b>縣市公告範圍</b>：由直轄市、縣（市）政府公告與取締；政府機關（構）執行業務在公告範圍外活動，要申請縣市政府會商相關中央主管機關同意〔§99-13 第 2、4 項〕。
          </li>
          <li>
            <b>政府機關執行法定職務</b>（災害防救、偵查、調查、矯正）：經民航局同意，可在機場四周或縣市公告範圍外活動，也可排除 §99-14 第 2 到 8 款的限制〔§99-16〕。
          </li>
          <li>
            <b>商港區</b>：只有政府機關（構）、學校、法人為執行公務等需要可以申請，飛航 7 天前向港務公司或航港局申請；執行災害防救、偵查、矯正業務經同意的，可以用通訊紀錄、傳真等方式〔商港區域特定範圍內遙控無人機飛航活動申請及管理辦法 §3〕。
          </li>
          <li>
            <b>國家公園</b>：另依國家公園法，向該國家公園管理處申請。
          </li>
          <li>
            <b>註冊、操作證</b>：自然人 250 公克以上、政府機關（構）所有的都要註冊〔§99-10〕；政府機關（構）所有的要專業操作證〔管理規則 §19、§20〕。
          </li>
          <li>
            <b>罰則</b>：在禁限航區、機場四周飛，或超過 400 呎：新臺幣 30 萬到 150 萬元、廢止操作證、得沒入〔§118-1〕；違反縣市公告或其他操作規定：3 萬到 15 萬元；沒有操作證、沒保險：6 萬到 30 萬元〔§118-2〕。
          </li>
        </ul>
        <p className="mt-2 text-[0.625rem] text-slate-500">
          條文摘自全國法規資料庫（民用航空法 2023-06-28、遙控無人機管理規則 2024-11-14、商港辦法 2026-02-09 修正版），以官方最新條文為準。
        </p>
      </details>

      {/* 資料與官方連結 */}
      <div className="mt-3 text-[0.625rem] leading-relaxed text-slate-500">
        {idx ? `${sourceText(idx)}。` : ''}圖資僅供參考，以民航局及各縣市政府公告為準；國家公園、商港另有規定。
        <div className="mt-1 flex flex-wrap gap-2">
          <a href={CAA_PORTAL} target="_blank" rel="noopener" className="rounded border border-slate-600 px-2 py-1 text-slate-200">
            民航局無人機系統（查詢、申請）
          </a>
          <a href={CAA_GIS} target="_blank" rel="noopener" className="rounded border border-slate-600 px-2 py-1 text-slate-200">
            民航局 GIS 圖台
          </a>
        </div>
        <label className="mt-2 flex items-center gap-1.5 text-slate-400">
          <input type="checkbox" checked={showZones} onChange={(e) => setShowZones(e.target.checked)} />
          地圖上畫禁限航區
        </label>
      </div>
    </div>
  )
}
