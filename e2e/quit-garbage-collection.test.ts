import { expect, test } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { expectChooserVisible } from './support/chooserHelpers'
import { isPopupVisible } from './support/cdpPages'

interface AppExit {
  code: number | null
  signal: NodeJS.Signals | null
}

function appExit(ctx: AppContext): Promise<AppExit> {
  return new Promise((resolve) => {
    ctx.app.process().once('exit', (code, signal) => resolve({ code, signal }))
  })
}

async function openInstancePicker(ctx: AppContext): Promise<void> {
  await ctx.panel.evaluate<boolean>(
    `(() => {
      window.api.openInstancePicker()
      return true
    })()`
  )
  await expect
    .poll(() => isPopupVisible(ctx.app, 'comfyTitlePopup.html'), {
      timeout: 10_000,
      message: 'The instance picker should open'
    })
    .toBe(true)
}

async function quitWhileCollectingGarbage(ctx: AppContext): Promise<void> {
  await ctx.app
    .evaluate(({ app }) => {
      const mainProcess = globalThis.process
      mainProcess.getBuiltinModule('node:v8').setFlagsFromString('--expose-gc')
      const collectGarbage = mainProcess
        .getBuiltinModule('node:vm')
        .runInNewContext('gc') as () => void
      app.once('quit', () => queueMicrotask(collectGarbage))
      app.quit()
    })
    .catch(() => {})
}

test('the app exits cleanly when garbage is collected while it quits @macos @windows @linux', async () => {
  const ctx = await launchApp({ settings: { firstUseCompleted: true, telemetryEnabled: false } })
  try {
    await expectChooserVisible(ctx.panel)
    await openInstancePicker(ctx)
    const exited = appExit(ctx)

    await quitWhileCollectingGarbage(ctx)

    expect(
      await exited,
      'The app should exit with code 0, not crash while its views are garbage-collected'
    ).toEqual({ code: 0, signal: null })
  } finally {
    await ctx.cleanup()
  }
})
