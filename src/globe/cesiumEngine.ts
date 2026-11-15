// ── 3D 地球（Cesium）：只在打開 3D 地球時才載入 ───────────────────
//
// 這個檔案連同 Cesium 本體會被打包成獨立的一包（約 3.8 MB，壓縮後約 1 MB），只有按了「🌐 3D 地球」才下載；
// 也不放進離線快取（vite.config.ts 的 globIgnores），手機安裝 App 時不會被迫下載。
//
// 不用 Cesium ion（要申請 token）：底圖用 Esri 免金鑰的衛星圖磚（跟 2D「衛星」同一家），
// 地形用平滑橢球（海上用不到山的高度）。所以不需要任何金鑰。
//
// 省電：requestRenderMode——畫面沒變就不重畫；資料更新時才 requestRender。

import {
  CesiumWidget,
  ImageryLayer,
  UrlTemplateImageryProvider,
  EllipsoidTerrainProvider,
  Credit,
  Cartesian2,
  Cartesian3,
  Color,
  PointPrimitiveCollection,
  LabelCollection,
  PolylineCollection,
  Material,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  NearFarScalar,
  LabelStyle,
  VerticalOrigin,
  Math as CMath,
  Cartographic,
  defined,
  type PointPrimitive,
  type Label,
} from 'cesium'
import 'cesium/Build/Cesium/Widgets/CesiumWidget/CesiumWidget.css'
import type { CameraView } from '../lib/director'

const ESRI_IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const ESRI_LABELS = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'

/** 點了地球上的東西：哪一類、哪一個。 */
export type PickRef = { kind: 'ship'; id: string } | { kind: 'plane'; id: string } | { kind: 'sat'; id: string }

export interface GlobePoint {
  id: string
  lon: number
  lat: number
  /** 離地高度（公尺）。 */
  alt: number
  color: string
  size?: number
}

export interface SatPoint {
  id: string
  /** ECEF（公尺）。 */
  pos: [number, number, number]
  color: string
  /** 有名字才畫標籤（只標重要的幾顆，不然一片字）。 */
  label?: string
}

export interface EngineOptions {
  container: HTMLElement
  start: { lon: number; lat: number; height: number }
  /** 手機上省一點：解析度、圖磚快取打折。 */
  light: boolean
  onPick: (ref: PickRef | null) => void
  onError: (message: string) => void
}

export class GlobeEngine {
  private widget: CesiumWidget
  private ships: PointPrimitiveCollection
  private planes: PointPrimitiveCollection
  private sats: PointPrimitiveCollection
  private satLabels: LabelCollection
  private orbit: PolylineCollection
  private handler: ScreenSpaceEventHandler
  private satIndex = new Map<string, { point: PointPrimitive; label: Label | null }>()
  private flying: { cancel: () => void } | null = null

  constructor(o: EngineOptions) {
    // 建立失敗（顯示晶片／瀏覽器不支援）會直接丟錯，由呼叫端轉成白話
    this.widget = new CesiumWidget(o.container, {
      baseLayer: new ImageryLayer(
        new UrlTemplateImageryProvider({ url: ESRI_IMAGERY, maximumLevel: 18, credit: new Credit('Esri, Maxar, Earthstar Geographics') }),
      ),
      terrainProvider: new EllipsoidTerrainProvider(),
      requestRenderMode: true,
      maximumRenderTimeChange: Infinity,
      // Cesium 預設會在畫面上印出原始錯誤訊息（英文、堆疊）；改由我們講白話
      showRenderLoopErrors: false,
      msaaSamples: o.light ? 1 : 4,
      // 手機省下星空貼圖（6 張約 0.9 MB，壓縮不了）；海上用不到星星
      skyBox: o.light ? false : undefined,
    })
    const scene = this.widget.scene
    this.widget.imageryLayers.addImageryProvider(
      new UrlTemplateImageryProvider({ url: ESRI_LABELS, maximumLevel: 18, credit: new Credit('Esri') }),
    )
    if (o.light) {
      this.widget.resolutionScale = 0.8
      scene.globe.tileCacheSize = 50
      scene.globe.maximumScreenSpaceError = 3
    }
    scene.renderError.addEventListener(() =>
      o.onError('3D 繪圖出錯（多半是記憶體不夠或顯示晶片問題），已停止。關掉 3D 地球再開一次；常發生的話請改用電腦。'),
    )

    this.ships = scene.primitives.add(new PointPrimitiveCollection())
    this.planes = scene.primitives.add(new PointPrimitiveCollection())
    this.sats = scene.primitives.add(new PointPrimitiveCollection())
    this.satLabels = scene.primitives.add(new LabelCollection())
    this.orbit = scene.primitives.add(new PolylineCollection())

    scene.camera.setView({ destination: Cartesian3.fromDegrees(o.start.lon, o.start.lat, o.start.height) })

    this.handler = new ScreenSpaceEventHandler(scene.canvas)
    this.handler.setInputAction((e: { position: Cartesian2 }) => {
      const picked = scene.pick(e.position)
      const ref = defined(picked) && picked.id && typeof picked.id === 'object' && 'kind' in picked.id ? (picked.id as PickRef) : null
      o.onPick(ref)
    }, ScreenSpaceEventType.LEFT_CLICK)
  }

  private render() {
    this.widget.scene.requestRender()
  }

