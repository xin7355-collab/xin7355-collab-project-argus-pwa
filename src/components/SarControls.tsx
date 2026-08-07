import { useTacticalStore } from '../store/tacticalStore'
import { isEdgeAiConfigured } from '../lib/edgeAI'
import { getConfig } from '../lib/config'

/**
 * 雷達盲搜模式的控制項：框選按鈕 + AI 狀態。
 */
export function SarControls() {
  const selecting = useTacticalStore((s) => s.selecting)
  const setSelecting = useTacticalStore((s) => s.setSelecting)
  const aiStatus = useTacticalStore((s) => s.aiStatus)
  const detections = useTacticalStore((s) => s.detections)
  const edgeReady = isEdgeAiConfigured()
  const edgeUrl = getConfig().edgeAiUrl

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-700 bg-tactical-panel/80 p-3">
      <button
        onClick={() => setSelecting(!selecting)}
        className={[
          'rounded-lg border px-3 py-3 text-sm font-bold transition-all active:scale-95',
          selecting
            ? 'animate-pulse-alert border-tactical-alert bg-tactical-alert/20 text-tactical-alert'
            : 'border-tactical-cyan bg-tactical-cyan/10 text-tactical-cyan',
        ].join(' ')}
      >
        {selecting ? '✋ 拖曳框選海域中…（點此取消）' : '🎯 框選海域啟動 AI 辨識'}
      </button>

      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-400">AI 狀態</span>
        <span className="font-mono">
          {aiStatus === 'idle' && <span className="text-slate-500">待命</span>}
          {aiStatus === 'loading' && <span className="text-tactical-cyan">辨識中…</span>}
          {aiStatus === 'done' && (
            <span className="text-tactical-green">完成 · {detections?.features.length ?? 0} 目標</span>
          )}
          {aiStatus === 'error' && <span className="text-tactical-alert">連線失敗</span>}
        </span>
      </div>

      {edgeReady ? (
        <div className="flex flex-col gap-1 rounded border border-tactical-green/40 bg-tactical-green/5 p-2">
          <p className="text-[0.6875rem] font-semibold text-tactical-green">
            ✅ 已連接邊緣 AI Worker
          </p>
          <p className="break-all font-mono text-[0.5625rem] text-slate-500">{edgeUrl}</p>
          <p className="text-[0.625rem] leading-relaxed text-slate-400">
            框選海域會送到你的 Cloudflare Worker 辨識。
            <b className="text-amber-400/90">
              目前 Worker 未設 CDSE_TOKEN，回傳的是示範點
            </b>
            ；要真實 SAR 影像辨識，去 Copernicus 申請 token 後在 Worker 加 Secret 即可。
          </p>
        </div>
      ) : (
        <>
          <p className="text-[0.625rem] leading-relaxed text-slate-500">
            框選海域即可用「示範 AI」找出疑似船隻——不用設定就能玩。
          </p>
          <p className="text-[0.625rem] leading-relaxed text-amber-500/80">
            目前為<b>示範 AI 偵測</b>（免設定）。想接<b>真實 AI</b>需先部署
            Cloudflare Worker，再到右上 <b>⚙️ 設定 → 「邊緣 AI Worker 網址」</b>貼上網址。
            屬進階選配，沒有也能用示範。
          </p>
        </>
      )}
    </div>
  )
}
