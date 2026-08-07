import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { useTacticalStore } from '../store/tacticalStore'
import { tilesForBounds, downloadTiles } from '../lib/offlineMap'

/**
 * 離線地圖包：下載目前畫面範圍的底圖圖磚進快取，沒訊號也能看這塊海域。
 * 由「工具總表」的離線格觸發（openTool==='offline'）；下載時顯示進度膠囊。
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
    setBusy(true)
    setPct(0)
    setStatus(`離線地圖：開始下載 ${tiles.length} 個圖磚…`)
    const { ok, fail } = await downloadTiles(tiles, (done, total) => {
      setPct(Math.round((done / total) * 100))
    })
    setBusy(false)
    setPct(0)
    busyRef.current = false
    setStatus(
      fail === 0
        ? `✓ 離線地圖已下載 ${ok} 圖磚，此區沒訊號也能看`
        : `離線地圖下載完成：成功 ${ok}、失敗 ${fail}（部分圖磚無資料）`,
    )
  }

  // 工具總表點「離線地圖」→ 觸發下載目前畫面範圍
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
      className="safe-float-top4 pointer-events-none absolute z-[1100] flex h-11 items-center justify-center rounded-full border border-tactical-cyan bg-tactical-panel/95 px-3"
      aria-label="離線地圖下載中"
    >
      <span className="font-mono text-xs font-bold text-tactical-cyan">離線 {pct}%</span>
    </div>
  )
}
