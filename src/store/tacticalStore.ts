import { create } from 'zustand'
import type { BBox, DetectionCollection, TacticalMode } from '../types'
import type { DriftPoint } from '../lib/drift'
import type { MarineEnv } from '../lib/marineEnv'
import type { HourlySeries } from '../lib/marineSeries'
import type { Vessel } from '../lib/ais'
import type { Detection } from '../lib/detection'
import type { Typhoon } from '../lib/typhoon'
import type { BaseLayerId } from '../lib/baseLayers'
import type { TideEvent, SeaAreaForecast } from '../lib/cwaMarine'
import type { CwaAlert } from '../lib/cwaAlerts'
import {
  loadSaved,
  persistSaved,
  loadHistory,
  persistHistory,
  pushHistory,
  newId,
  type SavedCoord,
  type HistItem,
} from '../lib/savedCoords'
import {
  loadGroups,
  persistGroups,
  loadPoints,
  persistPoints,
  loadHidden,
  persistHidden,
  type PoiGroup,
  type PoiPoint,
} from '../lib/poi'
import { loadRadar, persistRadar, newRadarId, type RadarSite } from '../lib/radar'
import { loadRepeaters, persistRepeaters, newRepeaterId, type Repeater } from '../lib/radio'
import { loadLookouts, persistLookouts, newLookoutId, type Lookout } from '../lib/lookout'
import { isSecureLockSet } from '../lib/secure'
import { loadUiScale, persistUiScale, applyUiScale } from '../lib/uiScale'

/**
 * 全域戰術狀態 —— 整個 App 唯一的「真相來源 (single source of truth)」。
 *
 * 設計重點：UI 元件只負責「改狀態」，地圖圖層由 LayerControl 監聽狀態後
 * 自動 add/remove。這樣就不會有兩個地方同時操作 Leaflet 而邏輯打架。
 */
interface TacticalState {
  // ── 核心：當前戰術模式（互斥）─────────────────────────
  mode: TacticalMode

  // ── 光學模式的參數 ───────────────────────────────────
  /** 最大雲量 %（注入 WMS 的 MAXCC 參數）。 */
  maxCloudCover: number
  /** 歷史觀測日期（YYYY-MM-DD）。 */
  observationDate: string
  /** 免金鑰光學影像來源：esri=高解析空拍(沿岸最銳利)、eox=Sentinel-2無雲(10m平滑)、nasa=每日MODIS(有雲/較糊)。 */
  opticalSource: 'nasa' | 'esri' | 'eox' | 'ocean'
  /** 光學模式：true=改用 Sentinel-1 雷達(穿雲/夜視)同日期，false=Sentinel-2 真彩。需 Instance ID。 */
  opticalRadar: boolean
  /** 亮點掃描：每次按鈕 +1 觸發一次掃描。 */
  scanTick: number
  /** 掃描靈敏度（門檻 kStd，越小越敏感）。 */
  scanSensitivity: number
  /** 掃描到的疑似目標（含框、分類、AIS 比對）。 */
  brightSpots: Detection[]

  // ── AI 分析結果 ─────────────────────────────────────
  detections: DetectionCollection | null
  aiStatus: 'idle' | 'loading' | 'done' | 'error'
  aiError: string | null

  // ── 使用者框選的分析區域 ─────────────────────────────
  selecting: boolean
  selectedBBox: BBox | null

  // ── 搜救推演模式 (rescue) ────────────────────────────
  /** 落海點（最後已知位置）。 */
  manOverboard: { lat: number; lng: number } | null
  /** 該點的即時海象。 */
  rescueEnv: MarineEnv | null
  /** 漂流預測結果（順推：往未來漂）。 */
  driftPoints: DriftPoint[]
  /** 回推來源結果（逆推：從datum往前推來源）。 */
  sourcePoints: DriftPoint[]
  rescueStatus: 'idle' | 'loading' | 'done'
  /** 時間軸拉桿的小時數（0 = 不顯示 scrubber）。 */
  scrubHours: number
  /** 漂流物體類型的風壓係數 (leeway)。 */
  driftLeeway: number
  /** 目前選的漂流物體類型 id。 */
  driftTargetId: string
  /** 漂流推演方向：forward=落海點往未來漂；backward=發現點回推來源。 */
  driftMode: 'forward' | 'backward'
  /** 回報/落海時間（epoch ms）。可為過去，用逐時歷史海象積分。 */
  incidentTime: number
  /** 該點的逐時風/洋流序列（時變漂流用）。 */
  rescueSeries: HourlySeries | null
  /** 是否顯示蒙地卡羅機率密度圖 (SAROPS 式)。 */
  showProbability: boolean
  /** 蒙地卡羅結果摘要（峰值/質心/95% 半徑 m），供搜索航線與報告使用。 */
  mcSummary: {
    peak: { lat: number; lng: number } | null
    centroid: { lat: number; lng: number } | null
    radius95: number
  } | null
  /** 是否顯示平行梳掃搜索航線。 */
  showSearchPattern: boolean
  /** 航線間距（海浬）＝有效搜索寬度。 */
  trackSpacingNm: number

  // ── AIS 船舶識別 (ais) ──────────────────────────────
  vessels: Vessel[]
  /** 疊「VIIRS 夜間漁火」衛星圖層（免金鑰，看外海漁船燈光）。 */
  showBoatLights: boolean
  /** 疊「Sentinel-1 雷達暗船」圖層（需金鑰，看不廣播 AIS 的金屬船）。 */
  showRadarVessels: boolean

