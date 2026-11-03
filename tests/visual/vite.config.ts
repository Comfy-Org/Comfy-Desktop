import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: import.meta.dirname,
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@renderer': resolve(import.meta.dirname, '../../src/renderer/src'),
      '@locales': resolve(import.meta.dirname, '../../locales')
    }
  },
  server: {
    host: '127.0.0.1',
    port: 5184,
    strictPort: true,
    fs: { allow: [resolve(import.meta.dirname, '../..')] }
  }
})
