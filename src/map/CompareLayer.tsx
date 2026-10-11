import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useTacticalStore } from '../store/tacticalStore'
import { buildImagery, imageryLabel } from '../lib/imagerySources'

// ── 前後對照滑桿 ───────────────────────────────────────────
//
// 同一個畫面左右各掛一層影像，中間一條可以用手指拖的分隔線。
// 最常用的是「同一個來源、兩個日期」（上週 vs 今天），一眼看出海面多了什麼；
// 也可以左邊放高解析空拍、右邊放當日影像，兼顧看得清楚與看得新。
//
// 為什麼自己寫而不用 leaflet-side-by-side：專案目前沒有任何 Leaflet 外掛，
// 那個套件也沒有內建型別；而這個功能的原始參考專案（QuemoyLandscape1970s）
// 沒有授權檔，不能抄它的程式。整段是自己寫的。
//
// ── 裁切的關鍵 ─────────────────────────────────────────────
// 圖層容器 div.leaflet-layer 位在 leaflet-map-pane 裡面，平移地圖時整個
// pane 會被 transform 位移。所以裁切框一定要用「圖層座標」算，並且在
// move/zoom/resize 時重算，否則分隔線會跟著地圖一起跑掉。
//
// 又因為 .leaflet-layer 是 0×0 的絕對定位容器，clip-path 的 inset() 會被
// 這個空參考框夾掉，所以用 polygon() 的絕對 px 座標。另外一併寫入舊的 clip
// 屬性（iOS Safari 一路支援）當保險，兩者指向同一塊區域，結果一致。
//
// 已知瑕疵：縮放動畫期間 Leaflet 會對圖層容器加上 transform/scale，裁切框會
// 跟著縮放而讓分隔線短暫偏移，zoomend 時歸位。leaflet-side-by-side 也有
// 同樣的瑕疵，可接受。

/** 裁切框往外延伸的距離，夠大就等於「不限制」。 */
const FAR = 100000

export function CompareLayer({ map }: { map: L.Map }) {
  const compare = useTacticalStore((s) => s.compare)
  const setStatus = useTacticalStore((s) => s.setStatus)
  /** 分隔線位置（佔容器寬度的比例）。放 ref 不放 store：拖曳時每一格都要更新，
   *  寫進 store 會連帶重算整個面板。 */
  const xRef = useRef(0.5)

  useEffect(() => {
    if (!compare) return

    // 左層用預設 class（亮點掃描只讀這一層）；右層用另一個 class。
    const left = buildImagery(compare.left.src, compare.left.date, 'gibs-imagery')
    const right = buildImagery(compare.right.src, compare.right.date, 'gibs-imagery-cmp')
    // 夜間漁火圖層原本是 0.9 透明度（要透出底圖）；對照模式下會讓左層滲透過來，
    // 兩側都壓成不透明，分隔線兩邊才是乾淨的 A/B。
    left.setOpacity(1)
    right.setOpacity(1)
    left.addTo(map)
    right.addTo(map) // 後加的在上面，只需要裁切這一層

    const container = map.getContainer()
    const bar = L.DomUtil.create('div', 'cmp-divider', container)
    const handle = L.DomUtil.create('div', 'cmp-handle', bar)
    handle.textContent = '⇄'
    const tagL = L.DomUtil.create('div', 'cmp-tag cmp-tag-l', container)
    const tagR = L.DomUtil.create('div', 'cmp-tag cmp-tag-r', container)
    tagL.textContent = `◀ ${imageryLabel(compare.left.src, compare.left.date)}`
    tagR.textContent = `${imageryLabel(compare.right.src, compare.right.date)} ▶`

    // 不要讓拖曳/滾動事件漏到地圖上去
    L.DomEvent.disableClickPropagation(bar)
    L.DomEvent.disableScrollPropagation(bar)

    const apply = () => {
      const size = map.getSize()
      const px = Math.round(xRef.current * size.x)
      bar.style.left = `${px}px`
      const o = map.containerPointToLayerPoint(L.point(px, 0))
      const c = right.getContainer()
      if (!c) return
      c.style.clipPath =
        `polygon(${o.x}px ${-FAR}px, ${FAR}px ${-FAR}px, ` +
        `${FAR}px ${FAR}px, ${o.x}px ${FAR}px)`
      c.style.clip = `rect(${-FAR}px, ${FAR}px, ${FAR}px, ${o.x}px)`
    }

    // 圖磚是逐張載入的，第一張進來前容器可能還沒建好，載入時再補算一次。
    right.on('load', apply)
    map.on('move zoom zoomend viewreset resize', apply)
    apply()

    let dragging = false
    const setFromClientX = (clientX: number) => {
      const r = container.getBoundingClientRect()
      if (r.width <= 0) return
      // 留兩側 5% 不讓它拖到底，免得有一邊完全看不到而以為壞了。
      xRef.current = Math.min(0.95, Math.max(0.05, (clientX - r.left) / r.width))
      apply()
    }
    const onDown = (e: PointerEvent) => {
      dragging = true
      handle.setPointerCapture?.(e.pointerId)
      map.dragging.disable()
      e.preventDefault()
    }
    const onMove = (e: PointerEvent) => {
      if (!dragging) return
      setFromClientX(e.clientX)
      e.preventDefault()
    }
    const onUp = () => {
      if (!dragging) return
      dragging = false
      map.dragging.enable()
    }
    handle.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)

    setStatus(
      `前後對照：左 ${imageryLabel(compare.left.src, compare.left.date)}` +
        `／右 ${imageryLabel(compare.right.src, compare.right.date)}` +
        '。拖中間的 ⇄ 比對；亮點掃描以左側影像為準',
    )

    return () => {
      handle.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      right.off('load', apply)
      map.off('move zoom zoomend viewreset resize', apply)
      if (dragging) map.dragging.enable()
      for (const el of [bar, tagL, tagR]) el.remove()
      for (const layer of [left, right]) {
        map.removeLayer(layer)
        // 跟 LayerControl 一樣強制清掉 Leaflet 內部的圖磚快取，釋放 <img> 記憶體。
        // @ts-expect-error 存取內部快取
        layer._tiles = {}
      }
    }
  }, [compare, map, setStatus])

  return null
}
