// ── Sentinel Hub 組態裡「實際有哪些圖層」───────────────────────
//
// 使用者回報：填了 Instance ID、雷達暗船開關也開了，地圖上卻什麼都沒有。
// 原因：WMS 的 LAYERS 參數必須對到「使用者自己組態裡的圖層 ID」。App 寫死
// SAR-VV／TRUE-COLOR-S2L2A，但新建組態時選的範本不一定有這兩個名字
// （Sentinel-2 範本根本不含雷達圖層）。伺服器回錯誤，Leaflet 只會默默換成透明圖磚，
// 看起來就是「開了但沒反應」。
//
// 所以先讀 GetCapabilities（官方 OGC 介面，會列出組態裡全部圖層），
// 有預設名字就用，沒有就從現有圖層裡挑最像的；真的沒有雷達圖層就明講要去加。
//
// 實測（2026-10，GitHub Actions 打真的 CDSE，假 Instance ID）：
//   錯誤回 HTTP 400、Content-Type application/xml，內容是
//   <ServiceException><![CDATA[ Invalid instance id: … ]]></ServiceException>；
//   CORS 會把 Origin 原樣放進 Access-Control-Allow-Origin，所以瀏覽器讀得到錯誤文字。

export interface WmsLayerInfo {
  name: string
  title: string
}

const unwrap = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim()

/**
 * 從 WMS GetCapabilities 讀出有名字的圖層。
 * 不用 DOMParser：要能在純 Node 測。外層群組圖層只有 Title 沒有 Name，略過。
 */
export function parseCapabilities(xml: string): WmsLayerInfo[] {
  const out: WmsLayerInfo[] = []
  // 以 <Layer 切段：每段開頭就是一個圖層自己的 Name/Title（子圖層在下一段）
  for (const chunk of xml.split(/<Layer[\s>]/).slice(1)) {
    const head = chunk.split(/<\/Layer>/)[0]
    const name = head.match(/<Name>([\s\S]*?)<\/Name>/)?.[1]
    if (!name) continue
    const title = head.match(/<Title>([\s\S]*?)<\/Title>/)?.[1] ?? ''
    out.push({ name: unwrap(name), title: unwrap(title) })
  }
  return out
}

/** WMS 錯誤回應裡的文字；不是錯誤回應回 null。 */
export function parseServiceException(xml: string): string | null {
  // 不能寫 [^>]*：會先對到外層的 <ServiceExceptionReport>，抓出整份 XML
  const m = xml.match(/<ServiceException(?:\s[^>]*)?>([\s\S]*?)<\/ServiceException>/)
  return m ? unwrap(m[1]) : null
}

export type LayerKind = 'sar' | 'optical'

const SAR_RE = /\bVV\b|\bVH\b|SAR|S1|SENTINEL[-_ ]?1|RADAR|GRD|BACKSCATTER|GAMMA0|SIGMA0/i
const OPTICAL_RE = /TRUE[-_ ]?COLOU?R|NATURAL[-_ ]?COLOU?R|\bRGB\b/i
const S2_RE = /S2|L2A|L1C|SENTINEL[-_ ]?2/i

/**
 * 從組態現有圖層挑出要用的那一個。
 * 1. 預設名字（SAR-VV／TRUE-COLOR-S2L2A）在就用它
 * 2. 雷達：名字或標題像 Sentinel-1 的，偏好 VV（船在 VV 極化最亮）
 *    光學：像真彩的，偏好 Sentinel-2／L2A；排除雷達與「假彩」
 * 3. 都沒有 → null（UI 要明講去加圖層，不要默默顯示空白）
 */
export function pickLayer(kind: LayerKind, layers: WmsLayerInfo[], preferred: string): string | null {
  if (layers.some((l) => l.name === preferred)) return preferred
  const text = (l: WmsLayerInfo) => `${l.name} ${l.title}`
  if (kind === 'sar') {
    const sar = layers.filter((l) => SAR_RE.test(text(l)) && !S2_RE.test(text(l)))
    return (sar.find((l) => /\bVV\b|[-_]VV|VV[-_]/i.test(text(l))) ?? sar[0])?.name ?? null
  }
  const opt = layers.filter((l) => OPTICAL_RE.test(text(l)) && !SAR_RE.test(text(l)) && !/FALSE/i.test(text(l)))
  return (opt.find((l) => S2_RE.test(text(l))) ?? opt[0])?.name ?? null
}

export type CheckStatus = 'idle' | 'checking' | 'ok' | 'badId' | 'error' | 'unreachable'

export interface SentinelCheck {
  status: CheckStatus
  /** 實際要用的雷達／光學圖層 ID；組態裡沒有就是 null。 */
  sar: string | null
  optical: string | null
  /** 組態裡全部圖層 ID（給人看，知道自己組態長怎樣）。 */
  layers: string[]
  /** 給人看的一句話；沒事就空字串。 */
  message: string
}

export const IDLE_CHECK: SentinelCheck = { status: 'idle', sar: null, optical: null, layers: [], message: '' }

/** 把伺服器錯誤翻成「使用者可以做什麼」。 */
export function explainWmsError(text: string): { status: CheckStatus; message: string } {
  if (/invalid instance|instance.*not found|unknown instance/i.test(text)) {
    return {
      status: 'badId',
      message:
        `Copernicus 說這個 Instance ID 不存在（「${text}」）。到設定頁重新複製一次再貼上；` +
        '也確認 ⚙️ 設定的 WMS 網址選的是「免費 CDSE」——用 Copernicus 帳號建的 ID 在商業版網址上會被當成不存在。',
    }
  }
  if (/quota|rate limit|too many|processing units|exceeded/i.test(text)) {
    return { status: 'error', message: `Copernicus 回報額度用完或請求太多（「${text}」）。等一陣子再試；免費額度每月重置。` }
  }
  return { status: 'error', message: `Copernicus 回報錯誤：「${text}」` }
}

/**
 * 讀組態的 GetCapabilities，決定雷達／光學各用哪個圖層。
 * fetchText 注入，方便離線測；回傳 {status, text}，網路失敗時丟例外。
 */
export async function checkInstance(
  wmsBase: string,
  fetchText: (url: string) => Promise<{ status: number; text: string }>,
  preferred: { sar: string; optical: string },
): Promise<SentinelCheck> {
  const url = `${wmsBase}?service=WMS&request=GetCapabilities&version=1.3.0`
  let res: { status: number; text: string }
  try {
    res = await fetchText(url)
  } catch {
    // 連不到不代表設定錯：照預設名字照常載入，只是沒辦法事先檢查。
    return {
      ...IDLE_CHECK,
      status: 'unreachable',
      sar: preferred.sar,
      optical: preferred.optical,
      message: '連不到 Copernicus 檢查組態（網路問題），先照預設圖層名稱載入。',
    }
  }
  const err = parseServiceException(res.text)
  if (err || res.status >= 400) {
    const e = explainWmsError(err ?? `HTTP ${res.status}`)
    return { ...IDLE_CHECK, ...e }
  }
  const layers = parseCapabilities(res.text)
  const sar = pickLayer('sar', layers, preferred.sar)
  const optical = pickLayer('optical', layers, preferred.optical)
  const list = layers.map((l) => l.name)
  const missing = [!sar && '雷達（Sentinel-1）', !optical && '光學真彩（Sentinel-2）'].filter(Boolean)
  return {
    status: 'ok',
    sar,
    optical,
    layers: list,
    message: missing.length
      ? `你的 Sentinel 組態裡沒有${missing.join('、')}圖層（現有：${list.join('、') || '無'}）。照「怎麼加圖層」做一次就好。`
      : '',
  }
}
