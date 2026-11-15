import { useEffect } from 'react'
import { useTacticalStore } from '../store/tacticalStore'
import { parseShareHash } from '../lib/shareLink'
import { TACTICAL_MODES, type TacticalMode } from '../types'
import { BASE_STYLES, type BaseLayerId } from '../lib/basemaps'

/**
 * 開啟 App 時讀分享連結（# 後面）：飛到那個位置、切模式與底圖、記下要追蹤的船。
 * 套用後把 # 清掉，重新整理才不會又被拉回去。連結不合法就整個忽略並說一聲。
 */
export function useShareLink() {
  useEffect(() => {
    const hash = window.location.hash
    if (!hash) return
    const st = useTacticalStore.getState()
    const v = parseShareHash(hash, { modes: TACTICAL_MODES, bases: Object.keys(BASE_STYLES) })
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
    if (!v) {
      st.setStatus('⚠ 這個分享連結看不懂（可能被截斷或改過），已忽略')
      return
    }
    if (v.base) st.setBaseLayer(v.base as BaseLayerId)
    // 指定了船就一定進 AIS 模式（追船只有在 AIS 模式才看得到）
    const mode = v.mmsi ? 'ais' : v.mode
    if (mode) st.setMode(mode as TacticalMode)
    st.gotoCoord(v.lat, v.lng, v.zoom)
    if (v.mmsi) {
      st.setFocusMmsi(v.mmsi)
      st.setStatus(`分享連結：等 MMSI ${v.mmsi} 回報船位…`)
    } else {
      st.setStatus('已開啟分享的位置')
    }
  }, [])
}