  // ── 海況熱力圖 (seastate) ────────────────────────────
  /** 熱力圖顯示哪個欄位：海溫或浪高。 */
  seaStateField: 'sst' | 'wave'
  /** 目前畫面資料的實際範圍（動態上色/圖例用）。 */
  seaStateRange: { min: number; max: number } | null

  // ── CWA 在地官方海象（潮汐 / 海面預報）────────────────
  /** 落海點附近的 CWA 潮汐事件（null=未取得/未設定）。 */
  cwaTide: TideEvent[] | null
  /** CWA 台灣各海域海面天氣/波浪預報。 */
  cwaSeaAreas: SeaAreaForecast[] | null
  /** CWA 目前生效天氣警特報（強風/濃霧/大雨…）。 */
  cwaAlerts: CwaAlert[] | null

  // ── 颱風 (typhoon) ───────────────────────────────────
  /** 主要颱風（最接近台灣者），供控制面板算警報/解讀。 */
  activeTyphoon: Typhoon | null
  /** 所有活動中颱風（由近到遠）；多颱時全部畫在圖上。 */
  activeTyphoons: Typhoon[]
  /** 颱風時間軸：拖曳看「+N 小時」暴風圈預判位置（0=關）。 */
  tyScrubHours: number

  // ── 環境時間動畫 (envanim) ───────────────────────────
  /** 動畫目前顯示的小時 epoch（0=未載入）。 */
  animEpoch: number
  /** 動畫是否播放中。 */
  animPlaying: boolean
  /** 動畫可用的時間點(epoch) 陣列。 */
  animTimes: number[]

  // ── 底圖選擇（戰術暗色 / 中文電子地圖 / 中文衛星混合）──
  baseLayer: BaseLayerId

  /** 目前開啟的工具面板 id（由工具總表啟動；null=全部關閉）。 */
  openTool: string | null
  /** 介面字體大小倍率（0.9/1.0/1.15/1.3）；改根 font-size 讓全站等比縮放。 */
  uiScale: number

  // ── 領海基線/鄰接區參考線（跨模式覆蓋層）────────────
  showTerritorial: boolean
  /** 風場圖層（風向風速箭頭，跨模式常駐）。 */
  showWind: boolean
  /** 離岸風電場圖層。 */
  showWindFarms: boolean
  /** 台灣海峽中線（示意）。 */
  showMedianLine: boolean
  /** 主要漁港／避風港。 */
  showPorts: boolean
  /** 即時降雨雷達（RainViewer）。 */
  showRainRadar: boolean
  /** 能見度/霧況（Open-Meteo）。 */
  showVisibility: boolean
  /** 金馬外離島禁／限制水域（示意）。 */
  showRestricted: boolean
  /** 台日／台菲 暫定執法線（示意）。 */
  showEnforceLine: boolean
  /** OpenSeaMap 航海標記（燈塔／浮標／航道／水深，免金鑰）。 */
  showSeamark: boolean
  /** 航道／分道通航（OSM）。 */
  showFairway: boolean
  /** 海底電纜（OSM）。 */
  showCable: boolean
  /** 沙洲／淺灘（OSM＋內建示意）。 */
  showShoal: boolean

  // ── 無線電中繼台覆蓋（私密，localStorage）──────────────────
  repeaters: Repeater[]
  /** 回收桶：最近刪除的中繼台（可還原，防誤刪）。最多留 20 筆，不持久化。 */
  radioTrash: Repeater[]
  showRepeater: boolean
  /** 編輯模式：開啟後地圖上的中繼台記號可拖曳微調位置（防誤觸預設關）。 */
  radioEdit: boolean
  /** 正在編輯的中繼台 id（點地圖記號或清單✏️帶入表單修改）。 */
  radioEditingId: string | null
  /** 正在編輯的雷達站 id。 */
  radarEditingId: string | null
  /** 通訊死角標示：多台覆蓋聯集後仍收不到的網格反白。 */
  showRadioGap: boolean
  /** 目前死角是否已納入地形遮蔽（true=含山後死角；false=僅視距圓估算）。 */
  radioGapTerrain: boolean
  /** 現場單位定位（數位回傳座標）：測距＋鏈路研判用。 */
  radioProbe: { lat: number; lng: number; label: string } | null
  /** 地形遮蔽覆蓋多邊形（key=中繼台 id）。 */
  terrainRings: Record<string, [number, number][]>
  /** 顯示地形遮蔽覆蓋（取代圓圈）。 */
  showTerrain: boolean
  /** 地形高程計算中。 */
  terrainBusy: boolean

  // ── 雷達涵蓋規劃（私密，localStorage）─────────────────────
  radarSites: RadarSite[]
  showRadar: boolean
  /** 小艇死角高亮：對每站疊「漁船10m 對比 小艇2m」涵蓋，凸顯縫隙。 */
  showRadarGap: boolean
  /** 雷達地形遮蔽覆蓋多邊形（key=雷達站 id）。 */
  radarTerrainRings: Record<string, [number, number][]>
  /** 顯示雷達地形遮蔽（取代圓圈）。 */
  showRadarTerrain: boolean
  /** 離岸風電雷達雜波區：把離岸風電場標成雷達雜波/陰影（偵測可信度低）。 */
  showWindClutter: boolean
  /** 雷達地形計算中（與無線電的 terrainBusy 分開，避免互相卡住）。 */
  radarTerrainBusy: boolean

