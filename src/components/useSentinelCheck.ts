import { useEffect } from 'react'
import { useTacticalStore } from '../store/tacticalStore'
import { getConfig, isSentinelConfigured } from '../lib/config'
import { LAYERS, setResolvedLayers } from '../lib/sentinel'
import { checkInstance, IDLE_CHECK } from '../lib/sentinelLayers'

/**
 * 有 Instance ID 就讀一次組態的 GetCapabilities，決定雷達／光學實際用哪個圖層。
 * 改了設定（configRev）就重讀。見 lib/sentinelLayers.ts 為什麼需要這一步。
 */
export function useSentinelCheck() {
  const configRev = useTacticalStore((s) => s.configRev)
  const tick = useTacticalStore((s) => s.sentinelCheckTick)
  useEffect(() => {
    const { setSentinelCheck } = useTacticalStore.getState()
    setResolvedLayers(null)
    if (!isSentinelConfigured()) {
      setSentinelCheck(IDLE_CHECK)
      return
    }
    let alive = true
    setSentinelCheck({ ...IDLE_CHECK, status: 'checking', message: '檢查 Sentinel 組態中…' })
    const cfg = getConfig()
    checkInstance(
      `${cfg.sentinelWmsUrl}/${cfg.sentinelInstanceId}`,
      async (url) => {
        const r = await fetch(url)
        return { status: r.status, text: await r.text() }
      },
      { sar: LAYERS.sarVV, optical: LAYERS.opticalTrueColor },
    ).then((c) => {
      if (!alive) return
      // 先設好圖層再通知 store：圖層元件收到通知時讀 layerFor 才是新的。
      // ID 錯時也設成 null，免得掛上注定 400 的 WMS 又默默變透明。
      setResolvedLayers(c.status === 'unreachable' ? null : { sar: c.sar, optical: c.optical })
      setSentinelCheck(c)
    })
    return () => {
      alive = false
    }
  }, [configRev, tick])
}
