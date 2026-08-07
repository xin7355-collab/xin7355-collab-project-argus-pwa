import { useState } from 'react'
import { useTacticalStore } from '../store/tacticalStore'
import { isSentinelConfigured } from '../lib/sentinel'
import { SatelliteQuickLinks } from './SatelliteQuickLinks'
import { parseCoord } from '../lib/coordParse'
import { CoordField } from './CoordField'
import { shareReport } from '../lib/report'
import { findRecentSentinelDate } from '../lib/sentinelCatalog'

/**
 * 光學模式的控制項：影像來源提示 + 雲量滑桿 + 歷史觀測日期。
 * 只在 optical 模式顯示，避免 UI 雜亂。
 */
export function OpticalControls() {
  const maxCloudCover = useTacticalStore((s) => s.maxCloudCover)
  const setMaxCloudCover = useTacticalStore((s) => s.setMaxCloudCover)
  const observationDate = useTacticalStore((s) => s.observationDate)
  const setObservationDate = useTacticalStore((s) => s.setObservationDate)
  const opticalSource = useTacticalStore((s) => s.opticalSource)
  const setOpticalSource = useTacticalStore((s) => s.setOpticalSource)
  const opticalRadar = useTacticalStore((s) => s.opticalRadar)
  const setOpticalRadar = useTacticalStore((s) => s.setOpticalRadar)
  const own = useTacticalStore((s) => s.ownPosition)
  const mapView = useTacticalStore((s) => s.mapView)
  const gotoCoord = useTacticalStore((s) => s.gotoCoord)
  const setStatus = useTacticalStore((s) => s.setStatus)
  const [findBusy, setFindBusy] = useState(false)
  const bumpScan = useTacticalStore((s) => s.bumpScan)
  const scanSensitivity = useTacticalStore((s) => s.scanSensitivity)
  const setScanSensitivity = useTacticalStore((s) => s.setScanSensitivity)
  const brightSpots = useTacticalStore((s) => s.brightSpots)
  const today = new Date().toISOString().slice(0, 10)
  const hd = isSentinelConfigured()

  // 座標查詢：輸入經緯度（可貼萬用格式）→ 地圖飛過去 + 影像連結以此為中心
  const [qLat, setQLat] = useState('')
  const [qLng, setQLng] = useState('')
  // 先試萬用解析（可把整串座標貼在緯度欄），失敗再退回兩欄十進位。
  const queried =
    parseCoord(`${qLat} ${qLng}`.trim()) ??
    (Number.isFinite(parseFloat(qLat)) && Number.isFinite(parseFloat(qLng))
      ? { lat: parseFloat(qLat), lng: parseFloat(qLng) }
      : null)
  const goToCoord = () => {
    if (queried && Math.abs(queried.lat) <= 90 && Math.abs(queried.lng) <= 180) {
      gotoCoord(queried.lat, queried.lng, 11)
      setStatus(`已跳到 ${queried.lat.toFixed(3)}, ${queried.lng.toFixed(3)}｜選日期看當時影像`)
    } else {
      setStatus('⚠ 座標格式錯誤（可用十進位/度分/度分秒，或用 📌 座標管理貼萬用格式）')
    }
  }
  const linkCenter = queried ?? own ?? undefined

  // 自動找最近有影像的日期：查 CDSE 目錄，找目前關注點上空最近一次過境（雲量夠低）
  const autoFindDate = async () => {
    if (findBusy) return
    const c = queried ?? own ?? mapView
    setFindBusy(true)
    setStatus('自動找影像：查詢 Sentinel-2 最近過境中…')
    try {
      const r = await findRecentSentinelDate(c.lat, c.lng, maxCloudCover)
      if (!r) {
        setStatus('自動找影像：近 45 天此區無 Sentinel-2 影像（可能常年多雲或非涵蓋帶）')
        return
      }
      setObservationDate(r.date)
      setStatus(
        r.cloudy
          ? `自動找影像：最近一次過境 ${r.date}（雲量 ${r.cloud}%，偏多雲；已跳到該日）`
          : `✅ 找到最近清晰影像 ${r.date}（雲量 ${r.cloud}%）——已跳到該日`,
      )
    } catch {
      setStatus('⚠ 自動找影像失敗（跨域被擋）；到 ⚙️ 設定填「邊緣 AI Worker 網址」即可改走代理繞過，或手動用「昨天/前天」往前挑')
    } finally {
      setFindBusy(false)
    }
  }

  const exportDetections = async () => {
    if (brightSpots.length === 0) return
    const lines = [`【阿爾戈斯 目標掃描清單】共 ${brightSpots.length} 個`]
    brightSpots.forEach((s, i) => {
      const tag = s.ais === 'none' ? '⚠無AIS' : s.ais === 'known' ? `✓已知(${s.aisName || 'AIS'})` : ''
      lines.push(`#${i + 1} ${tag} ${s.cls}｜~${Math.round(s.sizeM)}m｜${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}`)
    })
    lines.push('※ 亮點輔助分流，非確認身分；請並用雷達/目視。')
    const how = await shareReport(lines.join('\n'))
    setStatus(how === 'shared' ? '目標清單已分享' : how === 'copied' ? '目標清單已複製' : '⚠ 分享失敗')
  }

  const SRC_INFO: Record<string, string> = {
    esri: '高解析空拍鑲嵌 · 沿岸/島礁最銳利，但⚠外海是空的（黑）——外海請切每日/無雲/海底',
    eox: 'Sentinel-2 無雲真彩色 · 10m 乾淨平滑、含外海（年度合成，非每日）',
    nasa: 'VIIRS/MODIS 每日真彩色（等同 NASA Worldview）· 含外海每日雲況（可選歷史日期）',
    ocean: '海底地形（Esri Ocean）· 覆蓋外海：水深/海脊/淺灘，適合漁區/航道/暗礁',
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-700 bg-tactical-panel/80 p-3">
      <div className="rounded border border-slate-700 bg-slate-900/60 px-2 py-1.5 text-[0.6875rem] leading-relaxed">
        {hd ? (
          <span className="text-tactical-green">🛰️ 高解析度：{opticalRadar ? 'Sentinel-1 雷達（穿雲/夜視）' : 'Sentinel-2 真彩（10m）· 雲量過濾生效'}</span>
        ) : (
          <span className="text-tactical-cyan">🛰️ 免金鑰影像來源：{SRC_INFO[opticalSource]}</span>
        )}
      </div>

      {/* 使用者常見誤解三點：影像是「快照非即時」、解析度上限、雲只能靠雷達穿 */}
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-[0.625rem] leading-relaxed text-amber-100/90">
        <div className="mb-0.5 font-semibold text-amber-300">ℹ️ 看船前先懂三件事</div>
        <div>🕒 <b>這是「快照」不是即時</b>：畫面是衛星過境那一刻（約上午10–11時）的樣子，圖上的船是<b>那個時間</b>在那裡，不是現在。要即時船位請切 📡 AIS。</div>
        <div>🔬 <b>解析度上限 10m/像素</b>：小艇只佔 1–3 點，放到最大也不會更清楚（只是放大同樣的點，非新細節）。免費衛星沒有「每日又超清」的。</div>
        <div>☁️ <b>雲擋光學</b>：光學看不穿雲，多雲/夜間請按下方「☁️ 穿雲雷達」改用 Sentinel-1（雷達穿雲、日夜都行）。</div>
      </div>

      {/* 穿雲快切：多雲/夜間改用 Sentinel-1 雷達（同日期）。只有設 Instance ID 才有意義 */}
      {hd && (
        <div className="grid grid-cols-2 gap-1.5">
          <button
            onClick={() => setOpticalRadar(false)}
            className={`flex flex-col items-center rounded-lg border py-2 active:scale-95 ${
              !opticalRadar ? 'border-tactical-green bg-tactical-green/15 text-tactical-green' : 'border-slate-600 text-slate-300'
            }`}
          >
            <span className="text-sm font-bold">☀️ 真彩</span>
            <span className="text-[0.5625rem] opacity-80">Sentinel-2 · 晴天看船</span>
          </button>
          <button
            onClick={() => setOpticalRadar(true)}
            className={`flex flex-col items-center rounded-lg border py-2 active:scale-95 ${
              opticalRadar ? 'border-tactical-cyan bg-tactical-cyan/15 text-tactical-cyan' : 'border-slate-600 text-slate-300'
            }`}
          >
            <span className="text-sm font-bold">☁️ 穿雲雷達</span>
            <span className="text-[0.5625rem] opacity-80">Sentinel-1 · 雲天/夜間看船</span>
          </button>
        </div>
      )}

      {/* 「看特定日期那艘船」：座標 + 日期合成一區，地圖直接換成該日影像 */}
      <div className="rounded-lg border border-tactical-cyan/40 bg-tactical-cyan/5 p-2">
        <div className="mb-1 text-[0.6875rem] font-semibold text-tactical-cyan">
          🔎 看「案發當時那艘船」：① 座標 ② 日期
        </div>
        <CoordField onParsed={(la, ln) => { setQLat(String(la)); setQLng(String(ln)) }} />
        <div className="mt-1 flex items-center gap-1">
          <input
            inputMode="decimal"
            placeholder="緯度 24.5"
            value={qLat}
            onChange={(e) => setQLat(e.target.value)}
            className="w-0 flex-1 rounded border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-200"
          />
          <input
            inputMode="decimal"
            placeholder="經度 122.0"
            value={qLng}
            onChange={(e) => setQLng(e.target.value)}
            className="w-0 flex-1 rounded border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-200"
          />
          <button
            onClick={goToCoord}
            className="shrink-0 rounded border border-tactical-cyan bg-tactical-cyan/10 px-2 py-1.5 text-xs font-bold text-tactical-cyan active:scale-95"
          >
            ① 跳過去
          </button>
        </div>
        <label className="mb-1 mt-2 block text-[0.6875rem] font-semibold text-tactical-green">
          📅 ② 觀測日期（要看哪一天）
        </label>
        <input
          type="date"
          max={today}
          value={observationDate}
          onChange={(e) => setObservationDate(e.target.value)}
          className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-sm text-slate-200"
        />
        {/* 快捷：往前挑最近幾天（高解析衛星非每天過境，往前找有影像的那天） */}
        <div className="mt-1 flex flex-wrap gap-1">
          {([['昨天', 1], ['前天', 2], ['−3天', 3], ['−5天', 5], ['−7天', 7]] as const).map(([label, d]) => {
            const val = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10)
            return (
              <button
                key={d}
                onClick={() => setObservationDate(val)}
                className={`rounded border px-2 py-1 text-[0.625rem] active:scale-95 ${
                  observationDate === val ? 'border-tactical-cyan bg-tactical-cyan/15 text-tactical-cyan' : 'border-slate-600 text-slate-300'
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>
        <button
          onClick={autoFindDate}
          disabled={findBusy}
          className="mt-1.5 w-full rounded-lg border border-tactical-green/60 bg-tactical-green/10 py-2 text-xs font-bold text-tactical-green active:scale-95 disabled:opacity-50"
        >
          {findBusy ? '⏳ 查詢中…' : '🔎 自動找最近有影像的日期（雲量夠低）'}
        </button>
        <p className="mt-1 text-[0.625rem] leading-relaxed text-slate-500">
          {hd
            ? '✅ 有 Sentinel 金鑰：地圖顯示「所選日期往回 10 天內、雲最少的一景」Sentinel-2（10m）真實影像（同一點約每 5 天才過境，故非剛好當天；挑最少雲才看得到海面）。要精準鎖定某天那一景按上方 🔎 自動找；整片全黑=近日皆濃雲，改用 ☁️ 穿雲雷達。'
            : '免金鑰：地圖顯示該日 MODIS（250m，只看得到大船/船隊）。要 10m 全解析，貼 Sentinel 金鑰，或用本頁最下方「外部全解析衛星」連結。'}
        </p>
      </div>

      {/* 免金鑰四選一：高解析空拍(陸) / 無雲S2 / 每日MODIS / 海底地形(外海) */}
      {!hd && (
        <div className="grid grid-cols-4 gap-1 rounded-lg border border-slate-700 p-1">
          {(
            [
              ['esri', '高解析', '陸/岸'],
              ['eox', '無雲', 'S2·10m'],
              ['nasa', '每日', 'MODIS'],
              ['ocean', '海底', '外海'],
            ] as const
          ).map(([id, t1, t2]) => (
            <button
              key={id}
              onClick={() => setOpticalSource(id)}
              className={`flex flex-col items-center rounded py-1.5 active:scale-95 ${
                opticalSource === id ? 'bg-tactical-cyan/20 text-tactical-cyan' : 'text-slate-400'
              }`}
            >
              <span className="text-xs font-bold">{t1}</span>
              <span className="text-[0.5625rem] opacity-70">{t2}</span>
            </button>
          ))}
        </div>
      )}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="text-xs font-semibold text-tactical-green">☁ 最大雲量</label>
          <span className="font-mono text-sm text-tactical-cyan">{maxCloudCover}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={maxCloudCover}
          onChange={(e) => setMaxCloudCover(Number(e.target.value))}
          className="w-full accent-cyan-400"
        />
        <p className="mt-1 text-[0.625rem] text-slate-500">
          {hd
            ? '預設 100%＝不硬篩，自動挑近10日最少雲的一景（最看得到海面）。往左調＝只保留更晴朗的影像，但多雲季可能變全黑。'
            : '雲量過濾需 Sentinel 金鑰；NASA 免費影像為每日合成'}
        </p>
      </div>

      {/* 亮點掃描：在暗海上標選疑似船/物體 */}
      <div className="rounded-lg border border-tactical-cyan/40 bg-tactical-cyan/5 p-2">
        <button
          onClick={bumpScan}
          className="w-full rounded-lg border border-tactical-cyan bg-tactical-cyan/15 py-2 text-sm font-bold text-tactical-cyan active:scale-95"
        >
          🔍 掃描並標注目標{brightSpots.length ? `（${brightSpots.length}）` : ''}
        </button>
        <div className="mt-2 flex items-center gap-2">
          <span className="shrink-0 text-[0.6875rem] text-slate-400">靈敏度</span>
          <input
            type="range"
            min={2}
            max={4.5}
            step={0.1}
            // 拉桿右=更敏感（門檻低）；顯示值與寫入值都反向，thumb 才不會跳
            value={6.5 - scanSensitivity}
            onChange={(e) => setScanSensitivity(6.5 - Number(e.target.value))}
            className="w-full accent-cyan-400"
          />
          <span className="shrink-0 font-mono text-[0.625rem] text-slate-500">
            {scanSensitivity <= 2.6 ? '高' : scanSensitivity >= 3.6 ? '低' : '中'}
          </span>
        </div>
        {brightSpots.length > 0 && (
          <>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[0.625rem] text-slate-400">
                共 {brightSpots.length} 目標
                {brightSpots.some((s) => s.ais === 'none') &&
                  `，⚠${brightSpots.filter((s) => s.ais === 'none').length} 無AIS`}
              </span>
              <button onClick={exportDetections} className="text-[0.625rem] text-tactical-green active:scale-95">
                📤 匯出目標清單
              </button>
            </div>
            <div className="mt-1 flex max-h-32 flex-col gap-0.5 overflow-y-auto">
              {brightSpots.slice(0, 16).map((s, i) => {
                const col =
                  s.ais === 'none' ? 'text-tactical-alert' : s.ais === 'known' ? 'text-tactical-green' : 'text-tactical-cyan'
                return (
                  <button
                    key={i}
                    onClick={() => gotoCoord(s.lat, s.lng, 14)}
                    className="flex items-center gap-2 rounded border border-slate-700 bg-slate-800/60 px-2 py-1 text-left active:scale-95"
                  >
                    <span className={`font-mono text-[0.6875rem] font-bold ${col}`}>#{i + 1}</span>
                    <span className="flex-1 truncate text-[0.625rem] text-slate-300">
                      {s.ais === 'none' ? '⚠無AIS' : s.ais === 'known' ? `✓${s.aisName || 'AIS'}` : ''} {s.cls}
                    </span>
                    <span className="shrink-0 font-mono text-[0.5625rem] text-slate-500">~{Math.round(s.sizeM)}m</span>
                  </button>
                )
              })}
            </div>
          </>
        )}
        <p className="mt-1 text-[0.625rem] leading-relaxed text-slate-500">
          分析目前畫面：把暗海上突出目標畫框標注、估尺度分類，並與 AIS 比對——
          <b className="text-tactical-alert">紅框=無AIS訊號(可疑優先查)</b>、綠框=已知AIS。
          <b className="text-slate-400">輔助分流</b>，非確認身分；白浪/反光也可能中。
        </p>
      </div>

      {/* 以查詢座標（或我的位置）為中心，鎖定觀測日期開免費衛星檔案 */}
      <SatelliteQuickLinks
        lat={linkCenter?.lat}
        lng={linkCenter?.lng}
        date={observationDate}
        title={`🛰️ 外部全解析衛星檔案（${observationDate} · Sentinel 雷達/光學）`}
      />
    </div>
  )
}
