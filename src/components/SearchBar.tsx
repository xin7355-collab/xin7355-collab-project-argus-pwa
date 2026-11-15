import { useMemo, useRef, useState } from 'react'
import { useTacticalStore } from '../store/tacticalStore'
import { parseCoord } from '../lib/coordParse'
import { geocode, type GeoResult } from '../lib/geocode'
import { matchVessels } from '../lib/vesselSearch'
import { ageText, type Vessel } from '../lib/aisStore'
import { errText } from '../lib/feedState'

/**
 * 頂端搜尋列（像 Google Maps）。
 *
 * 舊版頂端是一條「阿爾戈斯 · PASS v2.40.2…」狀態列加一行被截斷的訊息，
 * 佔了位置卻沒有可以操作的東西。地名搜尋與座標輸入其實都有，只是藏在
 * 🧰 → 搜尋／現場點位、🧰 → 座標 兩層裡面。
 *
 * 輸入能解析成座標就直接飛過去（不用連網）；否則查地名（Nominatim，
 * 免金鑰；使用政策每秒最多一次，所以只在按搜尋時查，不做逐字即時查）。
 * 船名／MMSI 則是邊打邊比對手機上已收到的 AIS 船（不用連網，見 lib/vesselSearch）。
 */
export function SearchBar() {
  const previewCoord = useTacticalStore((s) => s.previewCoord)
  const setSheetSnap = useTacticalStore((s) => s.setSheetSnap)
  const setSettingsOpen = useTacticalStore((s) => s.setSettingsOpen)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<GeoResult[] | null>(null)
  const [msg, setMsg] = useState('')
  const [hideShips, setHideShips] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const vessels = useTacticalStore((s) => s.vessels)
  const inAis = useTacticalStore((s) => s.mode === 'ais')
  const shipHits = useMemo(() => (parseCoord(q) ? [] : matchVessels(vessels, q)), [vessels, q])

  const go = (lat: number, lng: number, label: string, zoom?: number) => {
    previewCoord(lat, lng, label, zoom)
    setResults(null)
    setMsg('')
    // 收起抽屜、收起鍵盤：使用者要看的是地圖上那個點
    setSheetSnap('peek')
    inputRef.current?.blur()
  }

  // 找到船：進 AIS 模式、飛過去，AIS 圖層一收到這艘就打開它的資訊（focusMmsi）
  const goVessel = (v: Vessel) => {
    const st = useTacticalStore.getState()
    if (st.mode !== 'ais') st.setMode('ais')
    st.setFlyTo({ lat: v.lat, lng: v.lng, zoom: Math.max(st.mapView.zoom, 12) })
    st.setFocusMmsi(v.mmsi)
    setQ('')
    setResults(null)
    setMsg('')
    setSheetSnap('peek')
    inputRef.current?.blur()
  }

  const submit = async () => {
    const text = q.trim()
    if (!text) return
    const c = parseCoord(text)
    if (c) {
      go(c.lat, c.lng, text, 13)
      return
    }
    // 打的就是某艘船的完整 MMSI 或船名：直接過去，不用再查地名
    const exact = shipHits.find((v) => v.mmsi === text || v.name.toUpperCase() === text.toUpperCase())
    if (exact) {
      goVessel(exact)
      return
    }
    setBusy(true)
    setMsg('')
    setResults(null)
    try {
      const mv = useTacticalStore.getState().mapView
      const r = await geocode(text, { near: { lat: mv.lat, lng: mv.lng } })
      if (r.length === 0) {
        setMsg(
          shipHits.length
            ? `沒有叫「${text}」的地名；上面是名字相近的船`
            : `找不到「${text}」。試試更完整的地名（例如「基隆港」）、船名或 MMSI，或直接輸入座標「25.13, 121.74」`,
        )
      } else if (r.length === 1) {
        go(r[0].lat, r[0].lng, r[0].label, 15)
      } else {
        setResults(r)
      }
    } catch (e) {
      setMsg(errText(e, '地名搜尋連不上（海上訊號不穩時常見）。座標不用連網，可以直接輸入，例如「25.13, 121.74」'))
    } finally {
      setBusy(false)
    }
  }

  const clear = () => {
    setQ('')
    setResults(null)
    setMsg('')
    inputRef.current?.focus()
  }

  return (
    <div className="safe-top pointer-events-none absolute inset-x-0 top-0 z-[1150] flex flex-col gap-1.5 md:right-auto md:w-[28rem]">
      <div className="pointer-events-auto flex items-center gap-2">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
          className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-full border border-slate-600/80 bg-tactical-bg/95 pl-4 pr-2 shadow-lg backdrop-blur focus-within:border-tactical-cyan/70"
          role="search"
        >
          <span className="shrink-0 text-base text-slate-400" aria-hidden>
            {busy ? '⏳' : '🔍'}
          </span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setHideShips(false)
            }}
            enterKeyHint="search"
            inputMode="search"
            placeholder="搜尋地名、船名、MMSI 或座標"
            aria-label="搜尋地名、船名、MMSI 或輸入座標"
            className="min-w-0 flex-1 bg-transparent text-[0.9375rem] text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
          {q && (
            <button type="button" onClick={clear} className="shrink-0 px-1.5 text-slate-400 active:scale-90" aria-label="清除">
              ✕
            </button>
          )}
        </form>
        <button
          onClick={() => setSettingsOpen(true)}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-slate-600/80 bg-tactical-bg/95 text-lg shadow-lg active:scale-95"
          aria-label="設定"
        >
          ⚙️
        </button>
      </div>

      {(results || msg || (shipHits.length > 0 && !hideShips)) && (
        <div className="pointer-events-auto max-h-[50vh] overflow-y-auto rounded-2xl border border-slate-700 bg-tactical-bg/95 p-1.5 shadow-lg backdrop-blur">
          {!hideShips &&
            shipHits.map((v) => (
              <button
                key={v.mmsi}
                onClick={() => goVessel(v)}
                className="flex w-full items-start gap-2 rounded-xl px-2.5 py-2 text-left active:bg-slate-800"
              >
                <span className="mt-0.5 text-sm">{v.kind === 'aton' ? '◆' : '🚢'}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-slate-100">{v.name}</span>
                  <span className="block font-mono text-[0.625rem] text-slate-500">
                    MMSI {v.mmsi} · {v.type}
                    {/* 不在 AIS 模式時船位是上次收到的，ageSec 也停在那時，不能當「幾分鐘前」 */}
                    {inAis ? ` · ${ageText(v.ageSec)}` : ' · 上次 AIS 收到的'}
                  </span>
                </span>
              </button>
            ))}
          {msg && <p className="px-2.5 py-2 text-xs leading-relaxed text-amber-200">{msg}</p>}
          {results?.map((r) => (
            <button
              key={`${r.lat},${r.lng},${r.label}`}
              onClick={() => go(r.lat, r.lng, r.label, 15)}
              className="flex w-full items-start gap-2 rounded-xl px-2.5 py-2 text-left active:bg-slate-800"
            >
              <span className="mt-0.5 text-sm">📍</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-slate-100">{r.label}</span>
                <span className="block font-mono text-[0.625rem] text-slate-500">
                  {r.lat.toFixed(4)}, {r.lng.toFixed(4)}
                  {r.kind ? ` · ${r.kind}` : ''}
                </span>
              </span>
            </button>
          ))}
          <button
            onClick={() => {
              setResults(null)
              setMsg('')
              setHideShips(true)
            }}
            className="w-full py-1.5 text-center text-[0.6875rem] text-slate-500"
          >
            收起
          </button>
        </div>
      )}
    </div>
  )
}
