import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
import { cpSync, readFileSync } from 'node:fs'

// 版本號與建置時間在 build 時注入。
// 原本 StatusBar 是寫死 "v2.38" 的字串——部署幾次它都長一樣，
// 使用者根本看不出手機上拿到的是不是新版。改成讀 package.json 的真實版本
// 再加上建置時間，一眼就能確認「我現在用的是哪一版」。
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))

/**
 * 3D 地球（Cesium）執行時要另外下載的檔案：背景工作程式（Workers）、第三方解碼器（ThirdParty）、
 * 星空與圖示（Assets）。它們不能被打包進 JS，只能原樣放在網站上，由 CESIUM_BASE_URL 指過去。
 * build 完從套件複製到 dist/cesium/。（Widgets 的 CSS 已經由程式 import、跟著打包，不用複製。）
 */
function copyCesiumRuntime(): Plugin {
  return {
    name: 'copy-cesium-runtime',
    apply: 'build',
    writeBundle(options) {
      const out = options.dir ?? 'dist'
      for (const d of ['Workers', 'ThirdParty', 'Assets']) {
        cpSync(`node_modules/cesium/Build/Cesium/${d}`, `${out}/cesium/${d}`, { recursive: true })
      }
      // Cesium 是 Apache-2.0：我們在網站上轉發它的檔案，授權書要跟著放（第三方元件清單一起）
      cpSync('node_modules/cesium/LICENSE.md', `${out}/cesium/LICENSE.md`)
      cpSync('node_modules/cesium/ThirdParty.json', `${out}/cesium/ThirdParty.json`)
    },
  }
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    copyCesiumRuntime(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: '阿爾戈斯 · 海域態勢面板',
        short_name: '阿爾戈斯',
        description: '阿爾戈斯 Argus — 海域觀測與搜救 PWA',
        lang: 'zh-Hant',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'any',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // 3D 地球（Cesium，第一次開實測下載壓縮後約 2.2 MB）不放進離線快取：手機裝 App 時不該被迫下載一個多半用不到的大檔。
        // 要開 3D 地球本來就要連網（衛星圖磚、飛機資料）。cesiumEngine 是 GlobeView 延遲載入的那一包。
        globIgnores: ['cesium/**', 'assets/cesiumEngine-*'],
        // 更新時清掉舊版快取，避免半新半舊導致白畫面 / 壞掉。
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/server\.arcgisonline\.com\/ArcGIS\/rest\/services\/Canvas\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'dark-base-tiles',
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 7 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // 新的底圖（地圖／衛星／海圖）。海上常常沒訊號，看過的地方要留得住。
          //
          // 只快取 200，不收 0（opaque）：這幾層用 crossOrigin 載入（要讀像素判斷假圖磚），
          // 萬一快取裡混進 opaque 回應，同一個網址的 <img crossorigin> 會直接載入失敗，
          // 那張圖磚就永遠是破的、直到快取過期。
          {
            urlPattern:
              /^https:\/\/server\.arcgisonline\.com\/ArcGIS\/rest\/services\/(World_Street_Map|World_Imagery|Reference|Ocean)\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'esri-tiles-v1',
              expiration: { maxEntries: 3000, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: /^https:\/\/wmts\.nlsc\.gov\.tw\/wmts\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'nlsc-tiles-v1',
              expiration: { maxEntries: 3000, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  worker: {
    format: 'es',
  },
})
