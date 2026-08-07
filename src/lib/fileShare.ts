// ── 檔案下載／分享（跨平台，特別是 iOS）─────────────────────────
//
// iPhone Safari / 加到主畫面的 PWA 不支援 <a download>（會忽略、或把檔案當網頁
// 打開），導致「下載 CSV/JSON」看似失效。這裡優先用 Web Share API 叫出 iOS 分享
// 表單（可存到「檔案」App、傳 LINE/AirDrop）；桌機才退回傳統 <a download>；
// 都不行再退回複製到剪貼簿。

export type SaveResult = 'shared' | 'downloaded' | 'copied' | 'failed'

/**
 * 存檔或分享一段文字內容。必須在使用者手勢（onClick）中呼叫，iOS 分享才允許。
 */
export async function saveOrShareText(filename: string, text: string, mime: string): Promise<SaveResult> {
  // ① 手機（尤其 iOS）：Web Share 帶檔案 → 叫出分享表單，可存到「檔案」App
  try {
    const file = new File([text], filename, { type: mime })
    const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean }
    if (typeof navigator.share === 'function' && nav.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: filename })
      return 'shared'
    }
  } catch {
    // 使用者取消分享，或不支援 → 往下退回下載
  }
  // ② 桌機瀏覽器：傳統 <a download>
  try {
    const url = URL.createObjectURL(new Blob([text], { type: mime }))
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
    return 'downloaded'
  } catch {
    // 往下退回剪貼簿
  }
  // ③ 最後手段：複製到剪貼簿
  try {
    await navigator.clipboard.writeText(text)
    return 'copied'
  } catch {
    return 'failed'
  }
}

/** 把存檔結果轉成給使用者看的訊息。 */
export function saveResultMsg(r: SaveResult, what: string): string {
  return r === 'shared'
    ? `${what}已開啟分享（可存到「檔案」App 或傳給隊友）`
    : r === 'downloaded'
      ? `${what}已下載`
      : r === 'copied'
        ? `${what}無法下載，已改複製到剪貼簿（貼到記事本另存）`
        : `⚠ ${what}輸出失敗`
}
