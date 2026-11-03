import { realpath } from 'node:fs/promises'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { launchLauncherApp } from './support/electronHarness'

async function canonicalPath(target: string): Promise<string> {
  try {
    return await realpath(target)
  } catch {
    const parent = path.dirname(target)
    if (parent === target) return target
    return path.join(await canonicalPath(parent), path.basename(target))
  }
}

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
      logs: app.getPath('logs')
    }))
    const profile = await canonicalPath(expectedProfile)
    const home = await canonicalPath(handle.homeDir)
    expect(await canonicalPath(actual.userData)).toBe(profile)
    expect(await canonicalPath(actual.sessionData)).toBe(profile)
    expect(await canonicalPath(actual.logs)).toContain(home)
    // Windows cannot resolve its Downloads folder inside a redirected profile.
    if (process.platform !== 'win32') {
      const user = await handle.application.evaluate(({ app }) => ({
        home: app.getPath('home'),
        downloads: app.getPath('downloads')
      }))
      expect(await canonicalPath(user.home)).toBe(home)
      expect(await canonicalPath(user.downloads)).toContain(home)
    }
  } finally {
    await handle.cleanup()
  }
})
