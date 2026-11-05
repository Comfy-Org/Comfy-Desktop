import { defineConfig } from '@playwright/test'
import { isBackgroundRun } from './e2e/support/focusMode'

const backgroundRun = isBackgroundRun()

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [
    { name: 'macos', grep: /@macos/ },
    { name: 'windows', grep: /@windows/, ...(backgroundRun ? { grepInvert: /@needs-focus/ } : {}) },
    ...(backgroundRun
      ? [{ name: 'windows-focus', grep: /^(?=.*@windows)(?=.*@needs-focus)/ }]
      : []),
    { name: 'linux', grep: /@linux/ },
    { name: 'lifecycle', grep: /@lifecycle/, timeout: 180_000 }
  ]
})
