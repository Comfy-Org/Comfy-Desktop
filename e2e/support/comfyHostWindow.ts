import type { ElectronApplication } from '@playwright/test'
import { expect } from '@playwright/test'
import { evalWithRetry } from './evalRetry'

function openWindowCount(app: ElectronApplication): Promise<number> {
  return evalWithRetry(() =>
    app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).length
    )
  )
}

function closeEveryWindowButTheComfyHost(app: ElectronApplication): Promise<boolean> {
  return evalWithRetry(() =>
    app.evaluate(({ BrowserWindow, WebContentsView }) => {
      const wins = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())
      const host = wins.find((w) =>
        w.contentView.children.some(
          (v) =>
            v instanceof WebContentsView &&
            /^http:\/\/(127\.0\.0\.1|localhost):/.test(v.webContents.getURL())
        )
      )
      if (!host) return false
      for (const win of wins) {
        if (win.id !== host.id) win.close()
      }
      return true
    })
  )
}

export async function keepOnlyComfyHostWindow(app: ElectronApplication): Promise<void> {
  await expect
    .poll(() => closeEveryWindowButTheComfyHost(app), {
      timeout: 30_000,
      intervals: [200, 500],
      message: 'the running build never showed ComfyUI in a window'
    })
    .toBe(true)
  await expect.poll(() => openWindowCount(app), { timeout: 15_000, intervals: [200, 500] }).toBe(1)
}
