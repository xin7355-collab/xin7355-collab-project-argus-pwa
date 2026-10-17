import type { TacticalMode } from '../types'

// ── 功能總覽：所有入口集中在一個地方、分組、一屏看完 ─────────────
//
// 舊版有兩套入口：底部「橫滑」的 8 個模式大按鈕（一次只看得到兩個半），
// 加上右上角 🧰 裡的 13 個工具格。使用者要先知道「有這個功能」才會去滑、去點。
// 改成依「要做什麼事」分組的一張清單：偵蒐、海象、搜救、定位量測、通訊涵蓋。
//
// 純資料，方便測試「每個模式／工具都有入口、沒有重複、上鎖時看不到雷達」。

export type LaunchKind =
  /** 切換戰術模式（互斥，同時只開一個）。 */
  | 'mode'
  /** 開工具面板（openTool）。 */
  | 'tool'
  /** 一次性動作（一鍵掃描、設定…）。 */
  | 'action'

export interface LaunchItem {
  id: string
  kind: LaunchKind
  icon: string
  /** 格子上的字，越短越好（手機一排四格）。 */
  label: string
  /** 長按或模式標題列上的一句話說明。 */
  hint: string
}

export interface LaunchGroup {
  title: string
  items: LaunchItem[]
}

const m = (id: TacticalMode, icon: string, label: string, hint: string): LaunchItem => ({
  id,
  kind: 'mode',
  icon,
  label,
  hint,
})
const t = (id: string, icon: string, label: string, hint: string): LaunchItem => ({
  id,
  kind: 'tool',
  icon,
  label,
  hint,
})
const a = (id: string, icon: string, label: string, hint: string): LaunchItem => ({
  id,
  kind: 'action',
  icon,
  label,
  hint,
})

export const GROUPS: LaunchGroup[] = [
  {
    title: '看船・偵蒐',
    items: [
      a('quickscan', '⚡', '一鍵掃描', '這片海現在有什麼：自動切影像、掃亮點、比對 AIS'),
      m('ais', '🚢', 'AIS 船位', '即時船位、異常警示、點船看資料'),
      m('optical', '🌤️', '衛星影像', '選日期看沿岸光學影像、前後對照、掃描目標'),
      m('sar', '📡', '雷達盲搜', 'Sentinel-1 雷達：穿雲、夜間看金屬船身'),
      m('orbit', '🛰️', '衛星過境', '哪顆衛星幾點會掃到這片海'),
    ],
  },
  {
    title: '海象・天氣',
    items: [
      m('seastate', '🌊', '海況', '海溫、浪高、風速熱圖'),
      m('envanim', '🎬', '風流動畫', '風場、洋流時序動畫'),
      m('typhoon', '🌀', '颱風', '颱風路徑、暴風圈、侵襲預判'),
      t('nightops', '🌙', '日月光照', '日出沒、月相、夜間照度'),
    ],
  },
  {
    title: '搜救・攔截',
    items: [
      m('rescue', '🆘', '漂流推演', '落海人／救生筏漂流預判、搜索圖樣'),
      t('intercept', '🎯', '攔截計算', '該操什麼航向、多久追上'),
      t('dr', '🧭', '推算船位', '依航向航速推算未來或回推過去位置'),
    ],
  },
  {
    title: '定位・量測',
    items: [
      t('coord', '📌', '座標', '輸入座標、最愛、釘選、歷史'),
      t('measure', '📐', '量距離', '點地圖量距離與方位'),
      t('rings', '◎', '距離圈', '以我為中心的 1/3/5/12/24 浬同心圓'),
      t('fieldops', '🏷️', '現場點位', '地址、電線桿定位、自訂據點'),
    ],
  },
  {
    title: '通訊・涵蓋',
    items: [
      t('radio', '📻', '無線電', '中繼台涵蓋、死角、測距'),
      t('radar', '📡', '雷達涵蓋', '沿岸／風電雷達涵蓋與遮蔽'),
      t('microwave', '📶', '微波鏈路', '備用鏈路路徑遮蔽、雨衰'),
      t('lookout', '👁️', '瞭望哨', '目視範圍與死角'),
    ],
  },
  {
    title: '地圖與設定',
    items: [
      t('layers', '🗂️', '圖層', '界線、天氣、航道、自訂點位疊圖'),
      t('offline', '⬇️', '離線地圖', '下載目前畫面，沒訊號也能看'),
      a('settings', '⚙️', '設定', '金鑰、字體大小、距離單位、備份'),
    ],
  },
]

/**
 * 抽屜收起時那一排（最常用的）。一排最多五格，iPhone 寬度才放得下。
 * 「更多」不在這裡：收起時往上拉就是全部功能。
 */
export const PEEK_IDS = ['quickscan', 'ais', 'optical', 'rescue', 'seastate'] as const

export interface LaunchContext {
  /** 機敏鎖上鎖中——雷達涵蓋整格不出現（外人看不到有這個功能）。 */
  radarLocked: boolean
}

/** 依目前狀態過濾後的分組（上鎖時拿掉雷達涵蓋；空的組不顯示）。 */
export function visibleGroups(ctx: LaunchContext, groups: LaunchGroup[] = GROUPS): LaunchGroup[] {
  return groups
    .map((g) => ({ ...g, items: g.items.filter((i) => !(i.id === 'radar' && i.kind === 'tool' && ctx.radarLocked)) }))
    .filter((g) => g.items.length > 0)
}

/** 依 id 找項目（模式與工具的 id 不會撞，見測試）。 */
export function findItem(id: string, groups: LaunchGroup[] = GROUPS): LaunchItem | undefined {
  for (const g of groups) for (const i of g.items) if (i.id === id) return i
  return undefined
}

/** 模式的顯示資訊（標題列用）。 */
export function modeMeta(mode: TacticalMode): LaunchItem | undefined {
  const it = findItem(mode)
  return it && it.kind === 'mode' ? it : undefined
}
