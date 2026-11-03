import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// The PR's fixture is copied into the base worktree and served from there, so its
// relative imports, Tailwind sources, fonts, dependencies and build tools all belong
// to that version.
const sourceRoot = realpathSync(resolve(import.meta.dirname, '../..'))

export default defineConfig({
  root: resolve(sourceRoot, 'tests/visual'),
  cacheDir: process.env.VISUAL_CACHE_DIR,
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@renderer': resolve(sourceRoot, 'src/renderer/src'),
      '@locales': resolve(sourceRoot, 'locales')
    }
  },
  server: {
    host: '127.0.0.1',
    port: 5184,
    strictPort: true,
    fs: { allow: [sourceRoot] }
  }
})
