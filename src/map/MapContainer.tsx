import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { LayerControl } from './LayerControl'
import { BaseLayerControl } from './BaseLayerControl'
import { BBoxSelector } from './BBoxSelector'
import { AisLayer } from './AisLayer'
import { RescueLayer } from './RescueLayer'
import { SeaStateLayer } from './SeaStateLayer'
import { EnvAnimLayer } from './EnvAnimLayer'
import { TyphoonLayer } from './TyphoonLayer'
import { LocateControl } from './LocateControl'
import { OfflineControl } from './OfflineControl'
import { TerritorialLayer } from './TerritorialLayer'
import { WindLayer } from './WindLayer'
import { VisibilityLayer } from './VisibilityLayer'
import {
  WindFarmLayer,
  MedianLineLayer,
  PortLayer,
  RainRadarLayer,
  RestrictedZoneLayer,
  EnforcementLineLayer,
  SeamarkLayer,
  FairwayLayer,
  CableLayer,
  ShoalLayer,
} from './MaritimeRefLayer'
import { MapFlyTo } from './MapFlyTo'
import { BrightSpotLayer } from './BrightSpotLayer'
import { SavedCoordsLayer } from './SavedCoordsLayer'
import { PoiLayer } from './PoiLayer'
import { SearchMarkerLayer } from './SearchMarkerLayer'
import { MeasureLayer } from './MeasureLayer'
import { RadarLayer, WindClutterLayer } from './RadarLayer'
import { RadioLayer } from './RadioLayer'
import { MicrowaveLayer } from './MicrowaveLayer'
import { LookoutLayer } from './LookoutLayer'
import { RangeRingLayer } from './RangeRingLayer'
import { InterceptLayer } from './InterceptLayer'
import { MapInfoBar } from '../components/MapInfoBar'

/**
 * MapContainer —— 唯一的地圖實體。
 *
 * 這裡只負責建立 L.map 和 Base Layer（OSM 暗色底圖）。
 * 其餘所有圖層的增減都交給 <LayerControl> 依戰術模式狀態去做，
 * 避免把所有邏輯塞進同一個檔案而互相打架。
 */
export function MapContainer() {
  const elRef = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<L.Map | null>(null)

  useEffect(() => {
    if (!elRef.current) return
    const m = L.map(elRef.current, {
      center: [24.5, 122.0], // 台灣東部海域
      zoom: 7,
      zoomControl: false,
      attributionControl: true,
      preferCanvas: true,
    })

    // Base Layer 改由 <BaseLayerControl> 依 store.baseLayer 管理（可切中文底圖）。

    // 手機以雙指縮放為主，移除佔版面的縮放按鈕；保留比例尺。
    L.control.scale({ imperial: false, position: 'bottomright' }).addTo(m)

    setMap(m)
    return () => {
      m.remove() // 卸載時徹底移除地圖，釋放所有資源
      setMap(null)
    }
  }, [])

  return (
    <div className="absolute inset-0">
      <div ref={elRef} className="h-full w-full" />
      <div className="radar-vignette" />
      {map && <BaseLayerControl map={map} />}
      {map && <LayerControl map={map} />}
      {map && <BBoxSelector map={map} />}
      {map && <AisLayer map={map} />}
      {map && <RescueLayer map={map} />}
      {map && <SeaStateLayer map={map} />}
      {map && <EnvAnimLayer map={map} />}
      {map && <TyphoonLayer map={map} />}
      {map && <LocateControl map={map} />}
      {map && <OfflineControl map={map} />}
      {map && <TerritorialLayer map={map} />}
      {map && <WindLayer map={map} />}
      {map && <VisibilityLayer map={map} />}
      {map && <WindFarmLayer map={map} />}
      {map && <MedianLineLayer map={map} />}
      {map && <PortLayer map={map} />}
      {map && <RainRadarLayer map={map} />}
      {map && <RestrictedZoneLayer map={map} />}
      {map && <EnforcementLineLayer map={map} />}
      {map && <SeamarkLayer map={map} />}
      {map && <FairwayLayer map={map} />}
      {map && <CableLayer map={map} />}
      {map && <ShoalLayer map={map} />}
      {map && <RadarLayer map={map} />}
      {map && <WindClutterLayer map={map} />}
      {map && <RadioLayer map={map} />}
      {map && <MicrowaveLayer map={map} />}
      {map && <LookoutLayer map={map} />}
      {map && <RangeRingLayer map={map} />}
      {map && <InterceptLayer map={map} />}
      {map && <MapFlyTo map={map} />}
      {map && <BrightSpotLayer map={map} />}
      {map && <SavedCoordsLayer map={map} />}
      {map && <PoiLayer map={map} />}
      {map && <SearchMarkerLayer map={map} />}
      {map && <MeasureLayer map={map} />}
      {map && <MapInfoBar map={map} />}
    </div>
  )
}
