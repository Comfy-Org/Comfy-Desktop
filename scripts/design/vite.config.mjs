import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

const repo = resolve(fileURLToPath(import.meta.url), '../../..')

// The design prototype in a plain browser tab (mock data, no Electron):
// the renderer's aliases and plugins, serving src/renderer/design-landing.html.
export default defineConfig({
  root: resolve(repo, 'src/renderer'),
  resolve: {
    alias: {
      '@renderer': resolve(repo, 'src/renderer/src'),
      '@locales': resolve(repo, 'locales')
    }
  },
  plugins: [vue(), tailwindcss()],
  server: { port: 5199, open: '/design-landing.html' }
})
