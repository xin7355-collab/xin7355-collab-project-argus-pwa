import { useTacticalStore } from '../store/tacticalStore'
import { BASE_LABELS, type BaseLayerId } from '../lib/baseLayers'

const BASES: BaseLayerId[] = ['dark', 'nlsc', 'nlscPhoto', 'satColor', 'esri', 'sentinel2', 'sentinel1']

/** 各底圖的「影像時效」說明——讓海上清楚知道看到的不是即時單日影像。 */
const BASE_VINTAGE: Record<BaseLayerId, string> = {
  dark: '向量地圖 · 無影像日期',
  nlsc: '向量電子地圖 · 無影像',
  nlscPhoto: '正射影像鑲嵌 · 非單一日期（定期更新）',
  satColor: 'Sentinel-2 2023 無雲年度合成 · 非即時',
  esri: '高解析空拍鑲嵌 · 免金鑰 · 非單一日期',
  sentinel2: '近 120 天最新真彩 · 大船白亮點 · 需 Instance ID',
  sentinel1: '近 30 天最新雷達 · 穿雲夜視看船 · 需 Instance ID',
}

/**
 * 統一圖層視窗（🗂️）：分類 + 打勾管理所有跨模式圖層。
 * 底圖（單選）＋ 疊加圖層（複選：警戒線 / 天氣 / 自訂點位）。
 * 取代原本散落的 🗺️ 底圖鈕與領海鈕。
 */