  // ── 瞭望哨視域（私密，localStorage）───────────────────────
  lookouts: Lookout[]
  /** 回收桶：最近刪除的瞭望哨（可還原，防誤刪）。最多 20 筆，不持久化。 */
  lookoutTrash: Lookout[]
  showLookout: boolean
  /** 瞭望哨地形視域多邊形（key=哨所 id）。 */
  lookoutRings: Record<string, [number, number][]>
  /** 顯示地形視域（取代圓圈）。 */
  showLookoutTerrain: boolean
  /** 視域計算中。 */
  lookoutBusy: boolean

  // ── 機敏功能鎖（縱深防禦第二層）───────────────────────────
  /** 是否已設定機敏 PIN（設了 → 機敏功能預設隱藏）。 */
  secureHasLock: boolean
  /** 本次工作階段是否已解鎖（重開即歸零，不持久化）。 */
  secureUnlocked: boolean
  /** 解鎖 PIN 輸入視窗是否開啟（由不明顯手勢觸發）。 */
  securePromptOpen: boolean

  // ── 地圖飛行目標（座標查詢用，設定後地圖飛過去再清空）────
  flyToTarget: { lat: number; lng: number; zoom?: number } | null
  /** 縮放至涵蓋這些點（設定後 fitBounds 再清空）；供「一次看到全部船」用。 */
  fitPointsTarget: [number, number][] | null
  /**
   * 搜尋定位預覽標記（地址/地名/電線桿搜尋用）：純暫時、**不存 localStorage**、
   * 不寫入「最近用過」。離開/重整就消失——沒按「存成點位/釘選」就是沒儲存。
   */
  searchMarker: { lat: number; lng: number; label: string } | null

  // ── 量測工具（距離/方位，跨模式）──────────────────────
  measuring: boolean
  measurePoints: { lat: number; lng: number }[]
  /** 距離圈中心（浬同心圓，判斷「幾浬內」）；null=關閉。 */
  rangeCenter: { lat: number; lng: number } | null
  /** 攔截解算的圖上疊層（我方→攔截點、目標→攔截點）；null=不顯示。 */
  interceptSolution: {
    own: { lat: number; lng: number }
    target: { lat: number; lng: number }
    point: { lat: number; lng: number }
  } | null
  /** 從地圖上點船「攔截／推算此船」時，把船的位置與航向航速帶進對應面板。 */
  targetPrefill: { lat: number; lng: number; cog: number; sog: number; name: string } | null

  // ── 座標管理：已存(最愛/釘選) + 歷史（localStorage 持久化）──
  savedCoords: SavedCoord[]
  coordHistory: HistItem[]

  // ── 自訂點位/群組（檢查據點等，私有・只存本機）───────────
  poiGroups: PoiGroup[]
  poiPoints: PoiPoint[]
  /** 一鍵全部隱藏（旁邊有人時保護隱私）。 */
  poiHidden: boolean

  // ── 地圖畫面中心（給「在中心新增點位」用）─────────────
  mapView: { lat: number; lng: number; zoom: number }

  // ── 我的位置 (GPS，跨模式保留) ──────────────────────
  ownPosition: { lat: number; lng: number; accuracy: number } | null
  /** 航跡記錄中（連續 GPS）。 */
  trackRecording: boolean
  /** 自船航跡點（搜索覆蓋麵包屑）。 */
  ownTrack: { lat: number; lng: number }[]

  // ── 狀態列訊息（給海上人員的即時回饋）───────────────
  statusMessage: string

