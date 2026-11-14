import { defineConfig } from '@playwright/test'
import { isBackgroundRun } from './e2e/support/focusMode'

const backgroundRun = isBackgroundRun()

function platformProjects(name: string, tag: string) {
  if (!backgroundRun) return [{ name, grep: new RegExp(tag) }]
  return [
    { name, grep: new RegExp(tag), grepInvert: /@needs-focus/ },
    { name: `${name}-focus`, grep: new RegExp(`^(?=.*${tag})(?=.*@needs-focus)`) }
  ]
}

export default defineConfig({
  testDir: './e2e',
  testIgnore: '**/e2e/support/**',
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: !!process.env.CI,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [
    ...platformProjects('macos', '@macos'),
    ...platformProjects('windows', '@windows'),
    { name: 'linux', grep: /@linux/ },
    { name: 'lifecycle', grep: /@lifecycle/, timeout: 180_000 }
  ]
})
