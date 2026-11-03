import { resolve } from 'node:path'
import { defineConfig } from '@playwright/test'

const outputDir = process.env.VISUAL_OUTPUT_DIR
if (!outputDir) throw new Error('Run pnpm test:visual --base <git-ref> to render both versions.')

export default defineConfig({
  testDir: './tests/visual',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  retries: 0,
  workers: 2,
  reporter: [['list'], ['html', { outputFolder: resolve(outputDir, 'playwright'), open: 'never' }]],
  outputDir: resolve(outputDir, 'test-results'),
  // Capture stable images afresh for this run; the report compares the two sets.
  snapshotPathTemplate: `${resolve(outputDir, 'screenshots')}/{testFilePath}/{arg}{ext}`,
  updateSnapshots: 'all',
  expect: {
    toHaveScreenshot: { animations: 'disabled', caret: 'hide', threshold: 0, maxDiffPixels: 0 }
  },
  use: {
    browserName: 'chromium',
    baseURL: 'http://127.0.0.1:5184',
    viewport: { width: 1200, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    locale: 'en-US',
    timezoneId: 'UTC',
    contextOptions: { reducedMotion: 'reduce' },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: 'pnpm exec vite --config tests/visual/vite.config.ts',
    url: 'http://127.0.0.1:5184',
    reuseExistingServer: false
  }
})
