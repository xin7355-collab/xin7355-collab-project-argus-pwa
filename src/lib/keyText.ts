// ── 貼上的金鑰清乾淨 ─────────────────────────────────────────
//
// 手機複製貼上很容易多帶東西進來：零寬字元、不換行空白、頭尾引號、中間換行。
// 肉眼看不出來，送給 aisstream 就是一把「無效金鑰」，它只會一秒切斷、不說原因。
// 金鑰本身不會有空白或引號，所以全部拿掉不會誤傷。

const INVISIBLE = /[\s ​-‍⁠﻿]/g
const QUOTES = /^["'「『“‘`]+|["'」』”’`]+$/g

export function cleanKey(raw: string | undefined | null): string {
  return (raw ?? '').replace(INVISIBLE, '').replace(QUOTES, '')
}

/**
 * 給使用者對照用的金鑰摘要（只在自己的畫面上顯示，不進 log）：
 * 長度＋頭尾各 4 碼，夠核對是不是貼錯，又不會整把露出來。
 */
export function keyHint(key: string): { text: string; odd: boolean } {
  const k = cleanKey(key)
  if (!k) return { text: '沒有填', odd: true }
  // aisstream 金鑰只有英數與連字號；出現別的字元多半是貼錯東西
  const odd = !/^[A-Za-z0-9_-]+$/.test(k)
  const ends = k.length > 10 ? `開頭 ${k.slice(0, 4)}…結尾 ${k.slice(-4)}` : '太短'
  return { text: `長度 ${k.length}（${ends}）`, odd }
}
