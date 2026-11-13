import type { ElectronApplication } from '@playwright/test'
import { expect } from '@playwright/test'
import { evalWithRetry } from './evalRetry'

const HOST_PAGES = [
  { name: 'title bar', page: 'comfyTitleBar.html', rootSelector: '.title-bar', required: true },
  { name: 'panel', page: 'panel.html', rootSelector: '.panel-shell', required: false }
]

function openWindowCount(app: ElectronApplication): Promise<number> {
  return evalWithRetry(() =>
    app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).length
    )
  )
}

function comfyHostBlockers(app: ElectronApplication): Promise<string[]> {
  return evalWithRetry(() =>
    app.evaluate(async ({ BrowserWindow, WebContentsView, webContents }, hostPages) => {
      const liveContentsOf = (win: Electron.BrowserWindow): Electron.WebContents[] =>
        win.contentView.children
          .map((view) => (view instanceof WebContentsView ? view.webContents : null))
          .filter((wc): wc is Electron.WebContents => !!wc && !wc.isDestroyed())
      const host = BrowserWindow.getAllWindows()
        .filter((w) => !w.isDestroyed())
        .find((w) =>
          liveContentsOf(w).some((wc) => /^http:\/\/(127\.0\.0\.1|localhost):/.test(wc.getURL()))
        )
      if (!host) return ['running comfy host window not found']

      const hostContents = liveContentsOf(host)
      const hostContentsIds = new Set(hostContents.map((wc) => wc.id))
      const blockers: string[] = []

      const awaitingFirstPage = hostContents.filter(
        (wc) => wc.getURL() === '' && wc.isLoading()
      ).length
      if (awaitingFirstPage > 0) {
        blockers.push(`${awaitingFirstPage} host view(s) still loading their first page`)
      }

      for (const { name, page, rootSelector, required } of hostPages) {
        const contents = hostContents.find((wc) => wc.getURL().includes(page))
        if (!contents) {
          if (required) blockers.push(`${name} has not loaded ${page}`)
        } else if (contents.isLoadingMainFrame()) {
          blockers.push(`${name} is still loading`)
        } else {
          const rendered = await contents
            .executeJavaScript(`!!document.querySelector(${JSON.stringify(rootSelector)})`)
            .catch(() => false)
          if (rendered !== true) blockers.push(`${name} has not rendered ${rootSelector}`)
        }

        const leftovers = webContents
          .getAllWebContents()
          .filter(
            (wc) => !wc.isDestroyed() && !hostContentsIds.has(wc.id) && wc.getURL().includes(page)
          ).length
        if (leftovers > 0) blockers.push(`${leftovers} ${name}(s) of a closed window still alive`)
      }

      return blockers
    }, HOST_PAGES)
  )
}

export async function keepOnlyComfyHostWindow(app: ElectronApplication): Promise<void> {
  await evalWithRetry(() =>
    app.evaluate(({ BrowserWindow, WebContentsView }) => {
      const wins = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())
      const host = wins.find((w) =>
        w.contentView.children.some(
          (v) =>
            v instanceof WebContentsView &&
            /^http:\/\/(127\.0\.0\.1|localhost):/.test(v.webContents.getURL())
        )
      )
      if (!host) throw new Error('running comfy host window not found')
      for (const win of wins) {
        if (win.id !== host.id) win.close()
      }
    })
  )
  await expect.poll(() => openWindowCount(app), { timeout: 15_000, intervals: [200, 500] }).toBe(1)
  await expect
    .poll(() => comfyHostBlockers(app), {
      timeout: 30_000,
      intervals: [100, 250, 500],
      message: 'the remaining ComfyUI window never became drivable'
    })
    .toEqual([])
}
