import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AIS_WATCHDOG_DEFAULTS as D,
  backoffMs,
  evaluateWatchdog,
  initialWatchdogState,
  isAuthFailure,
  type WatchdogState,
} from './aisWatchdog.ts'

const st = (p: Partial<WatchdogState>): WatchdogState => ({ ...initialWatchdogState(), ...p })

test('還沒連線：什麼都不講，也不可信任', () => {
  const v = evaluateWatchdog(initialWatchdogState(), 1000)
  assert.equal(v.health, 'idle')
  assert.equal(v.usable, false)
  assert.equal(v.message, '')
})

test('剛收到資料：可信任', () => {
  const v = evaluateWatchdog(st({ connectedAt: 0, lastDataAt: 1000 }), 2000)
  assert.equal(v.health, 'live')
  assert.equal(v.usable, true)
  assert.equal(v.ageMs, 1000)
  assert.equal(v.message, '', '正常時不要吵使用者')
})

// 這是整個看門狗存在的理由：socket 一直 OPEN、不關閉、不報錯，但沒有資料。
test('握手成功後開始沉默：先標示不新，再強制重連（socket 不會自己關）', () => {
  const s = st({ connectedAt: 0, lastDataAt: 1000 })

  const fresh = evaluateWatchdog(s, 1000 + D.staleMs - 1)
  assert.equal(fresh.health, 'live', '還在預算內就不要亂報')

  const stale = evaluateWatchdog(s, 1000 + D.staleMs)
  assert.equal(stale.health, 'stale')
  assert.equal(stale.usable, false, '不新的資料不可以拿去做可疑判斷')
  assert.match(stale.message, /不是最新/)

  const dead = evaluateWatchdog(s, 1000 + D.recycleAfterMs)
  assert.equal(dead.health, 'recycle', '沉默夠久要主動砍掉重連')
  assert.match(dead.message, /重新連線/)
})

test('兩個預算要分開：標示不新要比重連早很多（免費版限 1 條連線，別自己打自己）', () => {
  assert.ok(D.staleMs < D.recycleAfterMs)
  assert.ok(D.recycleAfterMs >= D.staleMs * 2, '重連門檻至少要是標示門檻的兩倍')
})

test('連上但一筆資料都沒來：給寬限，逾時後照樣判不新 / 重連', () => {
  const s = st({ connectedAt: 0, lastDataAt: null })
  assert.equal(evaluateWatchdog(s, D.staleMs - 1).health, 'connecting', '剛連上要給寬限')
  const stale = evaluateWatchdog(s, D.staleMs)
  assert.equal(stale.health, 'stale')
  assert.match(stale.message, /限 1 條連線|金鑰/, '要講出最可能的原因')
  assert.equal(evaluateWatchdog(s, D.recycleAfterMs).health, 'recycle')
})

test('金鑰被拒：終止狀態，不可信任，且要叫使用者去換金鑰', () => {
  const v = evaluateWatchdog(st({ connectedAt: 0, lastDataAt: 1000, authBlocked: true }), 2000)
  assert.equal(v.health, 'auth-blocked')
  assert.equal(v.usable, false)
  assert.match(v.message, /換一把/)
})

test('ageMs 要能拿來顯示，沒收過資料時是 null 而不是 0', () => {
  assert.equal(evaluateWatchdog(st({ connectedAt: 0 }), 5000).ageMs, null)
  assert.equal(evaluateWatchdog(st({ connectedAt: 0, lastDataAt: 1000 }), 4000).ageMs, 3000)
})

test('退避梯子遞增且有上限，不會無限變長', () => {
  const seq = [0, 1, 2, 3, 4, 10].map(backoffMs)
  for (let i = 1; i < 4; i++) assert.ok(seq[i] > seq[i - 1], '前幾階要遞增')
  assert.equal(seq[4], seq[5], '超過梯子長度要停在最後一階')
  assert.ok(seq[5] <= 300_000, '最長不超過 5 分鐘')
})

test('分得出金鑰問題與傳輸問題——重試只對後者有用', () => {
  for (const s of [
    'Invalid API key',
    'apikey not recognised',
    'Unauthorized',
    '403 Forbidden',
    'authentication failed',
  ]) {
    assert.equal(isAuthFailure(s), true, `應判為金鑰問題：${s}`)
  }
  for (const s of ['connection reset', 'timeout', 'bounding box too large', '']) {
    assert.equal(isAuthFailure(s), false, `不該判為金鑰問題：${s}`)
  }
})
