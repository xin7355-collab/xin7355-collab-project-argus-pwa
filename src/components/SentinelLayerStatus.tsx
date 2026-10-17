import { useTacticalStore } from '../store/tacticalStore'
import { isSentinelConfigured } from '../lib/sentinel'

/**
 * Sentinel 組態檢查結果＋（需要時）加雷達圖層的手機步驟。
 * 放在用得到的地方（AIS 雷達暗船、⚙️ 設定），不用使用者自己猜為什麼一片空白。
 */
export function SentinelLayerStatus({ need = 'sar' }: { need?: 'sar' | 'optical' }) {
  const c = useTacticalStore((s) => s.sentinelCheck)
  const recheck = useTacticalStore((s) => s.recheckSentinel)
  if (!isSentinelConfigured() || c.status === 'idle') return null
  // 設定頁同時放兩張：ID 錯、連不到這類「整個組態」的訊息只讓雷達那張講，不重複
  if (need === 'optical' && c.status !== 'ok') return null

  const missing = c.status === 'ok' && !c[need]
  const bad = c.status === 'badId' || c.status === 'error' || missing
  const tone =
    c.status === 'checking' || c.status === 'unreachable'
      ? 'border-slate-600 bg-slate-900/50 text-slate-400'
      : bad
        ? 'border-amber-500/60 bg-amber-500/10 text-amber-200'
        : 'border-tactical-green/50 bg-tactical-green/5 text-tactical-green'

  return (
    <div className={`flex flex-col gap-1.5 rounded border p-2 text-[0.625rem] leading-relaxed ${tone}`}>
      {c.status === 'ok' && !missing ? (
        <span>
          ✅ 組態檢查通過：{need === 'sar' ? '雷達' : '光學'}用「<b className="font-mono">{c[need]}</b>」圖層
        </span>
      ) : missing ? (
        <span>
          ⚠ 你的 Sentinel 組態裡沒有{need === 'sar' ? '雷達（Sentinel-1）' : '光學真彩（Sentinel-2）'}圖層
          （現有：{c.layers.join('、') || '無'}）。
        </span>
      ) : (
        <span>{c.message}</span>
      )}
      {missing && need === 'sar' && <AddRadarLayerSteps />}
      {c.status !== 'checking' && (bad || c.status === 'unreachable') && (
        <button
          onClick={recheck}
          className="self-start rounded border border-current px-2 py-1 font-bold active:scale-95"
        >
          🔄 改好了，重新檢查
        </button>
      )}
    </div>
  )
}

/** 在 CDSE 組態加一個 Sentinel-1 雷達圖層。依官方說明（QGIS／S1GRD 頁，2026-10 讀過）。 */
function AddRadarLayerSteps() {
  return (
    <details open className="rounded border border-amber-500/30 bg-slate-950/40 p-1.5 text-slate-300">
      <summary className="cursor-pointer font-semibold text-amber-200">📱 怎麼加雷達圖層（手機約 3 分鐘）</summary>
      <ol className="mt-1 flex list-decimal flex-col gap-1 pl-4">
        <li>
          開{' '}
          <a
            href="https://shapps.dataspace.copernicus.eu/dashboard/#/"
            target="_blank"
            rel="noreferrer"
            className="break-all font-mono text-tactical-cyan underline"
          >
            shapps.dataspace.copernicus.eu/dashboard
          </a>
          ，用 Copernicus 帳號登入。
        </li>
        <li>
          左側選 <b>Configuration Utility</b>，點你在用的那個組態（Instance ID 跟 App 裡填的一樣）。
        </li>
        <li>
          按 <b>New Layer</b>，<b>Name</b> 填 <b className="font-mono text-tactical-cyan">SAR-VV</b>
          （名字其實不用一字不差，App 會自己找）。
        </li>
        <li>
          <b>Source</b> 選 <b>Sentinel-1 GRD</b>。
        </li>
        <li>
          <b>Data Processing</b> 按鉛筆圖示，從內建的選一個 <b>VV</b> 開頭、<b>decibel</b>（分貝）的。
        </li>
        <li>存檔，回 App 按下面「重新檢查」。</li>
      </ol>
      <p className="mt-1 text-slate-500">
        查證範圍：網址、Configuration Utility、New Layer、Name／Source、鉛筆選內建處理方式，都是官方說明寫的。
        選單裡的確切字樣（例如 Source 清單是寫「Sentinel-1 GRD」還是「S1GRD」）跟存檔鈕的名稱沒實際點過，
        畫面若不同，挑意思最接近的。
      </p>
    </details>
  )
}
