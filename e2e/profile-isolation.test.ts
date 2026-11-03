import { test, expect } from '@playwright/test'
import { launchLauncherApp } from './support/electronHarness'

test('Electron stores app state and browser sessions inside the test profile @macos @windows @linux', async () => {
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
      sessionData: app.getPath('sessionData')
    }))
    expect(actual).toEqual({ userData: expectedProfile, sessionData: expectedProfile })
  } finally {
    await handle.cleanup()
  }
})
