import { resolve } from 'node:path'
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    storybookTest({
      configDir: resolve(import.meta.dirname, '.storybook'),
      storybookScript: 'pnpm storybook --ci'
    })
  ],
  test: {
    name: 'storybook',
    fileParallelism: false,
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: 'chromium' }]
    }
  }
})
