// 給 Worker 打包用的空模組。
// model_router.cjs（從 skl 原樣複製，不改它，之後才能直接換新版）裡只有 selftest 用到 require("fs")／require("path")，
// 而 selftest 只在 Node 跑（npm test），Worker 裡永遠不會呼叫。Worker 沒有檔案系統，打包器找不到這兩個模組會整個失敗，
// 所以在 wrangler.jsonc 的 alias 把它們指到這個空檔。
export default {}
