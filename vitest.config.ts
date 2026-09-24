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
    // Run `afterEach` hooks in registration order rather than vitest's default
    // reverse ('stack'). The suite-wide unmount in `vitest.setup.ts` registers
    // first, so under 'stack' it would run LAST - after each file's own
    // teardown had deleted `window.api`, restored mocks or reset the DOM,
    // leaving unmount hooks to run against a dismantled environment.
    sequence: { hooks: 'list' },
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.integration.test.ts', 'node_modules'],
    globals: true,
    maxWorkers: 8,
    // Installs the shared vue-i18n plugin into @vue/test-utils'
    // global mount config so components that call `useI18n()` work
    // out of the box in every test file.
    setupFiles: ['./vitest.setup.ts']
  }
})
