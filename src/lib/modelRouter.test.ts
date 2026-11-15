import { test } from 'node:test'
import assert from 'node:assert/strict'
import router from '../../worker/vendor/model_router.cjs'

// 語音助理用的 AI 模型路由是從 skl 原樣複製的（worker/vendor/）。
// 它自己的自我測試（含跟 Python 版共用的 router_cases.json）要跟著 npm test 一起跑：
// 換新版時少複製一個檔、或規則壞掉，這裡就會紅燈。--strict：找不到共用案例也算失敗。
test('ai-model-router 自我測試（strict）全部通過', async () => {
  const code = await router.selftest({ strict: true })
  assert.equal(code, 0)
})
