// 匯出／分享的測試。
//
// 重點只有一個：iOS 的分享表單**不能**同時收到檔案和文字。
// 收到 { files, title } 的時候它會只送出 title 那串字，檔案被默默丟掉——
// 使用者按了匯出、分享表單也確實跳出來了，傳到 LINE 的卻只有一行檔名。
// 這種錯在桌機測不出來（桌機走 <a download>），而本專案的使用者只有 iPhone。

import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { saveOrShareText, saveResultMsg } from './fileShare.ts'

const realNav = globalThis.navigator

function stubNav(nav: unknown) {
  Object.defineProperty(globalThis, 'navigator', {
    value: nav,
    configurable: true,
    writable: true,
  })
}

afterEach(() => stubNav(realNav))

/** 錄下 navigator.share 實際收到什麼。 */
function recorder(opts: { canShare?: boolean; shareThrows?: boolean } = {}) {
  const calls: Record<string, unknown>[] = []
  stubNav({
    canShare: () => opts.canShare !== false,
    share: async (d: Record<string, unknown>) => {
      calls.push(d)
      if (opts.shareThrows) throw new Error('使用者取消')
    },
    clipboard: { writeText: async () => {} },
  })
  return calls
}

test('分享檔案時不可以帶 title（iOS 會丟掉檔案，只送出文字）', async () => {
  const calls = recorder()
  const r = await saveOrShareText('argus-backup.json', '{"a":1}', 'application/json')
  assert.equal(r, 'shared')
  assert.equal(calls.length, 1)
  assert.ok(Array.isArray(calls[0].files), '要帶 files')
  assert.equal(
    'title' in calls[0],
    false,
    `分享檔案時帶了 title，iOS 上檔案會被丟掉：${JSON.stringify(Object.keys(calls[0]))}`,
  )
  assert.equal('text' in calls[0], false, 'text 跟 title 同樣會讓 iOS 丟掉檔案')
})

test('傳出去的檔名與內容型別要正確（分享表單靠 File 自己顯示檔名）', async () => {
  const calls = recorder()
  await saveOrShareText('報告.csv', 'a,b\n1,2\n', 'text/csv')
  const f = (calls[0].files as File[])[0]
  assert.equal(f.name, '報告.csv')
  assert.equal(f.type, 'text/csv')
  assert.equal(await f.text(), 'a,b\n1,2\n')
})

test('不支援分享檔案時要往下退，不是直接失敗', async () => {
  // canShare 回 false（桌機 Safari、舊 Android），且這個環境沒有 document
  // → <a download> 也不行 → 應該落到剪貼簿，而不是回 failed。
  recorder({ canShare: false })
  assert.equal(await saveOrShareText('x.json', '{}', 'application/json'), 'copied')
})

test('使用者取消分享不算成功，要繼續往下退', async () => {
  recorder({ shareThrows: true })
  assert.equal(await saveOrShareText('x.json', '{}', 'application/json'), 'copied')
})

test('三條路都走不通才回 failed（而且訊息要告訴使用者能做什麼）', async () => {
  stubNav({ clipboard: { writeText: async () => { throw new Error('no') } } })
  assert.equal(await saveOrShareText('x.json', '{}', 'application/json'), 'failed')
  for (const r of ['shared', 'downloaded', 'copied', 'failed'] as const) {
    assert.ok(saveResultMsg(r, '備份').length > 0, `${r} 沒有對應訊息`)
  }
  assert.match(saveResultMsg('copied', '備份'), /貼到|剪貼簿/)
})
