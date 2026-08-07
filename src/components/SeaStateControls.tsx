import { useTacticalStore } from '../store/tacticalStore'
import { SST_LEGEND, WAVE_LEGEND, sstColorDyn, waveColorDyn } from '../lib/colorScale'

/** 海況模式控制項：海溫/浪高切換 + 色階圖例。 */
export function SeaStateControls() {
  const field = useTacticalStore((s) => s.seaStateField)
  const setField = useTacticalStore((s) => s.setSeaStateField)
  const seaAreas = useTacticalStore((s) => s.cwaSeaAreas)
  const range = useTacticalStore((s) => s.seaStateRange)
  const base = field === 'sst' ? SST_LEGEND : WAVE_LEGEND
  // 動態色階：圖例的範圍與配色都對齊「此畫面實際範圍」，才和地圖一致。
  const legend = range
    ? {
        min: range.min,
        max: range.max,
        unit: base.unit,
        colorAt: (v: number) =>
          field === 'sst' ? sstColorDyn(v, range.min, range.max, 1) : waveColorDyn(v, range.min, range.max, 1),
      }
    : base

  // 產生色條的漸層
  const steps = 24
  const stops = Array.from({ length: steps }, (_, i) => {
    const v = legend.min + ((legend.max - legend.min) * i) / (steps - 1)
    return legend.colorAt(v)
  })

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-700 bg-tactical-panel/90 p-3">
      <div className="grid grid-cols-2 gap-1 rounded-lg border border-slate-700 p-1">
        <button
          onClick={() => setField('sst')}
          className={`rounded py-1.5 text-xs font-bold transition-all active:scale-95 ${
            field === 'sst' ? 'bg-tactical-cyan/20 text-tactical-cyan' : 'text-slate-400'
          }`}
        >
          🌡️ 海表溫度
        </button>
        <button
          onClick={() => setField('wave')}
          className={`rounded py-1.5 text-xs font-bold transition-all active:scale-95 ${
            field === 'wave' ? 'bg-tactical-cyan/20 text-tactical-cyan' : 'text-slate-400'
          }`}
        >
          〰 浪高
        </button>
      </div>

      {/* 色階圖例 */}
      <div>
        <div
          className="h-3 w-full rounded"
          style={{ background: `linear-gradient(to right, ${stops.join(',')})` }}
        />
        <div className="mt-1 flex justify-between font-mono text-[0.625rem] text-slate-400">
          <span>
            {legend.min}
            {legend.unit}
          </span>
          <span>
            {((legend.min + legend.max) / 2).toFixed(0)}
            {legend.unit}
          </span>
          <span>
            {legend.max}
            {legend.unit}
          </span>
        </div>
      </div>

      {/* CWA 官方各海域海面預報（有設定才顯示）*/}
      {seaAreas && seaAreas.length > 0 && (
        <div className="rounded-lg border border-tactical-green/30 bg-tactical-green/5 p-2">
          <div className="mb-1 text-[0.6875rem] font-semibold text-tactical-green">
            🌊 CWA 海面預報（官方各海域）
          </div>
          <div className="flex max-h-32 flex-col gap-0.5 overflow-y-auto">
            {seaAreas.map((a, i) => (
              <div key={i} className="flex items-start justify-between gap-2 text-[0.625rem]">
                <span className="shrink-0 font-semibold text-slate-300">{a.area}</span>
                <span className="text-right text-slate-400">
                  {[a.wind, a.waveText ?? (a.waveM != null ? `浪 ${a.waveM} m` : null)]
                    .filter(Boolean)
                    .join('｜') || '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-[0.625rem] leading-relaxed text-slate-500">
        熱力圖為免金鑰海象（Open-Meteo）。點格子看數值；平移地圖會重新載入該區。
        {seaAreas === null && '設定 CWA 後，這裡會顯示官方各海域風/浪預報。'}
      </p>
    </div>
  )
}
