// ── 離岸風電對雷達的兩種影響（機制不同，不可混為一談）──────────
//
//   1) Doppler 假回跡（false echo）
//      葉片旋轉葉尖速度可達 80–90 m/s，在雷達上產生與「移動船隻」相同量級的
//      都卜勒頻移。MTI／都卜勒濾波無法把它濾掉，結果是風場範圍內憑空出現
//      會動的目標。這與高度無關、與遮蔽無關——即使雷達站遠高於風機也照樣發生。
//      影響範圍 ＝ 風場本身的範圍。
//
//   2) 塔架幾何遮蔽（shadow）
//      葉尖高度以下的視線被塔架與葉片擋住，風場「後方」形成陰影。
//      這與高度有關，但不能只比「天線頂 vs 葉尖高」——朝低矮目標的視線是
//      下降的，天線比葉尖高仍可能全遮：260m 天線看 2m 目標，到 50km 外的
//      風場處視線只剩約 110m，照樣低於 200m 葉尖。因此一律以數值掃描判斷
//      「視線何時重新高過葉尖」，掃到涵蓋上限仍未恢復即為全遮。
//      台灣離岸風機葉尖高度多在 190–260m，沿岸雷達站幾乎都會整段被遮。
//
// 這兩者要分開標示：Doppler 是「這裡的目標可能是假的」，遮蔽是「這裡的目標看不到」。
// 前者會讓人追不存在的船，後者會讓人漏掉真的船，處置方式完全相反。

import type { OsmWindFarm } from './windfarmOsm'

const R_EARTH = 6371000
const DEG = Math.PI / 180

/** 台灣離岸風機葉尖高度的保守預設(m)：OSM 查不到高度標籤時採用。 */
export const DEFAULT_TIP_HEIGHT_M = 200

export function bearingDeg(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const la1 = aLat * DEG
  const la2 = bLat * DEG
  const dLo = (bLng - aLng) * DEG
  const y = Math.sin(dLo) * Math.cos(la2)
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLo)
  return (Math.atan2(y, x) / DEG + 360) % 360
}

export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLa = (bLat - aLat) * DEG
  const dLo = (bLng - aLng) * DEG
  const h =
    Math.sin(dLa / 2) ** 2 + Math.cos(aLat * DEG) * Math.cos(bLat * DEG) * Math.sin(dLo / 2) ** 2
  return (2 * R_EARTH * Math.asin(Math.sqrt(h))) / 1000
}

export interface WindShadow {
  farmName: string
  /** 從雷達看去的方位角範圍(度)。 */
  fromDeg: number
  toDeg: number
  /** 陰影起點(km)＝風場遠端。 */
  startKm: number
  /** 陰影終點(km)。等於涵蓋上限表示「後方全遮」。 */
  endKm: number
  /** true＝在涵蓋範圍內視線始終未高過葉尖，後方整段被遮。 */
  fullyShadowed: boolean
  /**
   * 天線頂是否低於葉尖。這是「必定全遮」的充分條件，但不是必要條件——
   * 天線比葉尖高仍可能全遮，因為朝低矮目標的視線是下降的：
   * 260m 天線看 2m 目標，在 50km 外的風場處視線只剩約 110m，照樣低於 200m 葉尖。
   * 因此本欄只供說明成因，判斷全遮與否一律以 fullyShadowed 為準。
   */
  antennaBelowTip: boolean
  /** 採用的葉尖高度(m)。 */
  tipM: number
  /** 葉尖高度是否為推定值（OSM 無標籤）。 */
  tipEstimated: boolean
}

/**
 * 算某座風場對某雷達站造成的陰影扇形。
 *
 * 遮蔽判定與地形一致：比較「視線在風場處的高度」與「葉尖高度＋地球曲率抬升」。
 * 視線高度 h(D) = Ht + (hr − Ht)·D/R，隨目標距離 R 變化，因此以數值掃描求出
 * 陰影延伸到多遠。回 null 表示此風場不在涵蓋範圍內或不造成遮蔽。
 */