  private fill(coll: PointPrimitiveCollection, kind: 'ship' | 'plane', pts: GlobePoint[]) {
    coll.removeAll()
    for (const p of pts) {
      coll.add({
        position: Cartesian3.fromDegrees(p.lon, p.lat, p.alt),
        pixelSize: p.size ?? 7,
        color: Color.fromCssColorString(p.color),
        outlineColor: Color.fromCssColorString('#0f172a'),
        outlineWidth: 1,
        id: { kind, id: p.id } satisfies PickRef,
        // 遠看縮小一點，近看清楚
        scaleByDistance: new NearFarScalar(1e5, 1.2, 2e7, 0.6),
      })
    }
    this.render()
  }

  setShips(pts: GlobePoint[]) {
    this.fill(this.ships, 'ship', pts)
  }

  setPlanes(pts: GlobePoint[]) {
    this.fill(this.planes, 'plane', pts)
  }

  /** 衛星位置每秒更新：已有的只移位置，不整批重建。 */
  setSats(pts: SatPoint[]) {
    const seen = new Set<string>()
    for (const s of pts) {
      seen.add(s.id)
      const pos = new Cartesian3(s.pos[0], s.pos[1], s.pos[2])
      const e = this.satIndex.get(s.id)
      if (e) {
        e.point.position = pos
        if (e.label) e.label.position = pos
        continue
      }
      const point = this.sats.add({
        position: pos,
        pixelSize: 6,
        color: Color.fromCssColorString(s.color),
        outlineColor: Color.BLACK,
        outlineWidth: 1,
        id: { kind: 'sat', id: s.id } satisfies PickRef,
      })
      const label = s.label
        ? this.satLabels.add({
            position: pos,
            text: s.label,
            font: '12px sans-serif',
            fillColor: Color.fromCssColorString(s.color),
            outlineColor: Color.BLACK,
            outlineWidth: 3,
            style: LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: VerticalOrigin.BOTTOM,
            pixelOffset: new Cartesian2(0, -8),
            // 太遠就不顯示字，不然整顆地球都是字
            translucencyByDistance: new NearFarScalar(5e6, 1, 3e7, 0),
          })
        : null
      this.satIndex.set(s.id, { point, label })
    }
    for (const [id, e] of this.satIndex) {
      if (seen.has(id)) continue
      this.sats.remove(e.point)
      if (e.label) this.satLabels.remove(e.label)
      this.satIndex.delete(id)
    }
    this.render()
  }

  /** 選到的衛星畫「接下來一圈」；給空陣列就清掉。 */
  setOrbit(path: [number, number, number][], color: string) {
    this.orbit.removeAll()
    if (path.length > 1) {
      this.orbit.add({
        positions: path.map((p) => new Cartesian3(p[0], p[1], p[2])),
        width: 2,
        material: Material.fromType('Color', { color: Color.fromCssColorString(color).withAlpha(0.8) }),
      })
    }
    this.render()
  }

  /** 資料出處（例如 adsb.lol 的 ODbL 要求註明），一直顯示在畫面下方。 */
  addCredit(text: string) {
    this.widget.creditDisplay.addStaticCredit(new Credit(text))
    this.render()
  }

  showShips(v: boolean) {
    this.ships.show = v
    this.render()
  }
  showPlanes(v: boolean) {
    this.planes.show = v
    this.render()
  }
  showSats(v: boolean) {
    this.sats.show = v
    this.satLabels.show = v
    this.orbit.show = v
    this.render()
  }

  /** 目前鏡頭（導演鏡頭「記下這個畫面」用）。角度用度。 */
  getView(): CameraView {
    const c = this.widget.scene.camera
    const g = c.positionCartographic
    return {
      lon: CMath.toDegrees(g.longitude),
      lat: CMath.toDegrees(g.latitude),
      height: g.height,
      heading: CMath.toDegrees(c.heading),
      pitch: CMath.toDegrees(c.pitch),
      roll: CMath.toDegrees(c.roll),
    }
  }

  /** 畫面正中央看到的地面位置與鏡頭高度（回 2D 時用）；看著太空時回 null。 */
  centerOnGround(): { lat: number; lon: number; height: number } | null {
    const scene = this.widget.scene
    const canvas = scene.canvas
    const hit = scene.camera.pickEllipsoid(new Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2))
    if (!hit) return null
    const g = Cartographic.fromCartesian(hit)
    const dist = Cartesian3.distance(scene.camera.positionWC, hit)
    return { lat: CMath.toDegrees(g.latitude), lon: CMath.toDegrees(g.longitude), height: dist }
  }

  /** 飛到一個鏡頭。飛完 resolve；被打斷（使用者拖了畫面、或按停止）reject。 */
  flyTo(v: CameraView, seconds: number): Promise<void> {
    this.cancelFlight()
    return new Promise((resolve, reject) => {
      const cam = this.widget.scene.camera
      this.flying = {
        cancel: () => {
          cam.cancelFlight()
          reject(new DOMException('停止播放', 'AbortError'))
        },
      }
      cam.flyTo({
        destination: Cartesian3.fromDegrees(v.lon, v.lat, v.height),
        orientation: { heading: CMath.toRadians(v.heading), pitch: CMath.toRadians(v.pitch), roll: CMath.toRadians(v.roll) },
        duration: seconds,
        complete: () => {
          this.flying = null
          resolve()
        },
        cancel: () => {
          this.flying = null
          reject(new DOMException('飛行被打斷', 'AbortError'))
        },
      })
    })
  }

  cancelFlight() {
    const f = this.flying
    this.flying = null
    f?.cancel()
  }

  destroy() {
    this.cancelFlight()
    this.handler.destroy()
    // 釋放 WebGL 資源：不釋放的話來回開關幾次，手機記憶體會被吃光
    this.widget.destroy()
  }
}
