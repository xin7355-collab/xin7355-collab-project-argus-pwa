// ── 這台是手機、平板還是電腦：決定「桌機功能」要不要先提醒 ─────────
//
// 3D 地球（Cesium）第一次要下載約 2–3 MB（實測壓縮後 2.2 MB，原始 5.9 MB），
// 跑起來吃幾百 MB 記憶體、一直用顯示晶片。
// 電腦上很順；手機上可能很燙、很耗電，記憶體不夠時 iOS 會直接把整頁重新載入。
// 所以不是「手機一律不給用」，而是：電腦直接開；手機先講清楚會怎樣，使用者決定要不要試。
// classifyDevice 是純函式（可離線測）；readDeviceFacts 才碰瀏覽器。

export type DeviceKind = 'phone' | 'tablet' | 'desktop'

export interface DeviceFacts {
  /** 主要指標是手指（pointer: coarse）。 */
  coarse: boolean
  /** 能懸停（有滑鼠或觸控板）。 */
  hover: boolean
  /** 螢幕短邊（CSS px）。 */
  shortSide: number
  /** 裝置記憶體（GB）；只有 Chrome 系瀏覽器會給，Safari 一律是 null。 */
  memoryGB: number | null
  /** 瀏覽器支援 WebGL 2（Cesium 需要）。 */
  webgl2: boolean
}

export type GlobeSupport = 'ok' | 'heavy' | 'unsupported'

export interface DeviceVerdict {
  kind: DeviceKind
  /** ok：直接開；heavy：先提醒（可能很慢、很耗電）再讓使用者決定；unsupported：開不了。 */
  globe: GlobeSupport
  /** 給人看的一句話（heavy／unsupported 時說明原因）。 */
  why: string
}

/** 平板的短邊至少這麼寬（iPad mini 是 744）。 */
const TABLET_MIN_SHORT_SIDE = 600

export function classifyDevice(f: DeviceFacts): DeviceVerdict {
  // 有滑鼠／觸控板或主要指標不是手指，就當電腦（含觸控筆電、接了觸控板的 iPad）
  const kind: DeviceKind = !f.coarse || f.hover ? 'desktop' : f.shortSide >= TABLET_MIN_SHORT_SIDE ? 'tablet' : 'phone'
  if (!f.webgl2) {
    return { kind, globe: 'unsupported', why: '這個瀏覽器不支援 WebGL 2，3D 地球開不了。請改用新版的 Chrome、Edge 或 Safari。' }
  }
  if (f.memoryGB !== null && f.memoryGB < 4) {
    return { kind, globe: 'heavy', why: `這台只有約 ${f.memoryGB} GB 記憶體，3D 地球可能很慢或被瀏覽器關掉。` }
  }
  if (kind === 'phone') {
    return {
      kind,
      globe: 'heavy',
      why: '手機上第一次要下載約 2–3 MB，跑起來很耗電、可能發燙；記憶體不夠時 iPhone 會把整頁重新載入。用電腦開最順。',
    }
  }
  return { kind, globe: 'ok', why: '' }
}

/** 讀這台裝置的狀況（只在瀏覽器裡呼叫）。 */
export function readDeviceFacts(): DeviceFacts {
  const mq = (q: string) => typeof window !== 'undefined' && !!window.matchMedia?.(q).matches
  let webgl2 = false
  try {
    webgl2 = !!document.createElement('canvas').getContext('webgl2')
  } catch {
    webgl2 = false
  }
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  return {
    coarse: mq('(pointer: coarse)'),
    hover: mq('(hover: hover)'),
    shortSide: Math.min(window.screen?.width ?? window.innerWidth, window.screen?.height ?? window.innerHeight),
    memoryGB: typeof mem === 'number' && Number.isFinite(mem) ? mem : null,
    webgl2,
  }
}
