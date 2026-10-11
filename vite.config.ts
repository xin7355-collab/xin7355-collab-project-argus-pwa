import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
import { readFileSync } from 'node:fs'

// 版本號與建置時間在 build 時注入。
// 原本 StatusBar 是寫死 "v2.38" 的字串——部署幾次它都長一樣，
// 使用者根本看不出手機上拿到的是不是新版。改成讀 package.json 的真實版本
// 再加上建置時間，一眼就能確認「我現在用的是哪一版」。
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
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
        ],
      },
    }),
  ],
  worker: {
    format: 'es',
  },
})
