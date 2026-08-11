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
    // Components that render an iframe (FeedbackModal's typeform) would
    // otherwise have happy-dom fetch the real URL. The request outlives the
    // test, so teardown aborts it and the rejection surfaces as an unhandled
    // error in an unrelated file. Tests assert on the `src` attribute, never
    // on loaded frame content.
    environmentOptions: {
      happyDOM: { settings: { disableIframePageLoading: true } }
    },
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.integration.test.ts', 'node_modules'],
    globals: true,
    // Installs the shared vue-i18n plugin into @vue/test-utils'
    // global mount config so components that call `useI18n()` work
    // out of the box in every test file.
    setupFiles: ['./vitest.setup.ts']
  }
})
