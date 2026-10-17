import { useTacticalStore } from '../store/tacticalStore'
import type { LaunchItem } from '../lib/launcher'
import type { TacticalMode } from '../types'

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
