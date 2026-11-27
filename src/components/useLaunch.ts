import { useTacticalStore } from '../store/tacticalStore'
import type { LaunchItem } from '../lib/launcher'
import type { TacticalMode } from '../types'
import { buildShareUrl, shareUrl } from '../lib/shareLink'
import { classifyDevice, readDeviceFacts } from '../lib/device'

/**
 * 開 3D 地球：電腦直接開；手機先講清楚會怎樣（耗電、可能被重新載入），讓使用者決定。
 * 功能清單和 AIS／衛星過境的模式標題列都會呼叫（模式進行中也能開，船和衛星照常更新）。
 */
export function openGlobe() {
  const st = useTacticalStore.getState()
  const v = classifyDevice(readDeviceFacts())
  if (v.globe === 'unsupported') st.setStatus(`⚠ ${v.why}`)
  else if (v.globe === 'heavy') st.setGlobeAsk(v.why)
  else st.setOpenTool('globe')
}

/**
 * 點功能清單上的一格要做什麼。
 *
 * 模式：切過去並把抽屜拉到一半（控制項看得到、地圖也看得到）。
 * 量距離／距離圈：是「在地圖上操作」的工具，抽屜收起來讓地圖讓出空間。
 * 其他工具：開它自己的面板（跟舊版 🧰 一樣）。
 */
export function launch(item: LaunchItem) {
  const st = useTacticalStore.getState()

  if (item.kind === 'mode') {
    st.setMode(item.id as TacticalMode)
    st.setSheetSnap('half')
    return
  }
  switch (item.id) {
    case 'quickscan':
      st.setSheetSnap('peek')
      st.requestQuickScan()
      return
    case 'settings':
      st.setSettingsOpen(true)
      return
    case 'globe':
      openGlobe()
      return
    // 飛機、GPS 干擾是疊在地圖上的開關：打開時把抽屜收起來讓出地圖，再按一次關掉
    case 'aircraft': {
      const on = !st.showAircraft
      st.setShowAircraft(on)
      if (on) st.setSheetSnap('peek')
      st.setStatus(on ? '✈️ 飛機：向 adsb.lol 要附近的飛機…（燈號在 🗂️ 圖層）' : '✈️ 飛機：已關閉')
      return
    }
    case 'gnss': {
      const on = !st.showGnss
      st.setShowGnss(on)
      if (on) st.setSheetSnap('peek')
      st.setStatus(on ? '📵 GPS 干擾：開始累積飛機定位精度，每格至少 3 架才判斷（燈號在 🗂️ 圖層）' : '📵 GPS 干擾：已關閉')
      return
    }
    // 無人機：打開禁限航區圖層，檢查位置從 GPS（沒有就用畫面中心）開始；抽屜收起來讓出地圖，點地圖換位置
    case 'drone':
      st.setShowDroneZones(true)
      st.setDroneTarget(st.ownPosition ? { lat: st.ownPosition.lat, lng: st.ownPosition.lng } : { lat: st.mapView.lat, lng: st.mapView.lng })
      st.setSheetSnap('peek')
      st.setOpenTool('drone')
      return
    case 'share': {
      // 要在點擊當下就呼叫分享選單（iOS 要求使用者手勢），所以不先做任何 await
      const v = st.mapView
      const url = buildShareUrl(window.location.href, {
        lat: v.lat,
        lng: v.lng,
        zoom: v.zoom,
        mode: st.mode === 'basic' ? undefined : st.mode,
        base: st.baseLayer,
      })
      void shareUrl(url).then((msg) => useTacticalStore.getState().setStatus(msg))
      return
    }
    case 'measure':
      if (!st.measuring) st.toggleMeasure()
      st.setSheetSnap('peek')
      return
    case 'rings':
      st.setRangeCenter(st.rangeCenter ? null : (st.ownPosition ?? { lat: st.mapView.lat, lng: st.mapView.lng }))
      st.setSheetSnap('peek')
      return
    default:
      st.setOpenTool(item.id)
  }
}
