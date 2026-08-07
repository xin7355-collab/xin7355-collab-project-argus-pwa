import { useState } from 'react'
import { useTacticalStore } from '../store/tacticalStore'
import { isAisConfigured } from '../lib/ais'
import { isSentinelConfigured } from '../lib/sentinel'
import { analyzeVessels, analyzeApproach } from '../lib/aisAnomaly'

/** AIS 模式控制面板：船舶數、搜尋、異常警示、衛星船隻疊層（漁火／雷達）。 */
export function AisControls() {
  const vessels = useTacticalStore((s) => s.vessels)
  const showBoatLights = useTacticalStore((s) => s.showBoatLights)
  const setShowBoatLights = useTacticalStore((s) => s.setShowBoatLights)
  const showRadarVessels = useTacticalStore((s) => s.showRadarVessels)
  const setShowRadarVessels = useTacticalStore((s) => s.setShowRadarVessels)
  const gotoCoord = useTacticalStore((s) => s.gotoCoord)
  const fitPoints = useTacticalStore((s) => s.fitPoints)
  const mapView = useTacticalStore((s) => s.mapView)
  const setStatus = useTacticalStore((s) => s.setStatus)
  const ownPosition = useTacticalStore((s) => s.ownPosition)
  const analyses = analyzeVessels(vessels)
  const flagged = analyses.filter((a) => a.level !== 'ok')
  // 🎯 趨近我方（需 GPS 定位）：會近距離通過的船，碰撞/接觸預警
  const approaches = ownPosition ? analyzeApproach(vessels, ownPosition).slice(0, 6) : []

  // 📋 全部船隻：依「距我方（或畫面中心）」由近到遠排序，一次瀏覽
  const [showAll, setShowAll] = useState(false)
  const ref = ownPosition ?? mapView
  const cosLat = Math.cos((ref.lat * Math.PI) / 180) || 1e-6
  const allByDist = vessels
    .map((v) => ({
      v,
      nm: Math.hypot((v.lng - ref.lng) * 60 * cosLat, (v.lat - ref.lat) * 60),
    }))
    .sort((a, b) => a.nm - b.nm)
  // 一次看到全部船：縮放地圖到涵蓋所有船位。
  const fitAll = () => {
    if (vessels.length === 0) return
    fitPoints(vessels.map((v) => [v.lat, v.lng] as [number, number]))
    setStatus(`已縮放至涵蓋全部 ${vessels.length} 艘船`)
  }

  // 🔎 搜尋船隻（船名或 MMSI）
  const [q, setQ] = useState('')
  const query = q.trim().toLowerCase()
  const matches = query
    ? vessels.filter((v) => v.name.toLowerCase().includes(query) || v.mmsi.includes(query)).slice(0, 12)
    : []
  const flyTo = (lat: number, lng: number, name: string) => {
    gotoCoord(lat, lng, 12)
    setStatus(`已定位到「${name}」`)
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-slate-700 bg-tactical-panel/90 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-400">🔺 AIS 即時船位（已在圖上）</span>
        <span className="font-mono text-sm font-bold text-tactical-green">{vessels.length}</span>
      </div>

      {/* 一次看到全部船：縮放涵蓋所有船 + 展開全部清單 */}
      {vessels.length > 0 && (
        <div className="grid grid-cols-2 gap-1.5">
          <button
            onClick={fitAll}
            className="rounded border border-tactical-green/60 bg-tactical-green/10 px-2 py-1.5 text-[0.6875rem] font-bold text-tactical-green active:scale-95"
          >
            🔍 縮放至全部船
          </button>
          <button
            onClick={() => setShowAll((v) => !v)}
            className={`rounded border px-2 py-1.5 text-[0.6875rem] font-bold active:scale-95 ${
              showAll
                ? 'border-tactical-cyan bg-tactical-cyan/15 text-tactical-cyan'
                : 'border-slate-600 bg-slate-900/60 text-slate-300'
            }`}
          >
            📋 全部清單（{vessels.length}）
          </button>
        </div>
      )}

      {/* 📋 全部船隻清單：依距離由近到遠，點即定位 */}
      {showAll && vessels.length > 0 && (
        <div className="flex max-h-52 flex-col gap-0.5 overflow-y-auto rounded border border-slate-700 bg-slate-900/40 p-1">
          <div className="px-1 pb-0.5 text-[0.5625rem] text-slate-500">
            依{ownPosition ? '距我方' : '距畫面中心'}由近到遠 · 點船定位
          </div>
          {allByDist.map(({ v, nm }) => (
            <button
              key={v.mmsi}
              onClick={() => flyTo(v.lat, v.lng, v.name)}
              className="flex items-center justify-between gap-2 rounded border border-slate-700/60 bg-slate-800/50 px-2 py-1 text-left active:scale-95"
            >
              <span className="min-w-0 flex-1 truncate text-[0.6875rem] font-semibold text-slate-200">
                🔺 {v.name}
              </span>
              <span className="shrink-0 font-mono text-[0.5625rem] text-slate-400">
                {nm.toFixed(1)}浬 · {v.sog.toFixed(0)}kn
              </span>
            </button>
          ))}
        </div>
      )}

      {/* 🔎 搜尋船隻（船名 / MMSI）→ 點結果定位 */}
      <div className="flex flex-col gap-1">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          spellCheck={false}
          placeholder="🔎 搜尋船名 / MMSI → 直接定位"
          className="rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm text-slate-100"
        />
        {query && (
          <div className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
            {matches.length === 0 && <span className="px-1 text-[0.625rem] text-slate-500">查無相符（船需已回報上圖才搜得到）</span>}
            {matches.map((v) => (
              <button
                key={v.mmsi}
                onClick={() => flyTo(v.lat, v.lng, v.name)}
                className="flex items-center justify-between gap-2 rounded border border-slate-700 bg-slate-800/60 px-2 py-1 text-left active:scale-95"
              >
                <span className="min-w-0 flex-1 truncate text-[0.6875rem] font-semibold text-slate-200">🔺 {v.name}</span>
                <span className="shrink-0 font-mono text-[0.5625rem] text-slate-400">{v.mmsi}｜{v.sog.toFixed(0)}kn</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 🎯 趨近我方（CPA 預警）：需開 📍 定位 */}
      {approaches.length > 0 && (
        <div className="flex flex-col gap-1 rounded border border-rose-500/50 bg-rose-500/10 p-2">
          <div className="text-[0.6875rem] font-semibold text-rose-300">
            🎯 趨近我方 {approaches.length}（會近距離通過）
          </div>
          {approaches.map((a) => (
            <button
              key={a.vessel.mmsi}
              onClick={() => flyTo(a.vessel.lat, a.vessel.lng, a.vessel.name)}
              className="flex items-center justify-between gap-2 rounded border border-rose-500/30 bg-rose-500/5 px-2 py-1 text-left active:scale-95"
            >
              <span className="min-w-0 flex-1 truncate text-[0.625rem] font-semibold text-rose-100">🔺 {a.vessel.name}</span>
              <span className="shrink-0 font-mono text-[0.5625rem] text-rose-200/90">
                最近 {a.cpaNm.toFixed(1)}浬 · {Math.round(a.tcpaMin)}分後 · 現 {a.distNm.toFixed(1)}浬
              </span>
            </button>
          ))}
          <p className="text-[0.5625rem] leading-relaxed text-slate-500">
            以我方定點、目標維持現航向航速估算最近接近距離(CPA)與時間(TCPA)；供避碰/接觸預警參考。
          </p>
        </div>
      )}

      {flagged.length > 0 && (
        <div className="flex flex-col gap-1 rounded border border-amber-500/40 bg-amber-500/5 p-2">
          <div className="text-[0.6875rem] font-semibold text-amber-400">
            ⚠ 異常警示 {flagged.length}
          </div>
          {flagged.slice(0, 5).map((a) => (
            <div key={a.vessel.mmsi} className="flex justify-between gap-2 text-[0.625rem]">
              <span className={a.level === 'alert' ? 'text-tactical-alert' : 'text-amber-400'}>
                {a.vessel.name}
              </span>
              <span className="truncate text-right text-slate-400">{a.alerts.join('、')}</span>
            </div>
          ))}
        </div>
      )}

      {vessels.length === 0 && (
        <p className="text-[0.625rem] leading-relaxed text-amber-500/90">
          {isAisConfigured()
            ? '尚未收到船位——AIS 訂閱「目前畫面範圍」，移動/縮放地圖到想看的海域即會訂閱該區；每艘船隔數十秒才回報一次，請稍候。'
            : '模擬船隻在台灣周邊，若看不到請縮小地圖。'}
        </p>
      )}

      {/* 衛星「看不廣播 AIS 的船」疊層 —— 全部畫在同一張地圖，不開網頁 */}
      <div className="mt-1 flex flex-col gap-1.5 rounded-lg border border-slate-700 bg-slate-900/40 p-2">
        <div className="text-[0.6875rem] font-semibold text-slate-300">🛰️ 外海船隻衛星疊層</div>

        <button
          onClick={() => setShowBoatLights(!showBoatLights)}
          className={[
            'flex items-center justify-between rounded border px-2.5 py-2 text-left text-[0.6875rem] font-semibold transition-all active:scale-95',
            showBoatLights
              ? 'border-amber-400 bg-amber-400/15 text-amber-300'
              : 'border-slate-600 bg-slate-900/60 text-slate-300',
          ].join(' ')}
        >
          <span>🌙 夜間漁火（VIIRS · 免金鑰）</span>
          <span className="font-mono">{showBoatLights ? '開' : '關'}</span>
        </button>
        <p className="px-0.5 text-[0.625rem] leading-relaxed text-slate-500">
          夜間外海一顆顆亮點＝開燈作業的漁船／漁船隊。看得到不廣播 AIS 的整支船隊。僅夜間有效。
        </p>

        <button
          onClick={() => setShowRadarVessels(!showRadarVessels)}
          disabled={!isSentinelConfigured()}
          className={[
            'flex items-center justify-between rounded border px-2.5 py-2 text-left text-[0.6875rem] font-semibold transition-all active:scale-95',
            !isSentinelConfigured()
              ? 'cursor-not-allowed border-slate-700 bg-slate-900/40 text-slate-600'
              : showRadarVessels
                ? 'border-tactical-cyan bg-tactical-cyan/15 text-tactical-cyan'
                : 'border-slate-600 bg-slate-900/60 text-slate-300',
          ].join(' ')}
        >
          <span>📡 雷達暗船（Sentinel-1）</span>
          <span className="font-mono">
            {!isSentinelConfigured() ? '需金鑰' : showRadarVessels ? '開' : '關'}
          </span>
        </button>
        <p className="px-0.5 text-[0.625rem] leading-relaxed text-slate-500">
          雷達看金屬船身，穿雲、日夜都行。<b className="text-tactical-cyan">雷達有亮點、AIS 卻沒三角形＝可疑暗船</b>（非法越界／關 AIS）。
          {!isSentinelConfigured() && '　⚙️ 設定填 Sentinel 金鑰後啟用。'}
        </p>
      </div>

      <p className="text-[0.625rem] leading-relaxed text-slate-500">
        點船隻可看詳情。無船名／航速異常者以紅色示警。以上皆直接畫在地圖，不需另開 MarineTraffic 網頁。
      </p>
      {!isAisConfigured() && (
        <p className="text-[0.625rem] leading-relaxed text-amber-500/80">
          目前為模擬船隻。到 aisstream.io 免費申請金鑰，填入 ⚙️ 設定即接真實 AIS。
        </p>
      )}
    </div>
  )
}
