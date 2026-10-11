// Node 內建測試執行器（node:test / node:assert）的最小型別宣告。
//
// 為什麼不直接裝 @types/node：tsconfig.json 的 `types` 刻意只列
// ["vite/client", "vite-plugin-pwa/client"]，把 Node 的「全域」型別擋在外面。
// 一旦把 "node" 加進去，全域 setTimeout 的回傳型別會從 DOM 的 number 變成
// NodeJS.Timeout，專案裡好幾個 useRef<number>() 計時器就會全部型別不符。
//
// 測試只用到這兩個模組的幾個函式，所以在這裡自己宣告需要的部分，
// 既能通過 tsc -b，也完全不新增任何相依套件。

declare module 'node:test' {
  /** 註冊一個測試；回傳 Promise 時會被等待。 */
  export function test(name: string, fn: () => void | Promise<void>): void
  export default test
}

declare module 'node:assert/strict' {
  interface AssertStrict {
    /** 值為假就拋錯。宣告成 asserts 才能在測試裡收窄型別。 */
    (value: unknown, message?: string): asserts value
    ok(value: unknown, message?: string): asserts value
    equal<T>(actual: unknown, expected: T, message?: string): asserts actual is T
    notEqual(actual: unknown, expected: unknown, message?: string): void
    deepEqual<T>(actual: unknown, expected: T, message?: string): asserts actual is T
    throws(fn: () => unknown, message?: string): void
    fail(message?: string): never
  }
  const assert: AssertStrict
  export default assert
}
