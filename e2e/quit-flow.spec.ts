import { test } from '@playwright/test'
import { launchLauncherApp, waitForAppExit } from './support/electronHarness'

test.describe('Launcher Quit Flow', () => {
  test.skip(process.platform !== 'darwin', 'Regression is specific to macOS quit lifecycle')

  test('app.quit exits cleanly with the launcher window open @macos', async () => {
    const { application, cleanup } = await launchLauncherApp()
    try {
      await application.firstWindow()

      const exitPromise = waitForAppExit(application)
      await application.evaluate(({ app }: { app: { quit: () => void } }) => {
        app.quit()
      })

      await exitPromise
    } finally {
      await cleanup()
    }
  })
})
