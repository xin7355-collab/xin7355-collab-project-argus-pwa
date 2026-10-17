import { useEffect } from 'react'
import { MapContainer } from './map/MapContainer'
import { Dashboard } from './components/Dashboard'
import { SearchBar } from './components/SearchBar'
import { Toast } from './components/Toast'
import { BaseMapSwitcher } from './components/BaseMapSwitcher'
import { SettingsPanel } from './components/SettingsPanel'
import { CoordManager } from './components/CoordManager'
import { MeasureControl } from './components/MeasureControl'
import { RangeRingControl } from './components/RangeRingControl'
import { InterceptControl } from './components/InterceptControl'
import { FieldOpsPanel } from './components/FieldOpsPanel'
import { LayerManager } from './components/LayerManager'
import { NightOpsPanel } from './components/NightOpsPanel'
import { RadarPanel } from './components/RadarPanel'
import { RadioPanel } from './components/RadioPanel'
import { MicrowavePanel } from './components/MicrowavePanel'
import { LookoutPanel } from './components/LookoutPanel'
import { InterceptPanel } from './components/InterceptPanel'
import { DrPanel } from './components/DrPanel'
import { SecureUnlock } from './components/SecureUnlock'
import { QuickScan } from './components/QuickScan'
import { SituationOverview } from './components/SituationOverview'
import { applyUiScale } from './lib/uiScale'
import { useTacticalStore } from './store/tacticalStore'

export default function App() {
  const uiScale = useTacticalStore((s) => s.uiScale)
  // 開啟時套用字體大小（改根 font-size → 全站 rem 等比縮放）
  useEffect(() => {
    applyUiScale(uiScale)
  }, [uiScale])

  return (
    <div className="relative h-full w-full overflow-hidden bg-tactical-bg text-slate-200">
      <MapContainer />
      <SearchBar />
      <SituationOverview />
      <SettingsPanel />
      <QuickScan />
      <BaseMapSwitcher />
      {/* 抽屜正上方的一欄：進行中的工具（量距離、距離圈、攔截）＋狀態提示。
          放在一個欄裡由下往上疊，彼此不會重疊；靠近拇指，比放頂端好按。 */}
      <div
        className="follow-sheet hide-when-sheet-tall pointer-events-none absolute left-3 right-[4.5rem] z-[1100] flex flex-col items-start gap-1.5 md:right-auto md:w-[26rem]"
        style={{ bottom: 'calc(var(--sheet-h) + 0.75rem)' }}
      >
        <MeasureControl />
        <RangeRingControl />
        <InterceptControl />
        <Toast />
      </div>
      <CoordManager />
      <LayerManager />
      <FieldOpsPanel />
      <NightOpsPanel />
      <RadarPanel />
      <RadioPanel />
      <MicrowavePanel />
      <LookoutPanel />
      <InterceptPanel />
      <DrPanel />
      <SecureUnlock />
      <Dashboard />
    </div>
  )
}
