// ── Runtime 設定（金鑰）──────────────────────────────────────
//
// 讓使用者在 App 內直接貼金鑰（存在瀏覽器 localStorage），不必去 Vercel
// 改環境變數再重新部署 —— 對手機操作的海上人員友善。
//
// 優先序：localStorage 使用者輸入 > 建置時的環境變數(VITE_*) > 空。

export interface RuntimeConfig {
  sentinelInstanceId: string
  sentinelWmsUrl: string
  edgeAiUrl: string
  aisKey: string
  /** 中央氣象署 (CWA) Open Data 授權碼。經 Worker 代理使用（CWA 無 CORS）。 */
  cwaKey: string
}

const LS_KEY = 'argus.config.v1'

const ENV = {
  sentinelInstanceId: (import.meta.env.VITE_SENTINEL_INSTANCE_ID as string) ?? '',
  sentinelWmsUrl:
    (import.meta.env.VITE_SENTINEL_WMS_URL as string) ?? 'https://sh.dataspace.copernicus.eu/ogc/wms',
  edgeAiUrl: (import.meta.env.VITE_EDGE_AI_URL as string) ?? '',
  aisKey: (import.meta.env.VITE_AISSTREAM_KEY as string) ?? '',
  cwaKey: (import.meta.env.VITE_CWA_KEY as string) ?? '',
}

/** 正規化 Worker 網址：補上 https://、去尾斜線與空白（使用者常忘了打 https）。 */
function normUrl(u: string): string {
  const s = (u || '').trim().replace(/\/+$/, '')
  if (!s) return ''
  return /^https?:\/\//i.test(s) ? s : `https://${s}`
}

function readLS(): Partial<RuntimeConfig> {
  try {
    const v = JSON.parse(localStorage.getItem(LS_KEY) || '{}')
    // 防止儲存值為 "null" 或非物件（例如壞掉的還原檔）導致後續 .trim() 崩潰
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

/** 取得目前生效的設定（合併 localStorage 與 env）。 */
export function getConfig(): RuntimeConfig {
  const ls = readLS()
  return {
    sentinelInstanceId: ls.sentinelInstanceId?.trim() || ENV.sentinelInstanceId,
    sentinelWmsUrl: ls.sentinelWmsUrl?.trim() || ENV.sentinelWmsUrl,
    edgeAiUrl: normUrl(ls.edgeAiUrl || ENV.edgeAiUrl),
    aisKey: ls.aisKey?.trim() || ENV.aisKey,
    cwaKey: ls.cwaKey?.trim() || ENV.cwaKey,
  }
}

/** 儲存使用者輸入的設定。只存有填的欄位。 */
export function saveConfig(patch: Partial<RuntimeConfig>) {
  const cur = readLS()
  localStorage.setItem(LS_KEY, JSON.stringify({ ...cur, ...patch }))
}

/** 清除使用者輸入，回到 env 預設。 */
export function clearConfig() {
  localStorage.removeItem(LS_KEY)
}

export const isSentinelConfigured = () => Boolean(getConfig().sentinelInstanceId)
export const isEdgeAiConfigured = () => Boolean(getConfig().edgeAiUrl)
export const isAisConfigured = () => Boolean(getConfig().aisKey)
/** CWA 只要有授權碼即可（先試瀏覽器直連；直連被擋才需 Worker）。 */
export const isCwaConfigured = () => Boolean(getConfig().cwaKey)
