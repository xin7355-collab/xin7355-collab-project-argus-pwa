// ── 海域參考圖資（離岸風電場 / 台海中線）─────────────────────
//
// 態勢感知用「示意位置」，非官方精確劃界；實際範圍/邊界以航港局公告與各離岸
// 風電場施工圖為準。對海上：離岸風電場＝作業區/限制航行/避碰熱點；中線＝越界監控參考。

export interface WindFarm {
  name: string
  /** 場區約略中心。 */
  lat: number
  lng: number
  /** 約略半徑(km)——畫圈示意涵蓋範圍。 */
  radiusKm: number
  status: '營運' | '建置中' | '規劃'
}

/** 台灣西部外海主要離岸風電場（示意中心，由北到南）。 */
export const WIND_FARMS: WindFarm[] = [
  { name: '海洋風電 Formosa 1（竹南外海）', lat: 24.71, lng: 120.84, radiusKm: 5, status: '營運' },
  { name: '海能風電 Formosa 2（苗栗外海）', lat: 24.6, lng: 120.62, radiusKm: 8, status: '營運' },
  { name: '中能離岸風電（彰化外海）', lat: 24.12, lng: 120.1, radiusKm: 8, status: '建置中' },
  { name: '台電一期（彰化外海）', lat: 24.05, lng: 120.3, radiusKm: 5, status: '營運' },
  { name: '大彰化 東南／西南（彰化外海）', lat: 23.98, lng: 119.98, radiusKm: 15, status: '營運' },
  { name: '海龍 Hai Long（彰化外海）', lat: 23.9, lng: 119.88, radiusKm: 12, status: '建置中' },
  { name: '允能離岸風電 Yunlin（雲林外海）', lat: 23.83, lng: 120.1, radiusKm: 10, status: '營運' },
]

export interface Port {
  name: string
  lat: number
  lng: number
}

/** 台灣主要漁港／商港（避風、就近調度、救難後送用；位置為近似）。 */
export const PORTS: Port[] = [
  { name: '基隆／八斗子', lat: 25.147, lng: 121.78 },
  { name: '宜蘭 烏石港', lat: 24.868, lng: 121.833 },
  { name: '蘇澳／南方澳', lat: 24.583, lng: 121.868 },
  { name: '花蓮港', lat: 23.997, lng: 121.62 },
  { name: '台東 成功（新港）', lat: 23.099, lng: 121.383 },
  { name: '台東 富岡', lat: 22.797, lng: 121.187 },
  { name: '恆春 後壁湖', lat: 21.949, lng: 120.744 },
  { name: '屏東 東港', lat: 22.468, lng: 120.443 },
  { name: '高雄港', lat: 22.613, lng: 120.281 },
  { name: '高雄 興達港', lat: 22.861, lng: 120.216 },
  { name: '台南 安平', lat: 23.0, lng: 120.157 },
  { name: '嘉義 布袋', lat: 23.382, lng: 120.148 },
  { name: '嘉義 東石', lat: 23.459, lng: 120.153 },
  { name: '雲林 台西', lat: 23.72, lng: 120.19 },
  { name: '彰化 王功', lat: 24.03, lng: 120.35 },
  { name: '台中港', lat: 24.29, lng: 120.52 },
  { name: '新竹漁港', lat: 24.852, lng: 120.921 },
  { name: '澎湖 馬公', lat: 23.566, lng: 119.564 },
  { name: '金門 料羅', lat: 24.419, lng: 118.402 },
  { name: '綠島 南寮', lat: 22.66, lng: 121.492 },
  { name: '蘭嶼 開元', lat: 22.057, lng: 121.531 },
]

/**
 * 台灣海峽中線（示意，非官方劃界）：由東北往西南橫貫海峽的參考線，
 * 供海上監控越界態勢用。座標為近似，實際以官方公告為準。
 */
export const MEDIAN_LINE: [number, number][] = [
  [26.5, 121.5],
  [25.5, 120.4],
  [24.5, 119.3],
  [23.5, 118.4],
  [22.8, 117.9],
]

// ── 金馬外離島 禁止／限制水域（示意）─────────────────────────
//
// 依《金門馬祖東沙南沙地區安全及輔導條例》劃設的禁止水域（近岸）與限制水域
// （外緣），供海上處置大陸漁船越界抽砂/捕撈態勢參考。這裡以「示意半徑圈」
// 呈現概略範圍，非精確界線；實際範圍以國防部/主管機關公告航行圖為準。

export interface RestrictedZone {
  name: string
  lat: number
  lng: number
  /** 禁止水域外緣約略半徑(km)。 */
  banKm: number
  /** 限制水域外緣約略半徑(km)。 */
  limitKm: number
}

export const RESTRICTED_ZONES: RestrictedZone[] = [
  { name: '金門（大金門）', lat: 24.436, lng: 118.318, banKm: 4, limitKm: 11 },
  { name: '烈嶼（小金門）', lat: 24.43, lng: 118.24, banKm: 3, limitKm: 8 },
  { name: '馬祖 南竿', lat: 26.155, lng: 119.94, banKm: 4, limitKm: 11 },
  { name: '馬祖 北竿', lat: 26.222, lng: 120.0, banKm: 3, limitKm: 9 },
  { name: '馬祖 東引', lat: 26.367, lng: 120.492, banKm: 3, limitKm: 9 },
  { name: '烏坵', lat: 24.99, lng: 119.452, banKm: 3, limitKm: 8 },
]

// ── 暫定執法線 / 重疊海域（示意）────────────────────────────
//
// 供海上掌握對外漁業執法邊界態勢：台日漁業協議適用海域外緣、台菲重疊海域
// （巴士海峽）中間線。座標為概略示意，非官方精確劃界，實務以主管機關頒布之
// 執法海域圖與外交協議為準。

export interface Shoal {
  name: string
  lat: number
  lng: number
  /** 約略半徑(km)——沙洲會隨潮汐/季節堆積移動，位置為近似。 */
  radiusKm: number
}

/** 台灣主要沙洲／淺灘（擱淺危險；OSM 抓不到時的內建示意，位置近似且會變動）。 */
export const SHOALS: Shoal[] = [
  { name: '外傘頂洲（嘉義外海）', lat: 23.48, lng: 120.07, radiusKm: 6 },
  { name: '網仔寮汕（台南七股）', lat: 23.16, lng: 120.03, radiusKm: 3 },
  { name: '頂頭額汕（台南七股）', lat: 23.11, lng: 120.02, radiusKm: 3 },
  { name: '新浮崙汕（台南）', lat: 23.05, lng: 120.03, radiusKm: 2.5 },
  { name: '台灣灘（海峽西南淺堆）', lat: 22.5, lng: 118.5, radiusKm: 40 },
]

export interface EnforcementLine {
  name: string
  color: string
  path: [number, number][]
}

export const ENFORCEMENT_LINES: EnforcementLine[] = [
  {
    // 台日漁業協議適用海域「暫定執法線」概略外緣（釣魚台－八重山北方海域）
    name: '台日漁業 暫定執法線（示意）',
    color: '#fbbf24',
    path: [
      [26.7, 122.1],
      [26.3, 123.0],
      [25.8, 123.7],
      [25.2, 124.4],
      [24.6, 124.6],
    ],
  },
  {
    // 台菲（巴士海峽）重疊海域概略中間線
    name: '台菲 巴士海峽 重疊海域中線（示意）',
    color: '#f472b6',
    path: [
      [21.05, 120.3],
      [20.75, 121.3],
      [20.55, 122.3],
      [20.4, 123.3],
    ],
  },
]
