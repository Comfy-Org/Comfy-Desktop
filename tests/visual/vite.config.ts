import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// The PR's fixture is copied into the base worktree, so its relative imports,
// Tailwind sources, fonts and runtime dependencies all belong to that version.
const sourceRoot = realpathSync(
  process.env.VISUAL_SOURCE_ROOT ?? resolve(import.meta.dirname, '../..')
)

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
    fs: { allow: [sourceRoot, resolve(import.meta.dirname, '../..')] }
  }
})
