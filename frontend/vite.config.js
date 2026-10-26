import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Money Tracker',
        short_name: 'Money',
        description: 'Personal money tracker — minimal, monochrome, premium.',
        start_url: '/',
        display: 'standalone',
        background_color: '#FAFAFA',
        theme_color: '#0A0A0A',
        orientation: 'portrait-primary',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // API responses are your financial data and are behind a login: never
        // cache them on the device, and never answer an /api navigation (such as
        // the backup download) with the app shell.
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'emoji-mart': ['@emoji-mart/data', '@emoji-mart/react'],
          'recharts': ['recharts'],
          'vendor': ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'],
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/webhook': 'http://localhost:3000',
    },
  },
})
