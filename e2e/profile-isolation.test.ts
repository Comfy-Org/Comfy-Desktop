import { realpath } from 'node:fs/promises'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { launchLauncherApp } from './support/electronHarness'

test('Electron keeps app state, sessions and user folders inside the test profile @macos @windows @linux', async () => {
  let expectedProfile = ''
  const handle = await launchLauncherApp({
    settings: { firstUseCompleted: true, telemetryEnabled: false },
    onSetup: async ({ appDataDir }) => {
      expectedProfile = appDataDir
    }
  })
  try {
    const actual = await handle.application.evaluate(({ app }) => ({
      userData: app.getPath('userData'),
      sessionData: app.getPath('sessionData'),
      logs: app.getPath('logs'),
      home: app.getPath('home'),
      downloads: app.getPath('downloads')
    }))
    const resolve = (dir: string) => realpath(dir).catch(() => path.resolve(dir))
    const profile = await resolve(expectedProfile)
    const home = await resolve(handle.homeDir)
    expect(await resolve(actual.userData)).toBe(profile)
    expect(await resolve(actual.sessionData)).toBe(profile)
    expect(actual.logs.replace(/^\/private/, '')).toContain(home.replace(/^\/private/, ''))
    if (process.platform !== 'win32') {
      expect(await resolve(actual.home)).toBe(home)
      expect(actual.downloads.replace(/^\/private/, '')).toContain(home.replace(/^\/private/, ''))
    }
  } finally {
    await handle.cleanup()
  }
})