export function windShadowFor(
  radar: { lat: number; lng: number; antennaTopM: number; targetM: number; maxKm: number; kFactor?: number },
  farm: OsmWindFarm,
): WindShadow | null {
  const ring = farm.ring?.length >= 3 ? farm.ring : null
  if (!ring) return null

  // 風場相對雷達的方位角範圍與距離範圍
  let minB = Infinity
  let maxB = -Infinity
  let nearKm = Infinity
  let farKm = 0
  const refB = bearingDeg(radar.lat, radar.lng, farm.center[0], farm.center[1])
  for (const [la, lo] of ring) {
    // 以場中心方位為基準展開到 ±180°，避免 0°/360° 跨界時扇形算成一整圈
    let rel = bearingDeg(radar.lat, radar.lng, la, lo) - refB
    while (rel > 180) rel -= 360
    while (rel < -180) rel += 360
    minB = Math.min(minB, rel)
    maxB = Math.max(maxB, rel)
    const d = distanceKm(radar.lat, radar.lng, la, lo)
    nearKm = Math.min(nearKm, d)
    farKm = Math.max(farKm, d)
  }
  if (!(farKm > 0) || nearKm > radar.maxKm) return null

  const tipEstimated = farm.tipHeightM == null
  const tipM = farm.tipHeightM ?? DEFAULT_TIP_HEIGHT_M
  const k = radar.kFactor ?? 4 / 3
  const Ht = radar.antennaTopM
  const hr = radar.targetM

  // 視線在風場遠端 D 處的高度是否高過葉尖（含地球曲率抬升）
  const clearsAt = (R: number): boolean => {
    const D = farKm
    if (R <= D) return true // 目標在風場之前，不受其遮蔽
    const dM = R * 1000
    const dmM = D * 1000
    const losH = Ht + ((hr - Ht) * dmM) / dM
    const bulge = (dmM * (dM - dmM)) / (2 * k * R_EARTH)
    return losH > tipM + bulge
  }

  // 一律用數值掃描找「視線重新高過葉尖」的距離。
  // 不能只靠 Ht <= tipM 判斷：朝低矮目標的視線是下降的，天線比葉尖高仍可能全遮。
  const antennaBelowTip = Ht <= tipM
  const step = Math.max(0.2, radar.maxKm / 300)
  let endKm = farKm
  let recovered = false
  for (let R = farKm + step; R <= radar.maxKm; R += step) {
    if (clearsAt(R)) {
      endKm = R
      recovered = true
      break
    }
    endKm = R
  }
  // 掃到涵蓋上限仍未恢復視線 → 後方整段被遮
  const fullyShadowed = !recovered
  if (endKm <= farKm + 0.01) return null // 沒有實質陰影

  return {
    farmName: farm.name,
    fromDeg: (refB + minB + 360) % 360,
    toDeg: (refB + maxB + 360) % 360,
    startKm: farKm,
    endKm,
    fullyShadowed,
    antennaBelowTip,
    tipM,
    tipEstimated,
  }
}

/** 由起點、方位、距離求終點（大圓）。 */
export function destPoint(lat: number, lng: number, brgDeg: number, km: number): [number, number] {
  const br = brgDeg * DEG
  const dR = (km * 1000) / R_EARTH
  const la1 = lat * DEG
  const lo1 = lng * DEG
  const la2 = Math.asin(Math.sin(la1) * Math.cos(dR) + Math.cos(la1) * Math.sin(dR) * Math.cos(br))
  const lo2 =
    lo1 + Math.atan2(Math.sin(br) * Math.sin(dR) * Math.cos(la1), Math.cos(dR) - Math.sin(la1) * Math.sin(la2))
  return [la2 / DEG, lo2 / DEG]
}

/** 把陰影扇形轉成可畫的多邊形（內弧 → 外弧）。 */
export function shadowPolygon(
  radar: { lat: number; lng: number },
  sh: WindShadow,
  arcSteps = 12,
): [number, number][] {
  let span = sh.toDeg - sh.fromDeg
  while (span > 180) span -= 360
  while (span < -180) span += 360
  const poly: [number, number][] = []
  for (let i = 0; i <= arcSteps; i++) {
    poly.push(destPoint(radar.lat, radar.lng, sh.fromDeg + (span * i) / arcSteps, sh.startKm))
  }
  for (let i = arcSteps; i >= 0; i--) {
    poly.push(destPoint(radar.lat, radar.lng, sh.fromDeg + (span * i) / arcSteps, sh.endKm))
  }
  return poly
}
