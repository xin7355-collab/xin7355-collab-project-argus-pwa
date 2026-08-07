import { useEffect } from 'react'
import { MapContainer } from './map/MapContainer'
import { Dashboard } from './components/Dashboard'
import { StatusBar } from './components/StatusBar'
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
import { LookoutPanel } from './components/LookoutPanel'
import { InterceptPanel } from './components/InterceptPanel'
import { DrPanel } from './components/DrPanel'
import { SecureUnlock } from './components/SecureUnlock'
import { ToolLauncher } from './components/ToolLauncher'
import { CwaAlertBanner } from './components/CwaAlertBanner'
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
      <StatusBar />
      <CwaAlertBanner />
      <SettingsPanel />
      <ToolLauncher />
      <CoordManager />
      <MeasureControl />
      <RangeRingControl />
      <InterceptControl />
      <LayerManager />
      <FieldOpsPanel />
      <NightOpsPanel />
      <RadarPanel />
      <RadioPanel />
      <LookoutPanel />
      <InterceptPanel />
      <DrPanel />
      <SecureUnlock />
      <Dashboard />
    </div>
  )
}
