// vite.config.ts 在 build 時注入的全域常數（見該檔的 define 設定）。
declare const __APP_VERSION__: string
/** ISO 8601 建置時間。用來讓使用者辨認手機上拿到的是哪一次建置。 */
declare const __BUILD_TIME__: string
