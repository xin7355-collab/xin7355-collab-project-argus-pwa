import { satelliteLinks } from '../lib/satelliteLinks'

/**
 * 免費衛星「最新過境」一鍵查詢。把此位置丟進各大免費衛星檔案瀏覽器
 * （Sentinel-1 雷達 / Sentinel-2 / Landsat / VIIRS / MODIS）與 AIS 平台。
 * 無座標時用台灣東部海域為預設中心。
 */
export function SatelliteQuickLinks({
  lat = 24.5,
  lng = 122.0,
  date,
  title = '🛰️ 最新免費衛星過境（此位置）',
}: {
  lat?: number
  lng?: number
  date?: string
  title?: string
}) {
  const links = satelliteLinks(lat, lng, date)
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-slate-700 bg-slate-900/40 p-2">
      <div className="text-[0.6875rem] font-semibold text-tactical-cyan">{title}</div>
      {links.map((l) => (
        <a
          key={l.label}
          href={l.url}
          target="_blank"
          rel="noreferrer"
          className="flex items-start gap-2 rounded border border-slate-700 bg-slate-800/60 px-2 py-1.5 active:scale-95"
        >
          <span className="text-base leading-none">{l.icon}</span>
          <span className="flex flex-col">
            <span className="text-xs font-bold text-slate-200">{l.label} ↗</span>
            <span className="text-[0.625rem] leading-snug text-slate-400">{l.sub}</span>
          </span>
        </a>
      ))}
      <div className="rounded-md border border-tactical-green/25 bg-tactical-green/5 px-2 py-1.5 text-[0.625rem] leading-relaxed text-slate-400">
        <b className="text-tactical-green">其實 App 內就有對應功能（免出去）：</b>
        <br />• Worldview 每日影像 → 光學模式選「<b className="text-slate-300">每日</b>」來源（已升級 VIIRS）
        <br />• Copernicus 雷達 → <b className="text-slate-300">雷達盲搜</b>模式（貼 Sentinel 金鑰啟用）
        <br />• MarineTraffic 船位 → <b className="text-slate-300">AIS 識別</b>模式（貼 AISStream 免費金鑰，且無 cookie 牆）
        <br />上方連結是用來翻「<b className="text-slate-300">全解析歷史檔案</b>」的加值，不是唯一途徑。
      </div>
      <p className="text-[0.625rem] leading-relaxed text-slate-500">
        誠實提醒：小船（&lt;10m）免費衛星多半解析不到，且非即時（重訪數天）。
        真正定位靠<b className="text-slate-400">漂流預判＋就近船隻目視</b>。
      </p>
    </div>
  )
}
