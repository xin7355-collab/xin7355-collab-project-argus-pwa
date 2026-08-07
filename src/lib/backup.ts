// ── 設定/資料 匯出與匯入（備份還原）───────────────────────
//
// 把 App 存在此裝置的所有資料（金鑰設定、最愛/釘選座標、歷史）打包成一個
// 純 JSON 檔，iOS/Android 都能開啟閱讀；匯入同格式檔即可還原到新裝置。

import { saveOrShareText } from './fileShare'

const PREFIX = 'argus.'

export interface BackupFile {
  app: '阿爾戈斯'
  kind: 'backup'
  version: 1
  exportedAt: string
  data: Record<string, unknown>
}

/** 收集所有 argus.* 的 localStorage 內容為可讀 JSON 字串。 */
export function buildBackup(nowIso: string): string {
  const data: Record<string, unknown> = {}
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (!k || !k.startsWith(PREFIX)) continue
    const raw = localStorage.getItem(k)
    try {
      data[k] = raw ? JSON.parse(raw) : raw
    } catch {
      data[k] = raw
    }
  }
  const file: BackupFile = {
    app: '阿爾戈斯',
    kind: 'backup',
    version: 1,
    exportedAt: nowIso,
    data,
  }
  return JSON.stringify(file, null, 2)
}

/** 觸發下載／分享備份（iOS 走分享表單，桌機走下載）。回傳採用的方式。 */
export function downloadBackup(nowIso: string) {
  const text = buildBackup(nowIso)
  const stamp = nowIso.slice(0, 10).replace(/-/g, '')
  return saveOrShareText(`阿爾戈斯-備份-${stamp}.json`, text, 'application/json')
}

/** 解析匯入的檔案內容，還原到 localStorage。回傳還原的鍵數；格式不符則丟錯。 */
export function restoreBackup(text: string): number {
  const obj = JSON.parse(text) as Partial<BackupFile>
  if (!obj || obj.kind !== 'backup' || typeof obj.data !== 'object' || !obj.data) {
    throw new Error('不是有效的阿爾戈斯備份檔')
  }
  let n = 0
  for (const [k, v] of Object.entries(obj.data)) {
    if (!k.startsWith(PREFIX)) continue
    localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v))
    n++
  }
  return n
}
