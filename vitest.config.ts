import { resolve } from 'path'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@locales': resolve(__dirname, 'locales')
    }
  },
  test: {
    environment: 'happy-dom',
    sequence: { hooks: 'list' },
    include: ['src/**/*.test.ts', 'scripts/eslint/**/*.test.ts'],
    exclude: ['src/**/*.integration.test.ts', 'node_modules'],
    globals: true,
    maxWorkers: 8,
    // global mount config so components that call `useI18n()` work
    setupFiles: ['./vitest.setup.ts']
  }
})
