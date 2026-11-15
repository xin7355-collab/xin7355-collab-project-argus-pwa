// worker/vendor/model_router.cjs（skl 的 ai-model-router，原樣複製的 CommonJS）只宣告測試與 Worker 用到的部分。
declare module '*/model_router.cjs' {
  const router: {
    ModelRouter: new (provider: string, opts?: Record<string, unknown>) => {
      chat(tier: string, messages: { role: string; content: string }[], opts?: Record<string, unknown>): Promise<string>
    }
    selftest(opts?: { strict?: boolean }): Promise<number>
  }
  export default router
}
