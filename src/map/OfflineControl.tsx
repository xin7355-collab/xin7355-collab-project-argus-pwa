import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { useTacticalStore } from '../store/tacticalStore'
import { tilesForBounds, downloadTiles, urlsForStyle } from '../lib/offlineMap'
import { BASE_STYLES } from '../lib/basemaps'

/**
 * 離線地圖包：下載目前畫面範圍的底圖圖磚進快取，沒訊號也能看這塊海域。
 * 由功能清單的「離線地圖」觸發（openTool==='offline'）；下載時顯示進度膠囊。
 */
export function OfflineControl({ map }: { map: L.Map }) {
  const setStatus = useTacticalStore((s) => s.setStatus)
  const openTool = useTacticalStore((s) => s.openTool)
  const setOpenTool = useTacticalStore((s) => s.setOpenTool)
  const [busy, setBusy] = useState(false)
  const [pct, setPct] = useState(0)
  const busyRef = useRef(false)

  const download = async () => {
    if (busyRef.current) return
    busyRef.current = true
    const b = map.getBounds()
    const z = Math.round(map.getZoom())
    const bounds = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() }
    // 目前層級到 +2 層，上限 500 磚，避免吃爆流量。
    const tiles = tilesForBounds(bounds, z, Math.min(z + 2, 19), 500)
    const style = BASE_STYLES[useTacticalStore.getState().baseLayer]
    const urls = urlsForStyle(style, tiles)
    if (urls.length === 0) {
      // Sentinel 這類要金鑰的動態影像沒有固定圖磚可以預抓
      busyRef.current = false
      setStatus(`⚠ 「${style.label}」底圖不能預先下載。請先把底圖切成「地圖」或「衛星」再下載`)
      return
    }
    setBusy(true)
    setPct(0)
    setStatus(`離線地圖（${style.label}）：開始下載 ${urls.length} 個圖磚…`)
    const { ok, fail } = await downloadTiles(urls, (done, total) => {
      setPct(Math.round((done / total) * 100))
    })
    setBusy(false)
    setPct(0)
    busyRef.current = false
    setStatus(
      fail === 0
        ? `✓ 離線地圖（${style.label}）已下載 ${ok} 圖磚，此區沒訊號也能看`
        : `離線地圖下載完成：成功 ${ok}、失敗 ${fail}。失敗的多半是外海「本來就沒圖」的地方；連網後再按一次可補抓`,
    )
  }

  // 功能清單點「離線地圖」→ 觸發下載目前畫面範圍
  useEffect(() => {
    if (openTool === 'offline') {
      setOpenTool(null)
      void download()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTool])

  if (!busy) return null

  return (
    <div
      className="below-search pointer-events-none absolute right-3 z-[1100] flex h-11 items-center justify-center rounded-full border border-tactical-cyan bg-tactical-panel/95 px-3"
      aria-label="離線地圖下載中"
    >
      <span className="font-mono text-xs font-bold text-tactical-cyan">離線 {pct}%</span>
    </div>
  )
}