  // ── actions ─────────────────────────────────────────
  setMode: (mode: TacticalMode) => void
  setMaxCloudCover: (v: number) => void
  setObservationDate: (d: string) => void
  setOpticalSource: (s: 'nasa' | 'esri' | 'eox' | 'ocean') => void
  setOpticalRadar: (v: boolean) => void
  bumpScan: () => void
  setScanSensitivity: (v: number) => void
  setBrightSpots: (s: Detection[]) => void
  setDetections: (d: DetectionCollection | null) => void
  setAiStatus: (s: TacticalState['aiStatus'], error?: string | null) => void
  setSelecting: (v: boolean) => void
  setSelectedBBox: (b: BBox | null) => void
  setStatus: (msg: string) => void
  setManOverboard: (p: { lat: number; lng: number } | null) => void
  setRescueResult: (env: MarineEnv | null, points: DriftPoint[]) => void
  setRescueStatus: (s: TacticalState['rescueStatus']) => void
  setVessels: (v: Vessel[]) => void
  setShowBoatLights: (b: boolean) => void
  setShowRadarVessels: (b: boolean) => void
  setOwnPosition: (p: TacticalState['ownPosition']) => void
  toggleTrackRecording: () => void
  pushTrackPoint: (p: { lat: number; lng: number }) => void
  clearTrack: () => void
  setFlyTo: (t: { lat: number; lng: number; zoom?: number } | null) => void
  /** 縮放地圖至涵蓋所有給定點（空/單點自動忽略）。 */
  fitPoints: (pts: [number, number][] | null) => void
  /** 跳到座標並記錄歷史（座標查詢/清單點擊共用）。 */
  gotoCoord: (lat: number, lng: number, zoom?: number) => void
  /**
   * 搜尋預覽：飛到座標並放暫時定位標記 📍，但**不記錄歷史、不存檔**。
   * 供地址/地名/電線桿搜尋用——只看、不儲存。
   */
  previewCoord: (lat: number, lng: number, label?: string, zoom?: number) => void
  /** 清除搜尋定位預覽標記。 */
  clearSearchMarker: () => void
  /** 新增一筆已存座標（釘選或最愛）。 */
  addSavedCoord: (c: { lat: number; lng: number; label?: string; pinned?: boolean; favorite?: boolean }) => void
  updateSavedCoord: (id: string, patch: Partial<SavedCoord>) => void
  removeSavedCoord: (id: string) => void
  clearHistory: () => void
  toggleMeasure: () => void
  addMeasurePoint: (p: { lat: number; lng: number }) => void
  updateMeasurePoint: (i: number, p: { lat: number; lng: number }) => void
  popMeasurePoint: () => void
  clearMeasure: () => void
  setRangeCenter: (p: { lat: number; lng: number } | null) => void
  setInterceptSolution: (
    s: {
      own: { lat: number; lng: number }
      target: { lat: number; lng: number }
      point: { lat: number; lng: number }
    } | null,
  ) => void
  setTargetPrefill: (
    p: { lat: number; lng: number; cog: number; sog: number; name: string } | null,
  ) => void
  setOpenTool: (id: string | null) => void
  setUiScale: (v: number) => void
  setBaseLayer: (id: BaseLayerId) => void
  setShowTerritorial: (v: boolean) => void
  setShowWind: (v: boolean) => void
  setShowWindFarms: (v: boolean) => void
  setShowMedianLine: (v: boolean) => void
  setShowPorts: (v: boolean) => void
  setShowRainRadar: (v: boolean) => void
  setShowVisibility: (v: boolean) => void
  setShowRestricted: (v: boolean) => void
  setShowEnforceLine: (v: boolean) => void
  setShowSeamark: (v: boolean) => void
  setShowFairway: (v: boolean) => void
  setShowCable: (v: boolean) => void
  setShowShoal: (v: boolean) => void
  setShowRepeater: (v: boolean) => void
  /** 一鍵關閉所有疊加圖層（底圖不動）。 */
  clearAllOverlays: () => void
  addRepeater: (r: Omit<Repeater, 'id'>) => void
  updateRepeater: (id: string, patch: Partial<Repeater>) => void
  removeRepeater: (id: string) => void
  /** 從回收桶還原一筆中繼台。 */
  restoreRepeater: (id: string) => void
  /** 清空中繼台回收桶。 */
  clearRadioTrash: () => void
  /** 匯入一批中繼台（備份還原用，會自動配新 id、避免覆蓋現有）。 */
  importRepeaters: (list: Omit<Repeater, 'id'>[]) => void
  setRadioProbe: (p: TacticalState['radioProbe']) => void
  setRadioEdit: (v: boolean) => void
  setRadioEditingId: (id: string | null) => void
  setRadarEditingId: (id: string | null) => void
  setShowRadioGap: (v: boolean) => void
  setRadioGapTerrain: (v: boolean) => void
  setShowTerrain: (v: boolean) => void
  setTerrainBusy: (v: boolean) => void
  setTerrainRing: (id: string, ring: [number, number][]) => void
  clearTerrain: () => void
  setShowRadar: (v: boolean) => void
  setShowRadarGap: (v: boolean) => void
  setShowWindClutter: (v: boolean) => void
  setShowRadarTerrain: (v: boolean) => void
  setRadarTerrainBusy: (v: boolean) => void
  setRadarTerrainRing: (id: string, ring: [number, number][]) => void
  clearRadarTerrain: () => void
  setSecureHasLock: (v: boolean) => void
  setSecureUnlocked: (v: boolean) => void
  setSecurePromptOpen: (v: boolean) => void
  addRadarSite: (s: Omit<RadarSite, 'id'>) => void
  updateRadarSite: (id: string, patch: Partial<RadarSite>) => void
  removeRadarSite: (id: string) => void
  setShowLookout: (v: boolean) => void
  addLookout: (l: Omit<Lookout, 'id'>) => void
  removeLookout: (id: string) => void
  restoreLookout: (id: string) => void
  clearLookoutTrash: () => void
  importLookouts: (list: Omit<Lookout, 'id'>[]) => void
  setShowLookoutTerrain: (v: boolean) => void
  setLookoutBusy: (v: boolean) => void
  setLookoutRing: (id: string, ring: [number, number][]) => void
  clearLookoutTerrain: () => void
  setSeaStateField: (f: 'sst' | 'wave') => void
  setSeaStateRange: (r: { min: number; max: number } | null) => void
  setCwaTide: (t: TideEvent[] | null) => void
  setCwaAlerts: (a: CwaAlert[] | null) => void
  setCwaSeaAreas: (s: SeaAreaForecast[] | null) => void
  setActiveTyphoon: (t: Typhoon | null) => void
  setActiveTyphoons: (list: Typhoon[]) => void
  setTyScrubHours: (h: number) => void
  setAnimEpoch: (e: number) => void
  setAnimPlaying: (v: boolean) => void
  setAnimTimes: (t: number[]) => void
  setScrubHours: (h: number) => void
  setDriftTarget: (id: string, leeway: number) => void
  setDriftPoints: (points: DriftPoint[]) => void
  setSourcePoints: (points: DriftPoint[]) => void
  setDriftMode: (m: 'forward' | 'backward') => void
  setIncidentTime: (t: number) => void
  setRescueSeries: (s: HourlySeries | null) => void
  setShowProbability: (v: boolean) => void
  setMcSummary: (s: TacticalState['mcSummary']) => void
  setShowSearchPattern: (v: boolean) => void
  setTrackSpacingNm: (nm: number) => void
  // 自訂點位/群組
  addPoiGroup: (g: { name: string; icon: string; color: string }) => string
  updatePoiGroup: (id: string, patch: Partial<Omit<PoiGroup, 'id'>>) => void
  removePoiGroup: (id: string) => void
  addPoiPoint: (p: { groupId: string; label: string; lat: number; lng: number; note?: string; elevM?: number | null }) => void
  updatePoiPoint: (id: string, patch: Partial<Omit<PoiPoint, 'id'>>) => void
  removePoiPoint: (id: string) => void
  setPoiHidden: (v: boolean) => void
  setMapView: (v: { lat: number; lng: number; zoom: number }) => void
}