export function LayerManager() {
  const baseLayer = useTacticalStore((s) => s.baseLayer)
  const setBaseLayer = useTacticalStore((s) => s.setBaseLayer)
  const showTerritorial = useTacticalStore((s) => s.showTerritorial)
  const setShowTerritorial = useTacticalStore((s) => s.setShowTerritorial)
  const showWind = useTacticalStore((s) => s.showWind)
  const setShowWind = useTacticalStore((s) => s.setShowWind)
  const showWindFarms = useTacticalStore((s) => s.showWindFarms)
  const setShowWindFarms = useTacticalStore((s) => s.setShowWindFarms)
  const showMedianLine = useTacticalStore((s) => s.showMedianLine)
  const setShowMedianLine = useTacticalStore((s) => s.setShowMedianLine)
  const showPorts = useTacticalStore((s) => s.showPorts)
  const setShowPorts = useTacticalStore((s) => s.setShowPorts)
  const showRainRadar = useTacticalStore((s) => s.showRainRadar)
  const setShowRainRadar = useTacticalStore((s) => s.setShowRainRadar)
  const showVisibility = useTacticalStore((s) => s.showVisibility)
  const setShowVisibility = useTacticalStore((s) => s.setShowVisibility)
  const showRestricted = useTacticalStore((s) => s.showRestricted)
  const setShowRestricted = useTacticalStore((s) => s.setShowRestricted)
  const showEnforceLine = useTacticalStore((s) => s.showEnforceLine)
  const setShowEnforceLine = useTacticalStore((s) => s.setShowEnforceLine)
  const showSeamark = useTacticalStore((s) => s.showSeamark)
  const setShowSeamark = useTacticalStore((s) => s.setShowSeamark)
  const showFairway = useTacticalStore((s) => s.showFairway)
  const setShowFairway = useTacticalStore((s) => s.setShowFairway)
  const showCable = useTacticalStore((s) => s.showCable)
  const setShowCable = useTacticalStore((s) => s.setShowCable)
  const showShoal = useTacticalStore((s) => s.showShoal)
  const setShowShoal = useTacticalStore((s) => s.setShowShoal)
  const showRadar = useTacticalStore((s) => s.showRadar)
  const setShowRadar = useTacticalStore((s) => s.setShowRadar)
  const radarSites = useTacticalStore((s) => s.radarSites)
  const radarLocked = useTacticalStore((s) => s.secureHasLock && !s.secureUnlocked)
  const showRepeater = useTacticalStore((s) => s.showRepeater)
  const setShowRepeater = useTacticalStore((s) => s.setShowRepeater)
  const repeaters = useTacticalStore((s) => s.repeaters)
  const showLookout = useTacticalStore((s) => s.showLookout)
  const setShowLookout = useTacticalStore((s) => s.setShowLookout)
  const lookouts = useTacticalStore((s) => s.lookouts)
  const poiHidden = useTacticalStore((s) => s.poiHidden)
  const setPoiHidden = useTacticalStore((s) => s.setPoiHidden)
  const poiPoints = useTacticalStore((s) => s.poiPoints)
  const clearAllOverlays = useTacticalStore((s) => s.clearAllOverlays)
  const openTool = useTacticalStore((s) => s.openTool)
  const setOpenTool = useTacticalStore((s) => s.setOpenTool)
  const open = openTool === 'layers'
  const setOpen = (v: boolean) => setOpenTool(v ? 'layers' : null)

  // 目前開啟的疊加圖層數（不含底圖；雷達鎖住時不計）
  const overlayCount =
    (showTerritorial ? 1 : 0) +
    (showWind ? 1 : 0) +
    (showWindFarms ? 1 : 0) +
    (showMedianLine ? 1 : 0) +
    (showPorts ? 1 : 0) +
    (showRainRadar ? 1 : 0) +
    (showVisibility ? 1 : 0) +
    (showRestricted ? 1 : 0) +
    (showEnforceLine ? 1 : 0) +
    (showSeamark ? 1 : 0) +
    (showFairway ? 1 : 0) +
    (showCable ? 1 : 0) +
    (showShoal ? 1 : 0) +
    (showRadar && !radarLocked ? 1 : 0) +
    (showRepeater ? 1 : 0) +
    (showLookout ? 1 : 0)

  return (
    <>
      {open && (
        <div className="pointer-events-auto fixed inset-0 z-[2000] flex items-end justify-center bg-black/60 p-3 pt-[calc(0.75rem+env(safe-area-inset-top))] md:items-center">
          <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl border border-slate-700 bg-tactical-bg p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-bold text-tactical-cyan">
                🗂️ 圖層{overlayCount > 0 && <span className="ml-1.5 text-[0.6875rem] font-normal text-slate-400">（開啟 {overlayCount}）</span>}
              </h2>
              <div className="flex items-center gap-2">
                {overlayCount > 0 && (
                  <button
                    onClick={clearAllOverlays}
                    className="rounded border border-slate-600 px-2 py-1 text-[0.625rem] text-slate-300 active:scale-95"
                  >
                    全部關閉
                  </button>
                )}
                <button onClick={() => setOpen(false)} className="text-slate-400 active:scale-95">✕</button>
              </div>
            </div>

            {/* 底圖（單選）*/}
            <div className="mb-3">
              <div className="mb-1.5 text-[0.6875rem] font-semibold text-slate-400">🗺️ 底圖（擇一）</div>
              <div className="grid grid-cols-2 gap-1.5">
                {BASES.map((id) => (
                  <button
                    key={id}
                    onClick={() => setBaseLayer(id)}
                    className={`flex flex-col gap-0.5 rounded-lg border px-2 py-2 text-left active:scale-95 ${
                      baseLayer === id
                        ? 'border-tactical-cyan bg-tactical-cyan/15 text-tactical-cyan'
                        : 'border-slate-700 bg-slate-900/50 text-slate-300'
                    }`}
                  >
                    <span className="text-[0.6875rem] font-semibold">
                      {baseLayer === id ? '● ' : '○ '}
                      {BASE_LABELS[id]}
                    </span>
                    <span className="text-[0.5625rem] leading-tight text-slate-400">{BASE_VINTAGE[id]}</span>
                  </button>
                ))}
              </div>
              <p className="mt-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 p-1.5 text-[0.625rem] leading-relaxed text-amber-200">
                ⚠️ 四種底圖都是<b>固定合成圖／向量圖，不是即時、也非單一日期</b>——
                <b>無法</b>用來判讀「某天海上有沒有那艘船」。要看<b>特定日期</b>的海上船隻，
                請切「🌤️ 沿岸光學」模式：可選日期，且會顯示影像<b>實際拍攝日</b>（需先在 ⚙️ 設定填 Sentinel Instance ID）。
              </p>
            </div>

            {/* 疊加圖層（複選，分類）*/}
            <div className="flex flex-col gap-2.5">
              {/* 界線 / 管制 */}
              <div>
                <div className="mb-1.5 text-[0.6875rem] font-semibold text-slate-400">⚖️ 界線 / 管制</div>
                <div className="flex flex-col gap-1.5">
                  <LayerCheck
                    label="🚧 領海基線 / 12浬 / 24浬"
                    sub="領海、鄰接區參考線（判斷船隻是否進入我領海）"
                    checked={showTerritorial}
                    onToggle={() => setShowTerritorial(!showTerritorial)}
                  />
                  <LayerCheck
                    label="🚩 台灣海峽中線（示意）"
                    sub="橫貫海峽的越界態勢監控參考線（非官方劃界）"
                    checked={showMedianLine}
                    onToggle={() => setShowMedianLine(!showMedianLine)}
                  />
                  <LayerCheck
                    label="🚫 金馬禁／限制水域（示意）"
                    sub="金門/馬祖/烏坵/東引 禁止(近岸)＋限制(外緣)水域；處置大陸船越界"
                    checked={showRestricted}
                    onToggle={() => setShowRestricted(!showRestricted)}
                  />
                  <LayerCheck
                    label="📏 暫定執法線（示意）"
                    sub="台日漁業協議外緣、台菲巴士海峽中線；對外漁業執法邊界態勢"
                    checked={showEnforceLine}
                    onToggle={() => setShowEnforceLine(!showEnforceLine)}
                  />
                </div>
              </div>

              {/* 設施 / 港口 */}
              <div>
                <div className="mb-1.5 text-[0.6875rem] font-semibold text-slate-400">🏗️ 設施 / 港口</div>
                <div className="flex flex-col gap-1.5">
                  <LayerCheck
                    label="🌀 離岸風電場"
                    sub="西部外海離岸風電場示意範圍＋風機（作業區/限制航行/避碰熱點）"
                    checked={showWindFarms}
                    onToggle={() => setShowWindFarms(!showWindFarms)}
                  />
                  <LayerCheck
                    label="⚓ 主要漁港／避風港"
                    sub="全台主要漁港/商港（救難後送、就近調度、颱風避風）"
                    checked={showPorts}
                    onToggle={() => setShowPorts(!showPorts)}
                  />
                </div>
              </div>

              {/* 航海參考 */}
              <div>
                <div className="mb-1.5 text-[0.6875rem] font-semibold text-slate-400">🧭 航海參考</div>
                <div className="flex flex-col gap-1.5">
                  <LayerCheck
                    label="🚢 航道／分道通航"
                    sub="OSM 航道/TSS 航線；研判可疑船是否偏離正常商船動線"
                    checked={showFairway}
                    onToggle={() => setShowFairway(!showFairway)}
                  />
                  <LayerCheck
                    label="⚡ 海底電纜"
                    sub="OSM 海底電纜路由（洋紅線）；電纜保護區/禁拋錨、監控越界船拋錨損纜"
                    checked={showCable}
                    onToggle={() => setShowCable(!showCable)}
                  />
                  <LayerCheck
                    label="🏖️ 沙洲／淺灘"
                    sub="外傘頂洲等沙洲淺灘（OSM＋內建）；擱淺危險，會隨潮汐堆積移動"
                    checked={showShoal}
                    onToggle={() => setShowShoal(!showShoal)}
                  />
                  <LayerCheck
                    label="🧭 航海標記（OpenSeaMap）"
                    sub="燈塔/浮標/燈桿/水深等海圖記號（免金鑰）；縮小到約 50km 會消失（海圖磚特性）"
                    checked={showSeamark}
                    onToggle={() => setShowSeamark(!showSeamark)}
                  />
                </div>
              </div>

              {/* 天氣 / 海況 */}
              <div>
                <div className="mb-1.5 text-[0.6875rem] font-semibold text-slate-400">🌦️ 天氣 / 海況</div>
                <div className="flex flex-col gap-1.5">
                  <LayerCheck
                    label="🌧️ 即時降雨雷達"
                    sub="全球雷達回波（RainViewer，免金鑰）；出海避雷雨用"
                    checked={showRainRadar}
                    onToggle={() => setShowRainRadar(!showRainRadar)}
                  />
                  <LayerCheck
                    label="🌬️ 風向風速（海況）"
                    sub="即時風向風速箭頭（Open-Meteo，免金鑰）；平移地圖自動更新"
                    checked={showWind}
                    onToggle={() => setShowWind(!showWind)}
                  />
                  <LayerCheck
                    label="🌫️ 能見度／霧況"
                    sub="即時能見度上色（Open-Meteo，免金鑰）；濃霧最紅＝目視/瞭望偵蒐距離受限，倚重雷達/AIS"
                    checked={showVisibility}
                    onToggle={() => setShowVisibility(!showVisibility)}
                  />
                </div>
              </div>

              {/* 自訂 / 私密 */}
              <div>
                <div className="mb-1.5 text-[0.6875rem] font-semibold text-slate-400">🚩 自訂 / 私密（只存本機）</div>
                <div className="flex flex-col gap-1.5">
                  <LayerCheck
                    label={`🚩 自訂點位（${poiPoints.length}）`}
                    sub="檢查據點等自訂據點；取消勾選＝一鍵全部隱藏（旁人看不到）"
                    checked={!poiHidden}
                    onToggle={() => setPoiHidden(!poiHidden)}
                  />
                  {!radarLocked && (
                    <LayerCheck
                      label={`📡 雷達涵蓋（${radarSites.length}）`}
                      sub="自建雷達站涵蓋圈＋死角（依雷達地平線/目標高度）；用右側 📡 鈕新增管理"
                      checked={showRadar}
                      onToggle={() => setShowRadar(!showRadar)}
                    />
                  )}
                  <LayerCheck
                    label={`📻 無線電覆蓋（${repeaters.length}）`}
                    sub="中繼台通訊覆蓋圈（座標/天線高/頻率/瓦數）；用右側 📻 鈕新增管理"
                    checked={showRepeater}
                    onToggle={() => setShowRepeater(!showRepeater)}
                  />
                  <LayerCheck
                    label={`👁️ 瞭望哨視域（${lookouts.length}）`}
                    sub="沿岸觀測點可視範圍＋地形死角（找非法越界小艇可鑽的縫）；用右側 👁️ 鈕新增管理"
                    checked={showLookout}
                    onToggle={() => setShowLookout(!showLookout)}
                  />
                </div>
              </div>
            </div>

            <p className="mt-3 text-[0.625rem] leading-relaxed text-slate-500">
              各模式專屬的疊層（例如 AIS 的夜間漁火/雷達暗船）仍在該模式的控制面板內開關。
            </p>
          </div>
        </div>
      )}
    </>
  )
}

function LayerCheck({
  label,
  sub,
  checked,
  onToggle,
}: {
  label: string
  sub: string
  checked: boolean
  onToggle: () => void
}) {
  return (
    <button
      onClick={onToggle}
      className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 text-left active:scale-95 ${
        checked ? 'border-tactical-cyan/60 bg-tactical-cyan/10' : 'border-slate-700 bg-slate-900/50'
      }`}
    >
      <span
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[0.625rem] font-bold ${
          checked ? 'border-tactical-cyan bg-tactical-cyan text-slate-900' : 'border-slate-600 text-transparent'
        }`}
      >
        ✓
      </span>
      <span className="flex flex-col">
        <span className={`text-xs font-semibold ${checked ? 'text-tactical-cyan' : 'text-slate-200'}`}>{label}</span>
        <span className="text-[0.625rem] leading-snug text-slate-400">{sub}</span>
      </span>
    </button>
  )
}
