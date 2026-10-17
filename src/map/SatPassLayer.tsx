import { useEffect } from 'react'
import L from 'leaflet'
import { useTacticalStore } from '../store/tacticalStore'
import { splitAtDateline, swathEdges } from '../lib/groundTrack'
import { formatDist } from '../lib/units'

// ── 選定那一趟衛星過境的地面軌跡與掃幅帶 ────────────────────
//
// 跟 IssLayer 的差別：這裡的位置來自 SGP4 + 真實軌道根數（TLE），
// 不是圓軌道近似，也不需要「已知星下點」當錨點。
//
// 要誠實講的一件事（popup 裡也有寫）：這條帶是「衛星的感測器掃得到的範圍」，
// 不等於「一定會拍並且公開」。Sentinel/Landsat 都有取像排程，開闊外海常常
// 不在排程內。這個模型管不到排程，只能回答幾何上掃不掃得到。

const COLOR = '#a78bfa'

/** 一律 24 小時制。toLocaleTimeString 的 zh-TW 會給「下午07:52」，
 *  跟面板上的 19:52 對不起來，海上看時刻最怕這種不一致。 */
function hhmm(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function SatPassLayer({ map }: { map: L.Map }) {
  const satPass = useTacticalStore((s) => s.satPass)
  const unit = useTacticalStore((s) => s.distUnit)

  useEffect(() => {
    if (!satPass || satPass.points.length < 2) return
    const g = L.layerGroup().addTo(map)

    const info =
      `<b style="color:${COLOR}">🛰️ ${satPass.craft}</b><br/>` +
      `掃過這片海 ${hhmm(satPass.startMs)} – ${hhmm(satPass.endMs)}（本地時間）<br/>` +
      `最接近 ${hhmm(satPass.closestMs)}　掃幅 ${formatDist(satPass.swathKm, unit, 0)}<br/>` +
      '<span style="color:#94a3b8;font-size:11px">位置由 SGP4 + 真實軌道根數算出。' +
      '這條帶是感測器「掃得到」的範圍，不等於「一定會拍」——' +
      'Sentinel／Landsat 都有取像排程，開闊外海常常不在排程內。</span>'

    // 掃幅帶：先畫，才不會蓋住中心線
    for (const seg of splitAtDateline(satPass.points)) {
      const { left, right } = swathEdges(seg, satPass.swathKm)
      if (left.length > 1) {
        L.polygon([...left, ...right], {
          color: COLOR,
          weight: 1,
          opacity: 0.6,
          fillColor: COLOR,
          fillOpacity: 0.16,
        })
          .bindPopup(info)
          .addTo(g)
      }
      L.polyline(
        seg.map((p) => [p.lat, p.lng] as [number, number]),
        { color: COLOR, weight: 2, opacity: 0.85 },
      )
        .bindPopup(info)
        .addTo(g)
    }

    // 最接近的那一刻標出來——使用者要知道「幾點正對著我」
    const mid =
      satPass.points.find((p) => p.at >= satPass.closestMs) ??
      satPass.points[Math.floor(satPass.points.length / 2)]
    L.marker([mid.lat, mid.lng], {
      icon: L.divIcon({
        className: '',
        html:
          `<div class="radio-marker" style="border-color:${COLOR};color:${COLOR}">🛰️` +
          `<div class="radio-label" style="color:${COLOR}">${hhmm(satPass.closestMs)}</div></div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      }),
    })
      .bindPopup(info)
      .addTo(g)

    return () => {
      g.clearLayers()
      map.removeLayer(g)
    }
  }, [satPass, unit, map])

  return null
}