// 預設用「昨天」：衛星影像（GIBS/Sentinel）當天常還沒處理好，昨天最保險。
const today = new Date(Date.now() - 86400000).toISOString().slice(0, 10)

export const useTacticalStore = create<TacticalState>((set, get) => ({
  mode: 'orbit',
  maxCloudCover: 100,
  observationDate: today,
  opticalSource: 'esri',
  opticalRadar: false,
  scanTick: 0,
  scanSensitivity: 3,
  brightSpots: [],
  detections: null,
  aiStatus: 'idle',
  aiError: null,
  selecting: false,
  selectedBBox: null,
  manOverboard: null,
  rescueEnv: null,
  driftPoints: [],
  sourcePoints: [],
  rescueStatus: 'idle',
  scrubHours: 0,
  driftLeeway: 0.014,
  driftTargetId: 'piw',
  driftMode: 'forward',
  incidentTime: Date.now(),
  rescueSeries: null,
  showProbability: false,
  mcSummary: null,
  showSearchPattern: false,
  trackSpacingNm: 1,
  vessels: [],
  showBoatLights: false,
  showRadarVessels: false,
  seaStateField: 'sst',
  seaStateRange: null,
  activeTyphoon: null,
  activeTyphoons: [],
  tyScrubHours: 0,
  cwaTide: null,
  cwaSeaAreas: null,
  cwaAlerts: null,
  animEpoch: 0,
  animPlaying: false,
  animTimes: [],
  flyToTarget: null,
  searchMarker: null,
  fitPointsTarget: null,
  savedCoords: loadSaved(),
  coordHistory: loadHistory(),
  poiGroups: loadGroups(),
  poiPoints: loadPoints(),
  poiHidden: loadHidden(),
  mapView: { lat: 24.0, lng: 121.5, zoom: 7 },
  measuring: false,
  measurePoints: [],
  rangeCenter: null,
  interceptSolution: null,
  targetPrefill: null,
  ownPosition: null,
  trackRecording: false,
  ownTrack: [],
  baseLayer: ((): BaseLayerId => {
    const v = (() => {
      try {
        return localStorage.getItem('argus.baseLayer.v1')
      } catch {
        return null
      }
    })()
    const valid: BaseLayerId[] = ['dark', 'nlsc', 'nlscPhoto', 'satColor', 'esri', 'sentinel2', 'sentinel1']
    return valid.includes(v as BaseLayerId) ? (v as BaseLayerId) : 'dark'
  })(),
  openTool: null,
  uiScale: loadUiScale(),
  showTerritorial: false,
  showWind: false,
  showWindFarms: false,
  showMedianLine: false,
  showPorts: false,
  showRainRadar: false,
  showVisibility: false,
  showRestricted: false,
  showEnforceLine: false,
  showSeamark: false,
  showFairway: false,
  showCable: false,
  showShoal: false,
  repeaters: loadRepeaters(),
  radioTrash: [],
  showRepeater: false,
  radioEdit: false,
  radioEditingId: null,
  radarEditingId: null,
  showRadioGap: false,
  radioGapTerrain: false,
  radioProbe: null,
  terrainRings: {},
  showTerrain: false,
  terrainBusy: false,
  radarSites: loadRadar(),
  showRadar: false,
  showRadarGap: false,
  showWindClutter: false,
  radarTerrainRings: {},
  showRadarTerrain: false,
  radarTerrainBusy: false,
  lookouts: loadLookouts(),
  lookoutTrash: [],
  showLookout: false,
  lookoutRings: {},
  showLookoutTerrain: false,
  lookoutBusy: false,
  secureHasLock: isSecureLockSet(),
  secureUnlocked: false,
  securePromptOpen: false,
  statusMessage: '軌道預警模式待命中',

  setMode: (mode) =>
    set(() => ({
      mode,
      // 切模式時清掉上一個模式殘留的結果與框選，避免圖層疊加打架。
      detections: null,
      selecting: false,
      selectedBBox: null,
      aiStatus: 'idle',
      aiError: null,
      // 離開搜救/AIS 時清掉其狀態
      manOverboard: null,
      rescueEnv: null,
      driftPoints: [],
      sourcePoints: [],
      rescueStatus: 'idle',
      scrubHours: 0,
      driftLeeway: 0.014,
      driftTargetId: 'piw',
      driftMode: 'forward',
      incidentTime: Date.now(),
      rescueSeries: null,
      showProbability: false,
      mcSummary: null,
      showSearchPattern: false,
      trackSpacingNm: 1,
      // 注意：vessels 不清空——保留最後已知 AIS，供光學亮點掃描做「無AIS=可疑」比對。
      brightSpots: [],
      cwaTide: null,
      cwaSeaAreas: null,
      animPlaying: false,
      animTimes: [],
      animEpoch: 0,
      seaStateRange: null,
      tyScrubHours: 0,
      statusMessage: MODE_HINT[mode],
    })),

  setMaxCloudCover: (v) => set({ maxCloudCover: v }),
  setObservationDate: (d) => set({ observationDate: d }),
  setOpticalSource: (s: 'nasa' | 'esri' | 'eox' | 'ocean') => set({ opticalSource: s }),
  setOpticalRadar: (v) => set({ opticalRadar: v }),
  bumpScan: () => set((st) => ({ scanTick: st.scanTick + 1 })),
  setScanSensitivity: (v) => set({ scanSensitivity: v }),
  setBrightSpots: (s) => set({ brightSpots: s }),
  setDetections: (d) => set({ detections: d }),
  setAiStatus: (s, error = null) => set({ aiStatus: s, aiError: error }),
  setSelecting: (v) => set({ selecting: v }),
  setSelectedBBox: (b) => set({ selectedBBox: b }),
  setStatus: (msg) => set({ statusMessage: msg }),
  setManOverboard: (p) => set({ manOverboard: p }),
  setRescueResult: (env, points) => set({ rescueEnv: env, driftPoints: points }),
  setRescueStatus: (s) => set({ rescueStatus: s }),
  setVessels: (v) => set({ vessels: v }),
  setShowBoatLights: (b) => set({ showBoatLights: b }),
  setShowRadarVessels: (b) => set({ showRadarVessels: b }),
  setOwnPosition: (p) => set({ ownPosition: p }),
  toggleTrackRecording: () =>
    set((st) => ({ trackRecording: !st.trackRecording, ownTrack: st.trackRecording ? st.ownTrack : [] })),
  pushTrackPoint: (p) =>
    set((st) => {
      const last = st.ownTrack[st.ownTrack.length - 1]
      // 去抖：距上一點 <15m 不記，避免原地漂移塞爆
      if (last) {
        const dLat = (p.lat - last.lat) * 111000
        const dLng = (p.lng - last.lng) * 111000 * Math.cos(last.lat * 0.0174533)
        if (Math.hypot(dLat, dLng) < 15) return {}
      }
      return { ownTrack: [...st.ownTrack, p] }
    }),
  clearTrack: () => set({ ownTrack: [] }),
  setFlyTo: (t) => set({ flyToTarget: t }),
  fitPoints: (pts) => set({ fitPointsTarget: pts }),
  gotoCoord: (lat, lng, zoom) =>
    set((st) => {
      const coordHistory = pushHistory(st.coordHistory, lat, lng, Date.now())
      persistHistory(coordHistory)
      return { flyToTarget: { lat, lng, zoom: zoom ?? 12 }, coordHistory }
    }),
  // 搜尋預覽：只飛過去＋放暫時標記，不寫歷史、不存檔（離開即消失）。
  previewCoord: (lat, lng, label, zoom) =>
    set({
      flyToTarget: { lat, lng, zoom: zoom ?? 14 },
      searchMarker: { lat, lng, label: label?.trim() || `${lat.toFixed(5)}, ${lng.toFixed(5)}` },
    }),
  clearSearchMarker: () => set({ searchMarker: null }),
  addSavedCoord: (c) =>
    set((st) => {
      const now = Date.now()
      const item: SavedCoord = {
        id: newId(now),
        lat: c.lat,
        lng: c.lng,
        label: c.label?.trim() || defaultLabel(st.savedCoords.length + 1),
        favorite: c.favorite ?? false,
        pinned: c.pinned ?? false,
        createdAt: now,
      }
      const savedCoords = [item, ...st.savedCoords]
      persistSaved(savedCoords)
      return { savedCoords }
    }),
  updateSavedCoord: (id, patch) =>
    set((st) => {
      const savedCoords = st.savedCoords.map((c) => (c.id === id ? { ...c, ...patch } : c))
      persistSaved(savedCoords)
      return { savedCoords }
    }),
  removeSavedCoord: (id) =>
    set((st) => {
      const savedCoords = st.savedCoords.filter((c) => c.id !== id)
      persistSaved(savedCoords)
      return { savedCoords }
    }),
  clearHistory: () =>
    set(() => {
      persistHistory([])
      return { coordHistory: [] }
    }),
  toggleMeasure: () =>
    set((st) => ({ measuring: !st.measuring, measurePoints: st.measuring ? st.measurePoints : [] })),
  addMeasurePoint: (p) => set((st) => ({ measurePoints: [...st.measurePoints, p] })),
  updateMeasurePoint: (i, p) =>
    set((st) => ({ measurePoints: st.measurePoints.map((q, idx) => (idx === i ? p : q)) })),
  popMeasurePoint: () => set((st) => ({ measurePoints: st.measurePoints.slice(0, -1) })),
  clearMeasure: () => set({ measurePoints: [] }),
  setRangeCenter: (p) => set({ rangeCenter: p }),
  setInterceptSolution: (s) => set({ interceptSolution: s }),
  setTargetPrefill: (p) => set({ targetPrefill: p }),
  setOpenTool: (id) => set({ openTool: id }),
  setUiScale: (v) => {
    persistUiScale(v)
    applyUiScale(v)
    set({ uiScale: v })
  },
  setBaseLayer: (id) => {
    try {
      localStorage.setItem('argus.baseLayer.v1', id)
    } catch {
      /* ignore */
    }
    set({ baseLayer: id })
  },
  setShowTerritorial: (v) => set({ showTerritorial: v }),
  setShowWind: (v) => set({ showWind: v }),
  setShowWindFarms: (v) => set({ showWindFarms: v }),
  setShowMedianLine: (v) => set({ showMedianLine: v }),
  setShowPorts: (v) => set({ showPorts: v }),
  setShowRainRadar: (v) => set({ showRainRadar: v }),
  setShowVisibility: (v) => set({ showVisibility: v }),
  setShowRestricted: (v) => set({ showRestricted: v }),
  setShowEnforceLine: (v) => set({ showEnforceLine: v }),
  setShowSeamark: (v) => set({ showSeamark: v }),
  setShowFairway: (v) => set({ showFairway: v }),
  setShowCable: (v) => set({ showCable: v }),
  setShowShoal: (v) => set({ showShoal: v }),
  setShowRepeater: (v) => set({ showRepeater: v }),
  clearAllOverlays: () =>
    set({
      showTerritorial: false,
      showWind: false,
      showWindFarms: false,
      showMedianLine: false,
      showPorts: false,
      showRainRadar: false,
      showVisibility: false,
      showRestricted: false,
      showEnforceLine: false,
      showSeamark: false,
      showFairway: false,
      showCable: false,
      showShoal: false,
      showRadar: false,
      showRepeater: false,
      showLookout: false,
    }),
  addRepeater: (r) => {
    const item: Repeater = { ...r, id: newRepeaterId() }
    const repeaters = [...get().repeaters, item]
    persistRepeaters(repeaters)
    set({ repeaters, showRepeater: true })
  },
  updateRepeater: (id, patch) => {
    const st = get()
    const repeaters = st.repeaters.map((r) => (r.id === id ? { ...r, ...patch } : r))
    persistRepeaters(repeaters)
    // 位置變了→原地形視域多邊形已失準，丟掉該站的舊 ring（避免顯示在舊位置）
    if (patch.lat !== undefined || patch.lng !== undefined) {
      const terrainRings = { ...st.terrainRings }
      delete terrainRings[id]
      set({ repeaters, terrainRings })
    } else {
      set({ repeaters })
    }
  },
  removeRepeater: (id) => {
    const st = get()
    const gone = st.repeaters.find((r) => r.id === id)
    const repeaters = st.repeaters.filter((r) => r.id !== id)
    persistRepeaters(repeaters)
    // 推進回收桶（最新在前，最多 20 筆），可還原防誤刪
    const radioTrash = gone ? [gone, ...st.radioTrash].slice(0, 20) : st.radioTrash
    set({ repeaters, radioTrash })
  },
  restoreRepeater: (id) => {
    const st = get()
    const back = st.radioTrash.find((r) => r.id === id)
    if (!back) return
    const repeaters = [...st.repeaters, back]
    persistRepeaters(repeaters)
    set({ repeaters, radioTrash: st.radioTrash.filter((r) => r.id !== id), showRepeater: true })
  },
  clearRadioTrash: () => set({ radioTrash: [] }),
  importRepeaters: (incoming) => {
    const st = get()
    const added: Repeater[] = incoming.map((r) => ({ ...r, id: newRepeaterId() }))
    const repeaters = [...st.repeaters, ...added]
    persistRepeaters(repeaters)
    set({ repeaters, showRepeater: true })
  },
  setRadioProbe: (p) => set({ radioProbe: p, showRepeater: true }),
  setRadioEdit: (v) => set({ radioEdit: v }),
  setRadioEditingId: (id) => set({ radioEditingId: id }),
  setRadarEditingId: (id) => set({ radarEditingId: id }),
  setShowRadioGap: (v) => set({ showRadioGap: v }),
  setRadioGapTerrain: (v) => set({ radioGapTerrain: v }),
  setShowTerrain: (v) => set({ showTerrain: v }),
  setTerrainBusy: (v) => set({ terrainBusy: v }),
  setTerrainRing: (id, ring) => set((st) => ({ terrainRings: { ...st.terrainRings, [id]: ring } })),
  clearTerrain: () => set({ terrainRings: {}, showTerrain: false }),
  setShowRadar: (v) => set({ showRadar: v }),
  setShowRadarGap: (v) => set({ showRadarGap: v }),
  setShowWindClutter: (v) => set({ showWindClutter: v }),
  setShowRadarTerrain: (v) => set({ showRadarTerrain: v }),
  setRadarTerrainBusy: (v) => set({ radarTerrainBusy: v }),
  setRadarTerrainRing: (id, ring) => set((st) => ({ radarTerrainRings: { ...st.radarTerrainRings, [id]: ring } })),
  clearRadarTerrain: () => set({ radarTerrainRings: {}, showRadarTerrain: false }),
  setSecureHasLock: (v) => set({ secureHasLock: v }),
  setSecureUnlocked: (v) => set({ secureUnlocked: v }),
  setSecurePromptOpen: (v) => set({ securePromptOpen: v }),
  addRadarSite: (s) => {
    const site: RadarSite = { ...s, id: newRadarId() }
    const radarSites = [...get().radarSites, site]
    persistRadar(radarSites)
    set({ radarSites, showRadar: true })
  },
  updateRadarSite: (id, patch) => {
    const radarSites = get().radarSites.map((r) => (r.id === id ? { ...r, ...patch } : r))
    persistRadar(radarSites)
    set({ radarSites })
  },
  removeRadarSite: (id) => {
    const radarSites = get().radarSites.filter((r) => r.id !== id)
    persistRadar(radarSites)
    set({ radarSites })
  },
  setShowLookout: (v) => set({ showLookout: v }),
  addLookout: (l) => {
    const item: Lookout = { ...l, id: newLookoutId() }
    const lookouts = [...get().lookouts, item]
    persistLookouts(lookouts)
    set({ lookouts, showLookout: true })
  },
  removeLookout: (id) => {
    const st = get()
    const gone = st.lookouts.find((l) => l.id === id)
    const lookouts = st.lookouts.filter((l) => l.id !== id)
    persistLookouts(lookouts)
    // 連同該哨視域多邊形一起移除；推進回收桶可還原
    const lookoutRings = { ...st.lookoutRings }
    delete lookoutRings[id]
    const lookoutTrash = gone ? [gone, ...st.lookoutTrash].slice(0, 20) : st.lookoutTrash
    set({ lookouts, lookoutRings, lookoutTrash })
  },
  restoreLookout: (id) => {
    const st = get()
    const back = st.lookoutTrash.find((l) => l.id === id)
    if (!back) return
    const lookouts = [...st.lookouts, back]
    persistLookouts(lookouts)
    set({ lookouts, lookoutTrash: st.lookoutTrash.filter((l) => l.id !== id), showLookout: true })
  },
  clearLookoutTrash: () => set({ lookoutTrash: [] }),
  importLookouts: (incoming) => {
    const st = get()
    const added: Lookout[] = incoming.map((l) => ({ ...l, id: newLookoutId() }))
    const lookouts = [...st.lookouts, ...added]
    persistLookouts(lookouts)
    set({ lookouts, showLookout: true })
  },
  setShowLookoutTerrain: (v) => set({ showLookoutTerrain: v }),
  setLookoutBusy: (v) => set({ lookoutBusy: v }),
  setLookoutRing: (id, ring) => set((st) => ({ lookoutRings: { ...st.lookoutRings, [id]: ring } })),
  clearLookoutTerrain: () => set({ lookoutRings: {}, showLookoutTerrain: false }),
  setSeaStateField: (f) => set({ seaStateField: f }),
  setSeaStateRange: (r) => set({ seaStateRange: r }),
  setCwaTide: (t) => set({ cwaTide: t }),
  setCwaAlerts: (a) => set({ cwaAlerts: a }),
  setCwaSeaAreas: (s) => set({ cwaSeaAreas: s }),
  setActiveTyphoon: (t) => set({ activeTyphoon: t }),
  setActiveTyphoons: (list) => set({ activeTyphoons: list }),
  setTyScrubHours: (h) => set({ tyScrubHours: h }),
  setAnimEpoch: (e) => set({ animEpoch: e }),
  setAnimPlaying: (v) => set({ animPlaying: v }),
  setAnimTimes: (t) => set({ animTimes: t }),
  setScrubHours: (h) => set({ scrubHours: h }),
  setDriftTarget: (id, leeway) => set({ driftTargetId: id, driftLeeway: leeway }),
  setDriftPoints: (points) => set({ driftPoints: points }),
  setSourcePoints: (points) => set({ sourcePoints: points }),
  setDriftMode: (m) => set({ driftMode: m }),
  setIncidentTime: (t) => set({ incidentTime: t }),
  setRescueSeries: (s) => set({ rescueSeries: s }),
  setShowProbability: (v) => set({ showProbability: v }),
  setMcSummary: (s) => set({ mcSummary: s }),
  setShowSearchPattern: (v) => set({ showSearchPattern: v }),
  setTrackSpacingNm: (nm) => set({ trackSpacingNm: nm }),
  addPoiGroup: (g) => {
    const id = newId(Date.now())
    set((st) => {
      const poiGroups = [...st.poiGroups, { id, name: g.name.trim() || '新群組', icon: g.icon, color: g.color, visible: true }]
      persistGroups(poiGroups)
      return { poiGroups }
    })
    return id
  },
  updatePoiGroup: (id, patch) =>
    set((st) => {
      const poiGroups = st.poiGroups.map((g) => (g.id === id ? { ...g, ...patch } : g))
      persistGroups(poiGroups)
      return { poiGroups }
    }),
  removePoiGroup: (id) =>
    set((st) => {
      const poiGroups = st.poiGroups.filter((g) => g.id !== id)
      const poiPoints = st.poiPoints.filter((p) => p.groupId !== id) // 連同群組內點位一起刪
      persistGroups(poiGroups)
      persistPoints(poiPoints)
      return { poiGroups, poiPoints }
    }),
  addPoiPoint: (p) =>
    set((st) => {
      const now = Date.now()
      const item: PoiPoint = {
        id: newId(now),
        groupId: p.groupId,
        label: p.label.trim() || '未命名點位',
        lat: p.lat,
        lng: p.lng,
        note: p.note?.trim() || undefined,
        elevM: p.elevM,
        createdAt: now,
      }
      const poiPoints = [item, ...st.poiPoints]
      persistPoints(poiPoints)
      return { poiPoints }
    }),
  updatePoiPoint: (id, patch) =>
    set((st) => {
      const poiPoints = st.poiPoints.map((p) => (p.id === id ? { ...p, ...patch } : p))
      persistPoints(poiPoints)
      return { poiPoints }
    }),
  removePoiPoint: (id) =>
    set((st) => {
      const poiPoints = st.poiPoints.filter((p) => p.id !== id)
      persistPoints(poiPoints)
      return { poiPoints }
    }),
  setPoiHidden: (v) => {
    persistHidden(v)
    set({ poiHidden: v })
  },
  setMapView: (v) => set({ mapView: v }),
}))

function defaultLabel(n: number): string {
  return `座標 ${n}`
}

const MODE_HINT: Record<TacticalMode, string> = {
  basic: '基本地圖：無疊層（點下方模式啟動；再點一下同一個即關閉回此畫面）',
  orbit: '軌道預警模式：衛星過境預報',
  sar: '雷達盲搜模式：框選海域以啟動 AI 辨識',
  optical: '沿岸光學模式：Sentinel-2 光學影像',
  ais: 'AIS 船舶識別模式：即時船位載入中',
  rescue: '搜救推演模式：點地圖標記落海點，計算漂流',
  seastate: '海況熱力圖模式：載入海溫/浪高分佈',
  envanim: '環境時間動畫：播放風場/洋流隨時間變化',
  typhoon: '颱風路徑：顯示颱風位置/暴風圈/預報路徑',
}
