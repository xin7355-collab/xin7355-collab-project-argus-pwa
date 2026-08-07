// ── 自訂點位 CSV 匯入/匯出（Excel 直接開，免額外套件）─────────
//
// 欄位：群組,名稱,緯度,經度,海拔m,備註
// Excel、Google 試算表、Numbers 都能開/存成此格式。含 BOM 讓 Excel 正確顯示中文。

import type { PoiGroup, PoiPoint } from './poi'

const HEADER = ['群組', '名稱', '緯度', '經度', '海拔m', '備註']

function cell(v: unknown): string {
  const s = String(v ?? '')
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** 點位 → CSV 字串（含 UTF-8 BOM，Excel 開中文不亂碼）。 */
export function poiToCsv(groups: PoiGroup[], points: PoiPoint[]): string {
  const byId = new Map(groups.map((g) => [g.id, g]))
  const lines: string[][] = [HEADER]
  for (const p of points) {
    const g = byId.get(p.groupId)
    const elev = p.elevM != null ? String(Math.round(p.elevM)) : ''
    lines.push([g?.name ?? '', p.label, p.lat.toFixed(6), p.lng.toFixed(6), elev, p.note ?? ''])
  }
  return '﻿' + lines.map((r) => r.map(cell).join(',')).join('\r\n')
}

/** 極簡 CSV 解析（支援雙引號跳脫、逗號、換行）。 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQ = false
  const s = text.replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inQ) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"'
          i++
        } else inQ = false
      } else field += c
    } else if (c === '"') inQ = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\r') {
      /* 忽略，等 \n */
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

export interface CsvPoiRow {
  group: string
  label: string
  lat: number
  lng: number
  elevM: number | null
  note?: string
}

/** CSV 字串 → 點位資料列（自動略過標題列、無效座標）。 */
export function csvToPoi(text: string): CsvPoiRow[] {
  const rows = parseCsv(text)
  if (!rows.length) return []
  // 只有當「第一列的座標欄不是有效座標」且含標題關鍵字時，才當標題列——
  // 避免第一筆資料的名稱/群組剛好含 name/名稱 等字而被誤刪。
  const first = rows[0]
  const fLat = parseFloat(first[2])
  const fLng = parseFloat(first[3])
  const firstLooksData =
    Number.isFinite(fLat) && Number.isFinite(fLng) && Math.abs(fLat) <= 90 && Math.abs(fLng) <= 180
  const hasHeader = !firstLooksData && /群組|名稱|緯度|經度|lat|lng|group|name/i.test(first.join(','))
  const out: CsvPoiRow[] = []
  for (let i = hasHeader ? 1 : 0; i < rows.length; i++) {
    const r = rows[i]
    if (r.length < 4) continue
    const lat = parseFloat(r[2])
    const lng = parseFloat(r[3])
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue
    const elevRaw = r[4] != null ? parseFloat(r[4]) : NaN
    out.push({
      group: (r[0] || '匯入').trim(),
      label: (r[1] || '未命名點位').trim(),
      lat,
      lng,
      elevM: Number.isFinite(elevRaw) ? elevRaw : null,
      note: (r[5] || '').trim() || undefined,
    })
  }
  return out
}
