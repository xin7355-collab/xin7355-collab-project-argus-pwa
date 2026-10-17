import { useEffect } from 'react'
import L from 'leaflet'
import { useTacticalStore } from '../store/tacticalStore'
import { chooseScale } from '../lib/scaleBar'

/** 比例尺最長畫多寬（px）。 */
const MAX_PX = 110

/**
 * 比例尺（跟著設定的距離單位走，預設浬）。
 *
 * Leaflet 內建的只有公里／英哩；本專案規定距離預設用浬（海上溝通用浬）。
 * 外觀沿用 Leaflet 的 .leaflet-control-scale-line，跟版權字擺在一起。
 */
export function ScaleControl({ map }: { map: L.Map }) {
  const unit = useTacticalStore((s) => s.distUnit)

  useEffect(() => {
    const Ctl = L.Control.extend({
      onAdd() {
        const wrap = L.DomUtil.create('div', 'leaflet-control-scale leaflet-control')
        const line = L.DomUtil.create('div', 'leaflet-control-scale-line', wrap)
        const update = () => {
          const y = map.getSize().y / 2
          const a = map.containerPointToLatLng([0, y])
          const b = map.containerPointToLatLng([MAX_PX, y])
          const c = chooseScale(map.distance(a, b), unit)
          if (!c) {
            wrap.style.display = 'none'
            return
          }
          wrap.style.display = ''
          line.style.width = `${Math.round(MAX_PX * c.ratio)}px`
          line.textContent = c.text
        }
        update()
        map.on('move zoom resize', update)
        ;(this as unknown as { _off: () => void })._off = () => map.off('move zoom resize', update)
        return wrap
      },
      onRemove() {
        ;(this as unknown as { _off?: () => void })._off?.()
      },
    })
    const ctl = new Ctl({ position: 'bottomleft' })
    ctl.addTo(map)
    return () => {
      ctl.remove()
    }
  }, [map, unit])

  return null
}
