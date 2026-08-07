import { useState } from 'react'
import { useTacticalStore } from '../store/tacticalStore'
import { isAisConfigured } from '../lib/ais'
import { isSentinelConfigured } from '../lib/sentinel'
import { analyzeVessels } from '../lib/aisAnomaly'

/** AIS 模式控制面板：船舶數、搜尋、異常警示、衛星船隻疊層（漁火／雷達）。 */
export function AisControls() {
  const vessels = useTacticalStore((s) => s.vessels)
  const showBoatLights = useTacticalStore((s) => s.showBoatLights)
  const setShowBoatLights = useTacticalStore((s) => s.setShowBoatLights)
  const showRadarVessels = useTacticalStore((s) => s.showRadarVessels)
  const setShowRadarVessels = useTacticalStore((s) => s.setShowRadarVessels)
  const gotoCoord = useTacticalStore((s) => s.gotoCoord)
  const setStatus = useTacticalStore((s) => s.setStatus)
  const analyses = analyzeVessels(vessels)
  const flagged = analyses.filter((a) => a.level !== 'ok')

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
