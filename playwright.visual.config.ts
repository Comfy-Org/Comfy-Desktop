import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/visual',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  retries: 0,
  workers: 2,
  reporter: [['list'], ['html', { outputFolder: 'visual-playwright-report', open: 'never' }]],
  outputDir: 'visual-test-results',
  snapshotPathTemplate: '{testDir}/__screenshots__/{platform}/{testFilePath}/{arg}{ext}',
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
