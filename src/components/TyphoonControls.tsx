import { currentPoint, hasForecast } from '../lib/typhoon'
import { isCwaConfigured } from '../lib/config'
import { estimateWarnings, marineVerdict } from '../lib/typhoonWarning'
import { typhoonBrief } from '../lib/typhoonBrief'
import { interpTyphoonAt } from '../map/TyphoonLayer'
import { fmtDay, fmtDayHour } from '../lib/timefmt'
import { useTacticalStore } from '../store/tacticalStore'

/** 名稱是否為「國際編號/尚未命名」(如 ELEVEN-26、TD、INVEST 91W)。 */
function isDesignation(name: string): boolean {
  return /^[A-Za-z0-9\s-]+$/.test(name) || /TD|INVEST|^\d/.test(name)
}

const VERDICT_STYLE: Record<string, string> = {
  active: 'text-rose-300',
  issue: 'text-orange-300',
  watch: 'text-amber-300',
  none: 'text-slate-400',
}

/**
 * 颱風路徑控制面板：預報員解讀 + 海上角度的海警/陸警研判告警 + 預報摘要。
 */
export function TyphoonControls() {
  const active = useTacticalStore((s) => s.activeTyphoon)
  const allTyphoons = useTacticalStore((s) => s.activeTyphoons)
  const cwaAlerts = useTacticalStore((s) => s.cwaAlerts)
  const setActiveTyphoon = useTacticalStore((s) => s.setActiveTyphoon)
  const own = useTacticalStore((s) => s.ownPosition)
  const tyScrubHours = useTacticalStore((s) => s.tyScrubHours)
  const setTyScrubHours = useTacticalStore((s) => s.setTyScrubHours)
  const cwa = isCwaConfigured()

  // 查詢中（尚未取得任何颱風資料）：顯示載入，不先塞示範。
  if (!active) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-slate-700 bg-tactical-panel/90 p-3">
        <div className="flex items-center gap-2 text-slate-300">
          <span className="animate-spin text-xl">🌀</span>
          <span className="text-sm font-semibold">查詢即時颱風資料中…</span>
        </div>
        <p className="text-[0.625rem] text-slate-500">
          優先抓中央氣象署 (CWA) 官方；無 Taiwan 相關颱風時改用 GDACS 全球即時。
        </p>
      </div>
    )
  }

  const ty = active
  const cur = currentPoint(ty)
  const fc = hasForecast(ty)
  const future = ty.track.filter((p) => p.hours > 0)
  const maxHours = future.reduce((m, p) => Math.max(m, p.hours), 0)
  const scrubInfo = tyScrubHours > 0 ? interpTyphoonAt(ty, tyScrubHours) : null
  const warn = estimateWarnings(ty)
  const cg = marineVerdict(warn)
  // 有 GPS 定位就以「您所在位置」研判方位/距離/侵襲機率，否則以台灣中心。
  const brief = own
    ? typhoonBrief(ty, { lat: own.lat, lng: own.lng }, '您所在位置')
    : typhoonBrief(ty)
  const designation = !ty.demo && isDesignation(ty.name)

  const threatColor =
    brief.threat === 'extreme'
      ? 'border-rose-500/60 bg-rose-500/10 text-rose-200'
      : brief.threat === 'high'
        ? 'border-orange-500/50 bg-orange-500/10 text-orange-200'
        : brief.threat === 'mid'
          ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
          : 'border-slate-600 bg-slate-800/50 text-slate-300'
  const cgBanner =
    cg.top === 'active'
      ? 'border-rose-500/60 bg-rose-500/15 text-rose-200'
      : cg.top === 'issue'
        ? 'border-orange-500/60 bg-orange-500/15 text-orange-200'
        : cg.top === 'watch'
          ? 'border-amber-500/50 bg-amber-500/10 text-amber-200'
          : 'border-tactical-green/40 bg-tactical-green/5 text-tactical-green'

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-slate-700 bg-tactical-panel/90 p-3">
      <div className="flex items-center gap-2">
        <span className="text-2xl">🌀</span>
        <div className="flex flex-col">
          <span className="text-base font-bold text-rose-400">
            {ty.name}{' '}
            <span className="text-xs font-normal text-slate-400">
              {ty.demo ? 'DEMO' : designation ? '國際編號' : ty.nameEn}
            </span>
          </span>
          <span className="text-[0.6875rem] text-slate-400">
            {cur.cat}｜近中心風 {cur.windKt} kt｜暴風半徑 {cur.galeRadiusKm} km
          </span>
        </div>
      </div>

      {/* 多颱同時活動：點任一顆＝切換選定（地圖變紅色完整＋可拖曳預判此顆） */}
      {allTyphoons.length > 1 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2">
          <div className="mb-1 text-[0.6875rem] font-semibold text-amber-300">
            🌀🌀 目前 {allTyphoons.length} 個颱風同時活動 · 點選要看哪顆（可拖曳預判）
          </div>
          <div className="flex flex-col gap-1">
            {allTyphoons.map((t, i) => {
              const c = currentPoint(t)
              const sel = active === t
              return (
                <button
                  key={t.nameEn + i}
                  onClick={() => {
                    setActiveTyphoon(t)
                    setTyScrubHours(0)
                  }}
                  className={`flex items-center justify-between gap-2 rounded border px-2 py-1 text-left text-[0.625rem] active:scale-95 ${
                    sel ? 'border-rose-400 bg-rose-500/15 text-rose-200' : 'border-slate-700 bg-slate-800/50 text-amber-200'
                  }`}
                >
                  <span className="truncate">
                    {sel ? '✅ 檢視中' : '👆 點選'}　{t.name}
                    {t.nameEn && t.nameEn !== t.name ? `（${t.nameEn}）` : ''}
                  </span>
                  <span className="shrink-0 font-mono text-slate-400">
                    {c.cat.replace(/\s.*/, '')}·{c.windKt}kt
                  </span>
                </button>
              )
            })}
          </div>
          <p className="mt-1 text-[0.5625rem] text-slate-500">選定的颱風＝地圖紅色完整預報＋可拖曳時間軸；其餘為琥珀色。</p>
        </div>
      )}

      {/* 只有觀測軌跡（GDACS 無官方預報時刻）：明講「這不是官方預報方向」，避免誤讀 */}
      {!fc && !ty.demo && (
        <div className="rounded-lg border border-slate-500/50 bg-slate-700/30 p-2 text-[0.6875rem] leading-relaxed text-slate-200">
          🧭 <b>紅線＝已行經觀測軌跡（GDACS）、紅色🌀＝現在位置。</b>
          {ty.estTrack && ty.estTrack.length ? (
            <>
              {' '}
              <b className="text-tactical-cyan">青色虛線＝簡易外推預測</b>（用近期移動方向×速度等速外推，
              <b>颱風常轉向，僅供概略參考</b>）。
            </>
          ) : null}
          {cwa
            ? ' 官方預報路徑待中央氣象署發布海警/陸警後，會自動切換為 CWA 官方版並可拖曳預判。'
            : ' 要看官方預報路徑，請到 ⚙️ 設定填中央氣象署 CWA 授權碼（發布警報時才有官方路徑）。'}
        </div>
      )}

      {/* 時間軸拖曳：一進颱風就在最上方，拖它看「+N 小時」暴風圈預判位置 */}
      {maxHours > 0 && (
        <div className="rounded-lg border border-tactical-cyan/40 bg-tactical-cyan/10 p-2">
          <div className="mb-1 flex items-center justify-between">
            <label className="text-[0.6875rem] font-semibold text-tactical-cyan">⏱ 拖曳看暴風圈預判位置</label>
            <span className="font-mono text-[0.6875rem] text-tactical-cyan">
              {tyScrubHours === 0
                ? '現在'
                : scrubInfo
                  ? `${fmtDayHour(Date.now() + scrubInfo.hours * 3600000)} · +${Math.round(scrubInfo.hours)}h · ${scrubInfo.windKt}kt`
                  : `+${tyScrubHours}h`}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={maxHours}
            step={1}
            value={tyScrubHours}
            onChange={(e) => setTyScrubHours(Number(e.target.value))}
            className="w-full accent-cyan-400"
          />
          <div className="mt-0.5 flex justify-between font-mono text-[0.5625rem] text-slate-500">
            <span>現在</span>
            <span className="text-tactical-cyan">拖曳 → 青色圈沿路徑移動</span>
            <span>+{maxHours}h</span>
          </div>
        </div>
      )}

      {/* 預報員解讀（白話摘要）*/}
      <div className={`rounded-lg border p-2 ${threatColor}`}>
        <div className="mb-1 flex items-center gap-1 text-[0.6875rem] font-bold">
          <span>👮</span> 預報員解讀
          <span className="ml-auto text-[0.5625rem] font-normal opacity-70">
            {own ? '依您 GPS 位置' : '依台灣中心（開 📍 定位更貼身）'}
          </span>
        </div>
        <p className="text-[0.6875rem] leading-relaxed">{brief.headline}</p>
        <p className="mt-1 text-[0.6875rem] font-semibold">👉 {brief.advice}</p>
        {/* 併入 CWA 目前生效警特報（官方，海上相關優先），讓解讀更完整 */}
        {cwaAlerts && cwaAlerts.length > 0 && (
          <div className="mt-1.5 rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-[0.625rem] leading-relaxed text-rose-100">
            🚨 中央氣象署目前生效：
            {cwaAlerts
              .slice(0, 4)
              .map((a) => `${a.phenomena}${a.significance || ''}`)
              .join('、')}
            {cwaAlerts.length > 4 ? ` 等 ${cwaAlerts.length} 項` : ''}
            <span className="text-rose-300/80">（詳見畫面上方 🚨 小卡）</span>
          </div>
        )}
      </div>

      {/* 海上角度 · 警報研判告警 */}
      <div className={`rounded-lg border p-2 ${cgBanner}`}>
        <div className="mb-1 text-[0.6875rem] font-bold">🛟 海上研判 · 本國警報告警（依路徑推估）</div>
        <div className="flex flex-col gap-1 text-[0.6875rem]">
          <div className="flex items-start justify-between gap-2">
            <span className="shrink-0 text-sky-300">🌊 海上警報</span>
            <span className={`text-right ${VERDICT_STYLE[cg.sea.level]}`}>{cg.sea.text}</span>
          </div>
          <div className="flex items-start justify-between gap-2">
            <span className="shrink-0 text-rose-300">🏝 陸上警報</span>
            <span className={`text-right ${VERDICT_STYLE[cg.land.level]}`}>{cg.land.text}</span>
          </div>
          <p className="mt-1 rounded bg-black/20 px-2 py-1 text-[0.6875rem] font-semibold leading-relaxed">
            🚔 {cg.advice}
          </p>
          <div className="text-[0.5625rem] text-slate-500">
            暴風圈邊緣距海岸最近約 {Math.round(warn.closestGapKm)} km｜研判非官方，實際以中央氣象署發布為準
          </div>
        </div>
      </div>

      {/* 預報摘要 */}
      {future.length > 0 && (
        <div className="grid grid-cols-3 gap-1.5">
          {future.slice(0, 6).map((p) => (
            <div
              key={p.hours}
              className="flex flex-col items-center rounded-md border border-rose-500/30 bg-rose-500/5 px-1 py-1.5"
            >
              <span className="text-[0.5625rem] font-semibold text-amber-300">{fmtDay(Date.now() + p.hours * 3600000)}</span>
              <span className="font-mono text-xs font-bold text-rose-300">+{p.hours}h</span>
              <span className="text-[0.625rem] text-slate-400">{p.windKt} kt</span>
              <span className="text-[0.5625rem] text-slate-500">{p.galeRadiusKm} km</span>
            </div>
          ))}
        </div>
      )}

      {/* 簡易外推預測摘要（青色，非官方）——只有無官方預報時才有 */}
      {!fc && ty.estTrack && ty.estTrack.length > 0 && (
        <div>
          <div className="mb-1 text-[0.625rem] font-semibold text-tactical-cyan">🧭 簡易外推（非官方，颱風常轉向僅供概略參考）</div>
          <div className="grid grid-cols-4 gap-1.5">
            {ty.estTrack.map((p) => (
              <div
                key={p.hours}
                className="flex flex-col items-center rounded-md border border-tactical-cyan/30 bg-tactical-cyan/5 px-1 py-1.5"
              >
                <span className="text-[0.5625rem] font-semibold text-tactical-cyan">{fmtDay(Date.now() + p.hours * 3600000)}</span>
                <span className="font-mono text-xs font-bold text-cyan-300">+{p.hours}h</span>
                <span className="text-[0.5625rem] text-slate-500">外推</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {ty.demo ? (
        <p className="rounded-md bg-slate-800/60 px-2 py-1.5 text-[0.625rem] leading-relaxed text-slate-400">
          目前查無活躍颱風，顯示<b className="text-slate-300">示範</b>。有活躍颱風時會優先用
          <b className="text-slate-300">中央氣象署 CWA 命名（中文）</b>，其次 GDACS 國際編號。
        </p>
      ) : (
        <p className="rounded-md border border-tactical-green/30 bg-tactical-green/5 px-2 py-1.5 text-[0.625rem] leading-relaxed text-tactical-green">
          ✓ 即時資料：{cwa && !designation ? '中央氣象署 (CWA) 官方命名' : 'GDACS 全球即時'}。
          {designation && '（此系統中央氣象署尚未命名／非台灣近海，命名後會自動改用中文名）'}
        </p>
      )}
    </div>
  )
}
