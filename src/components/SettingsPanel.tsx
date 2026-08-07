import { useRef, useState } from 'react'
import { getConfig, saveConfig, isCwaConfigured } from '../lib/config'
import { fetchCwaJson } from '../lib/cwa'
import { downloadBackup, restoreBackup } from '../lib/backup'
import { setSecurePin, clearSecurePin } from '../lib/secure'
import { UI_SCALES } from '../lib/uiScale'
import { useTacticalStore } from '../store/tacticalStore'

/**
 * 設定面板：在 App 裡直接貼金鑰（存 localStorage），免去改 Vercel 環境變數
 * 再重新部署的麻煩。存檔後重載頁面讓所有圖層讀到新金鑰。
 */
export function SettingsPanel() {
  const [open, setOpen] = useState(false)
  const [cfg, setCfg] = useState(getConfig())
  const secureHasLock = useTacticalStore((s) => s.secureHasLock)
  const setSecureHasLock = useTacticalStore((s) => s.setSecureHasLock)
  const uiScale = useTacticalStore((s) => s.uiScale)
  const setUiScale = useTacticalStore((s) => s.setUiScale)
  const secureUnlocked = useTacticalStore((s) => s.secureUnlocked)
  const setSecureUnlocked = useTacticalStore((s) => s.setSecureUnlocked)
  const setSecurePromptOpen = useTacticalStore((s) => s.setSecurePromptOpen)
  const [pin1, setPin1] = useState('')
  const [pin2, setPin2] = useState('')

  const fileRef = useRef<HTMLInputElement>(null)

  const savePin = async () => {
    if (pin1.length < 4) {
      alert('PIN 至少 4 碼')
      return
    }
    if (pin1 !== pin2) {
      alert('兩次輸入不一致')
      return
    }
    const ok = await setSecurePin(pin1)
    if (!ok) {
      alert('⚠ PIN 設定失敗（瀏覽器儲存空間不足或非安全連線）。機敏鎖未啟用，請稍後再試。')
      return
    }
    setSecureHasLock(true)
    setSecureUnlocked(true) // 設好先解鎖，方便你當下使用
    setPin1('')
    setPin2('')
    alert('機敏 PIN 已設定。雷達等機敏功能現在起需 PIN 才叫得出來；重開 App 會自動鎖回。\n解鎖手勢：狀態列「版本號」連點 5 下。')
  }
  const removePin = () => {
    if (!confirm('確定移除機敏鎖？移除後雷達功能會恢復成一般顯示。')) return
    clearSecurePin()
    setSecureHasLock(false)
    setSecureUnlocked(false)
  }

  const save = () => {
    saveConfig(cfg)
    location.reload() // 重載讓 WMS/AIS/AI 圖層讀到新金鑰
  }
  const doImport = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const n = restoreBackup(String(reader.result))
        alert(`已還原 ${n} 項設定/座標，將重新載入。`)
        location.reload()
      } catch (e) {
        alert(`匯入失敗：${(e as Error).message}`)
      }
    }
    reader.readAsText(file)
  }

  return (
    <>
      {/* 齒輪按鈕 */}
      <button
        onClick={() => {
          setCfg(getConfig())
          setOpen(true)
        }}
        className="safe-float-top pointer-events-auto absolute z-[1100] flex h-11 w-11 items-center justify-center rounded-full border border-slate-600 bg-tactical-panel/90 text-lg active:scale-95"
        aria-label="設定"
      >
        ⚙️
      </button>

      {!open ? null : (
        <div className="pointer-events-auto fixed inset-0 z-[2000] flex items-end justify-center bg-black/60 p-3 pt-[calc(0.75rem+env(safe-area-inset-top))] md:items-center">
          <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl border border-slate-700 bg-tactical-bg p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-bold text-tactical-cyan">⚙️ 資料源金鑰設定</h2>
              <button onClick={() => setOpen(false)} className="text-slate-400 active:scale-95">
                ✕
              </button>
            </div>

            <p className="mb-3 text-[0.6875rem] leading-relaxed text-slate-400">
              金鑰只存在你這支手機的瀏覽器裡，不會上傳。填了才啟用對應的真實資料；
              留空則用內建模擬／示範。風、洋流、漂流預判、亮點掃描本來就免金鑰。
            </p>

            {/* 字體大小（全站等比縮放，即時生效） */}
            <div className="mb-3 rounded-lg border border-slate-700 bg-slate-900/40 p-2">
              <div className="mb-1.5 text-xs font-semibold text-tactical-green">🔠 字體大小</div>
              <div className="grid grid-cols-4 gap-1.5">
                {UI_SCALES.map((o) => (
                  <button
                    key={o.id}
                    onClick={() => setUiScale(o.scale)}
                    style={{ fontSize: `${o.scale * 0.9}rem` }}
                    className={`rounded border py-2 font-semibold active:scale-95 ${
                      Math.abs(uiScale - o.scale) < 0.01
                        ? 'border-tactical-cyan bg-tactical-cyan/15 text-tactical-cyan'
                        : 'border-slate-600 text-slate-300'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[0.625rem] text-slate-500">整個介面文字與按鈕會一起等比放大，即時生效、記住設定。</p>
            </div>

            {/* #6 這些欄位到底是什麼 */}
            <details className="mb-3 rounded-lg border border-slate-700 bg-slate-900/40 p-2">
              <summary className="cursor-pointer text-[0.6875rem] font-semibold text-tactical-cyan">
                ❓ 這些欄位是什麼？要不要填？（點開說明）
              </summary>
              <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-4 text-[0.625rem] leading-relaxed text-slate-400">
                <li>
                  <b className="text-slate-300">Sentinel Instance ID / WMS 位址</b>：歐洲太空總署
                  Copernicus 免費帳號建立的「影像設定檔」。填了 → 沿岸光學/雷達盲搜可用 10m
                  Sentinel 影像。<b>不填也能用</b>免金鑰的 Esri/MODIS 影像。
                </li>
                <li>
                  <b className="text-slate-300">AISStream 金鑰</b>：aisstream.io 免費申請。填了 →
                  AIS 模式顯示<b>真實船位</b>、且亮點掃描能自動比對「無AIS＝可疑」。不填 → 用模擬船隊。
                </li>
                <li>
                  <b className="text-slate-300">邊緣 AI Worker 網址</b>：你用電腦部署的
                  Cloudflare Worker 網址（一段 https://…workers.dev）。它是<b>中繼站</b>，
                  幫忙做雷達 AI 辨識、以及代理中央氣象署資料（因為氣象署擋瀏覽器直連）。
                </li>
                <li>
                  <b className="text-slate-300">中央氣象署 CWA 授權碼</b>：opendata.cwa.gov.tw 免費會員的授權碼。
                  搭配上面 Worker → <b>颱風即時路徑、潮汐、海面預報</b>用官方資料。
                </li>
                <li>全部留空，App 一樣能操作，只是用免金鑰/示範資料。詳細申請步驟見 SETUP_KEYS.md。</li>
              </ul>
            </details>

            <Field
              label="🛰️ Sentinel Hub Instance ID"
              hint="Copernicus 免費帳號建立 configuration 後取得"
              value={cfg.sentinelInstanceId}
              onChange={(v) => setCfg({ ...cfg, sentinelInstanceId: v })}
              placeholder="例如 12345678-abcd-..."
            />
            <details className="mb-3 rounded-lg border border-tactical-cyan/40 bg-tactical-cyan/5 p-2">
              <summary className="cursor-pointer text-[0.6875rem] font-semibold text-tactical-cyan">
                🛰️ 想在 App 內看到 Copernicus 那種海上衛星照？照這 5 步（免費、免再開帳號）
              </summary>
              <div className="mt-2 flex flex-col gap-1.5 text-[0.625rem] leading-relaxed text-slate-300">
                <div className="rounded border border-amber-500/50 bg-amber-500/10 p-1.5 text-amber-200">
                  ⚠️ <b>別跑錯平台：</b>Google「Sentinel Hub」常被導到 <span className="font-mono">insights.planet.com</span>——
                  那是 <b>Planet 公司的商業試用平台（會到期）</b>，跟本 App 免費來源<b>不同套</b>，Instance ID 不能混用。
                  免費、不到期的是 <b>Copernicus Data Space (CDSE)</b>，網址 <span className="font-mono">dataspace.copernicus.eu</span>。
                </div>
                <p className="text-tactical-green">
                  你在 Copernicus Browser 看到的海上影像，跟本 App 預設是<b>同一個免費來源</b>
                  （sh.dataspace.copernicus.eu）。<b>不用再申請新帳號</b>，只差一組「Instance ID」。
                </p>
                <ol className="flex list-decimal flex-col gap-1 pl-4 text-slate-400">
                  <li>用你的 <b className="text-slate-200">Copernicus 帳號</b>登入免費儀錶板：
                    <br/><span className="font-mono text-tactical-cyan">shapps.dataspace.copernicus.eu/dashboard</span></li>
                  <li>進 <b className="text-slate-200">Configuration Utility</b> → <b>New configuration</b>（範本 <i>WMS/OGC</i>）。</li>
                  <li>該 configuration 的 <b className="text-slate-200">Layers</b> 加兩個圖層，名稱務必打成：
                    <br/>• <b className="text-tactical-cyan">TRUE-COLOR-S2L2A</b>（真彩光學，看船/海面）
                    <br/>• <b className="text-tactical-cyan">SAR-VV</b>（Sentinel-1 雷達，穿雲/夜間看船）</li>
                  <li>複製該 configuration 的 <b className="text-slate-200">Instance ID</b>（一串 UUID）。</li>
                  <li>貼到上面欄位 → 儲存。回光學模式拉日期看「案發當時」的影像。</li>
                </ol>
                <p className="text-slate-500">
                  下方「WMS 位址」用「免費 CDSE」預設即可（見下方一鍵切換）。
                  影像每次過境才更新（Sentinel-2 約 2–5 天一次），拉到有影像那天最清楚。
                </p>
              </div>
            </details>
            <Field
              label="🛰️ Sentinel WMS 位址"
              hint="預設 CDSE 免費版，一般不用改"
              value={cfg.sentinelWmsUrl}
              onChange={(v) => setCfg({ ...cfg, sentinelWmsUrl: v })}
              placeholder="https://sh.dataspace.copernicus.eu/ogc/wms"
            />
            <div className="mb-3 -mt-1.5 flex gap-1.5">
              <button
                onClick={() => setCfg({ ...cfg, sentinelWmsUrl: 'https://sh.dataspace.copernicus.eu/ogc/wms' })}
                className={`flex-1 rounded border px-2 py-1.5 text-[0.625rem] font-semibold active:scale-95 ${
                  cfg.sentinelWmsUrl.includes('dataspace.copernicus')
                    ? 'border-tactical-green bg-tactical-green/15 text-tactical-green'
                    : 'border-slate-700 bg-slate-900/50 text-slate-300'
                }`}
              >
                ✅ 免費 CDSE（Copernicus）
              </button>
              <button
                onClick={() => setCfg({ ...cfg, sentinelWmsUrl: 'https://services.sentinel-hub.com/ogc/wms' })}
                className={`flex-1 rounded border px-2 py-1.5 text-[0.625rem] font-semibold active:scale-95 ${
                  cfg.sentinelWmsUrl.includes('services.sentinel-hub')
                    ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                    : 'border-slate-700 bg-slate-900/50 text-slate-300'
                }`}
              >
                💳 Planet/商業（試用）
              </button>
            </div>
            <Field
              label="📡 AISStream 金鑰"
              hint="aisstream.io 免費申請，接真實船舶"
              value={cfg.aisKey}
              onChange={(v) => setCfg({ ...cfg, aisKey: v })}
              placeholder="貼上 API key"
            />
            <Field
              label="🤖 邊緣 AI Worker 網址"
              hint="部署 cloudflare/worker.js 後取得（雷達盲搜 + CWA 代理共用）"
              value={cfg.edgeAiUrl}
              onChange={(v) => setCfg({ ...cfg, edgeAiUrl: v })}
              placeholder="https://argus-edge-ai.xxx.workers.dev"
            />
            <Field
              label="🌀 中央氣象署 CWA 授權碼"
              hint="opendata.cwa.gov.tw 免費會員取得。填了就能抓 CWA 官方颱風路徑（中文名＋預報＋侵襲機率）/潮汐/海面預報"
              value={cfg.cwaKey}
              onChange={(v) => setCfg({ ...cfg, cwaKey: v })}
              placeholder="CWA-XXXXXXXX-... 或 rdec-key-..."
            />

            {/* 關鍵說明：手機瀏覽器直連 CWA 幾乎都被 CORS 擋，必須靠 Worker 代理 */}
            {isCwaConfigured() && !cfg.edgeAiUrl && (
              <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-2 text-[0.6875rem] leading-relaxed text-amber-100">
                <b className="text-amber-300">⚠ 只填授權碼還不夠。</b>
                手機/瀏覽器直連 CWA 幾乎都會被 <b>CORS 擋掉</b>，所以官方颱風路徑抓不到、會退回 GDACS
                觀測軌跡（英文名、無預報）。<b>原生 App（像你另一支）沒有這個限制，才拿得到白海豚＋預報。</b>
                <br />解法：部署 <b>Cloudflare Worker</b>（免費）當代理，把網址填到上面「🤖 邊緣 AI Worker 網址」：
                <br />① 到 cloudflare.com 免費註冊 → Workers &amp; Pages → Create → 貼上專案 <code className="text-tactical-cyan">cloudflare/worker.js</code>
                <br />② 部署後拿到 <code className="text-tactical-cyan">https://xxx.workers.dev</code> → 填到上面 Worker 欄
                <br />③ 回颱風模式即會自動改用 CWA 官方路徑（中文名＋預報＋侵襲機率）
                <br />填好後按下方「🔌 測試 CWA 連線」確認。
              </div>
            )}

            {isCwaConfigured() && <CwaProbe />}

            {/* 機敏功能鎖 */}
            <div className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/5 p-2">
              <div className="mb-1 text-[0.6875rem] font-semibold text-rose-300">🔒 機敏功能鎖（雷達等）</div>
              <p className="mb-2 text-[0.625rem] leading-relaxed text-slate-400">
                設一組只有你知道的 PIN，<b>雷達功能就會預設完全隱藏</b>（別人進 App 也看不到、沒有按鈕）。
                解鎖手勢：狀態列右邊<b>「版本號」連點 5 下</b>→ 輸入 PIN。<b>重開 App 自動鎖回。</b>
                <br />資料仍只存本機；此為前端遮蔽（擋肩窺/借手機/同仁誤觸），非軍規加密。
              </p>
              {!secureHasLock ? (
                <div className="flex flex-col gap-1.5">
                  <input
                    type="password"
                    inputMode="numeric"
                    value={pin1}
                    onChange={(e) => setPin1(e.target.value)}
                    placeholder="設定 PIN（至少 4 碼）"
                    className="rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-slate-100"
                  />
                  <input
                    type="password"
                    inputMode="numeric"
                    value={pin2}
                    onChange={(e) => setPin2(e.target.value)}
                    placeholder="再輸入一次"
                    className="rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-slate-100"
                  />
                  <button
                    onClick={savePin}
                    className="rounded-lg border border-rose-500/60 bg-rose-500/15 py-2 text-xs font-bold text-rose-300 active:scale-95"
                  >
                    🔒 設定機敏 PIN 並隱藏雷達
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[0.6875rem] text-tactical-green">
                      ✅ 機敏鎖已啟用 {secureUnlocked ? '· 🔓 本階段已解鎖' : '· 🔒 目前鎖定中'}
                    </span>
                    <button
                      onClick={removePin}
                      className="rounded border border-slate-600 px-2 py-1 text-[0.6875rem] text-slate-300 active:scale-95"
                    >
                      移除鎖
                    </button>
                  </div>
                  {/* 解鎖/鎖回：解鎖需輸入 PIN（不減損安全），比版本號連點更好找 */}
                  {!secureUnlocked ? (
                    <button
                      onClick={() => {
                        setOpen(false) // 關設定，露出 PIN 視窗
                        setSecurePromptOpen(true)
                      }}
                      className="rounded-lg border border-tactical-cyan bg-tactical-cyan/15 py-2 text-xs font-bold text-tactical-cyan active:scale-95"
                    >
                      🔓 解鎖機敏功能（輸入 PIN）→ 叫出雷達
                    </button>
                  ) : (
                    <button
                      onClick={() => setSecureUnlocked(false)}
                      className="rounded-lg border border-slate-600 py-2 text-xs font-bold text-slate-300 active:scale-95"
                    >
                      🔒 立即鎖回（隱藏雷達）
                    </button>
                  )}
                  <p className="text-[0.5625rem] leading-relaxed text-slate-500">
                    也可用隱藏手勢：狀態列「版本號 v{'…'}」連點 5 下。解鎖只在本次使用，重開 App 自動鎖回。
                  </p>
                </div>
              )}
            </div>

            {/* #5 匯出 / 匯入 備份 */}
            <div className="mt-3 rounded-lg border border-slate-700 bg-slate-900/40 p-2">
              <div className="mb-1 text-[0.6875rem] font-semibold text-tactical-green">💾 備份 / 還原</div>
              <p className="mb-2 text-[0.625rem] leading-relaxed text-slate-500">
                把設定＋最愛/釘選座標＋歷史打包成一個 JSON 檔（iOS/Android 都能開）。
                換手機或重灌時，用「匯入」讀回這個檔就全部還原。
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => downloadBackup(new Date().toISOString())}
                  className="flex-1 rounded border border-tactical-green/50 bg-tactical-green/10 py-2 text-xs font-bold text-tactical-green active:scale-95"
                >
                  📤 匯出備份檔
                </button>
                <button
                  onClick={() => fileRef.current?.click()}
                  className="flex-1 rounded border border-tactical-cyan/50 bg-tactical-cyan/10 py-2 text-xs font-bold text-tactical-cyan active:scale-95"
                >
                  📥 匯入還原（選檔）
                </button>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) doImport(f)
                  e.target.value = ''
                }}
              />
            </div>

            <div className="mt-4 flex gap-2">
              <button
                onClick={save}
                className="flex-1 rounded-lg border border-tactical-cyan bg-tactical-cyan/15 py-2.5 text-sm font-bold text-tactical-cyan active:scale-95"
              >
                儲存並套用
              </button>
            </div>
            <p className="mt-3 text-[0.625rem] text-slate-500">
              申請步驟見專案 SETUP_KEYS.md。儲存後頁面會重新整理以套用。
            </p>
          </div>
        </div>
      )}
    </>
  )
}

/**
 * CWA 資料檢視：直接打一個 dataset 看原始 JSON。用來(1)驗證授權碼+Worker 通了、
 * (2)萬一某資料集欄位與解析器不符時，可看真實結構回報修正。
 */
function CwaProbe() {
  const [ds, setDs] = useState('F-A0021-001')
  const [out, setOut] = useState('')
  const [busy, setBusy] = useState(false)
  const [verdict, setVerdict] = useState<{ ok: boolean; msg: string } | null>(null)

  const run = async () => {
    setBusy(true)
    setOut('查詢中…')
    try {
      const data = await fetchCwaJson(ds.trim())
      const s = JSON.stringify(data, null, 1)
      setOut(s.length > 4000 ? s.slice(0, 4000) + '\n…（已截斷）' : s)
    } catch (e) {
      setOut('✗ ' + String((e as Error)?.message ?? e))
    } finally {
      setBusy(false)
    }
  }

  // 一鍵測連線：打「潮汐」資料集（平時就有資料），確認授權碼＋連線是否通。
  const testConn = async () => {
    setBusy(true)
    setVerdict(null)
    setOut('')
    try {
      const data = await fetchCwaJson('F-A0021-001')
      const ok = data?.success === 'true' || data?.success === true || !!data?.records
      setVerdict(
        ok
          ? { ok: true, msg: '✅ CWA 連線正常、授權碼有效。颱風警報一發布就會自動用官方路徑。' }
          : { ok: false, msg: '⚠ 有回應但格式異常——授權碼可能無效或過期，請到 opendata.cwa.gov.tw 重新複製。' },
      )
    } catch (e) {
      const m = String((e as Error)?.message ?? e)
      setVerdict({
        ok: false,
        msg: `✗ 連線失敗（${m}）。多為瀏覽器 CORS 擋住：請到上方填「邊緣 Worker 網址」代理；或確認授權碼正確。`,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 rounded-lg border border-slate-700 bg-slate-900/40 p-2">
      <div className="mb-1 text-[0.6875rem] font-semibold text-tactical-green">🔬 CWA 連線測試 / 資料檢視</div>
      <button
        onClick={testConn}
        disabled={busy}
        className="mb-1.5 w-full rounded-lg border border-tactical-cyan/60 bg-tactical-cyan/10 py-2 text-xs font-bold text-tactical-cyan active:scale-95 disabled:opacity-40"
      >
        🔌 一鍵測試 CWA 連線（確認授權碼有效）
      </button>
      {verdict && (
        <p
          className={`mb-1.5 rounded border px-2 py-1.5 text-[0.6875rem] leading-relaxed ${
            verdict.ok
              ? 'border-tactical-green/50 bg-tactical-green/10 text-tactical-green'
              : 'border-rose-500/50 bg-rose-500/10 text-rose-200'
          }`}
        >
          {verdict.msg}
        </p>
      )}
      <div className="flex gap-1">
        <input
          value={ds}
          onChange={(e) => setDs(e.target.value)}
          spellCheck={false}
          autoCapitalize="characters"
          className="w-0 flex-1 rounded border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-200"
          placeholder="F-A0021-001"
        />
        <button
          onClick={run}
          disabled={busy}
          className="shrink-0 rounded border border-tactical-green/50 bg-tactical-green/10 px-3 py-1.5 text-xs font-bold text-tactical-green active:scale-95 disabled:opacity-40"
        >
          查詢
        </button>
      </div>
      <p className="mt-1 text-[0.625rem] text-slate-500">
        常用：F-A0021-001 潮汐、F-A0012-001 海面預報、W-C0034-005 颱風路徑
      </p>
      {out && (
        <pre className="mt-1 max-h-48 overflow-auto rounded bg-black/40 p-2 font-mono text-[0.5625rem] leading-tight text-slate-300">
          {out}
        </pre>
      )}
    </div>
  )
}

function Field({
  label,
  hint,
  value,
  onChange,
  placeholder,
}: {
  label: string
  hint: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div className="mb-3">
      <label className="block text-xs font-semibold text-tactical-green">{label}</label>
      <input
        type="text"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-2 font-mono text-xs text-slate-200"
      />
      <p className="mt-0.5 text-[0.625rem] text-slate-500">{hint}</p>
    </div>
  )
}
