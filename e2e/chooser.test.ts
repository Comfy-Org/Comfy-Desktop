import { test, expect, type ElectronApplication } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import {
  clickNewInstallTile,
  openTitleMenu,
  expectChooserVisible,
  expectTakeoverOpen
} from './support/chooserHelpers'
import {
  findWebContentsId,
  isPopupVisible,
  TITLE_REOPEN_SUPPRESSION_MS,
  waitForWebContents
} from './support/cdpPages'
import { evalWithRetry } from './support/evalRetry'

let ctx: AppContext

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  ctx = await launchApp({ settings: { firstUseCompleted: true, telemetryEnabled: false } })
})

test.afterAll(async () => {
  await ctx.cleanup()
})

test('chooser body renders on cold start @windows @macos @linux', async () => {
  await expectChooserVisible(ctx.panel)
  expect(await ctx.panel.exists('.chooser-tile-new')).toBe(true)
  expect(await ctx.panel.exists('[data-testid="app-sidebar"]')).toBe(true)
  expect(await ctx.panel.exists('[data-testid="devplatform-account-signin"]')).toBe(true)
})

test('title bar shows install-less pill on chooser host @windows @macos @linux', async () => {
  expect(await ctx.titleBar.exists('.title-install-pill.is-install-less')).toBe(true)
  expect(await ctx.titleBar.textOf('.title-install-name')).toMatch(/Comfy Desktop/i)
})

test('clicking New Install tile opens the new-install takeover @windows @macos @linux', async () => {
  await clickNewInstallTile(ctx.panel)
  await expectTakeoverOpen(ctx.panel)
  expect(await ctx.panel.exists('[data-testid="workspace-install-source-managed"]')).toBe(true)
  expect(await ctx.panel.click('.config-back-to-dashboard')).toBe(true)
  await expect.poll(() => ctx.panel.exists('.brand-takeover-root')).toBe(false)
  await expectChooserVisible(ctx.panel)
})

test('Builds dropdown opens both import flows and restores focus on Escape @windows @macos @linux', async () => {
  const trigger = '[data-testid="build-actions-menu-trigger"]'
  expect(await ctx.panel.click(trigger)).toBe(true)
  await ctx.panel.waitForVisible('[data-testid="build-actions-add-existing"]')
  await ctx.panel.pressKey('Escape')
  await expect
    .poll(() =>
      ctx.panel.evaluate<boolean>(`document.activeElement?.matches('${trigger}') ?? false`)
    )
    .toBe(true)

  for (const [action, modal] of [
    ['add-existing', 'track-modal'],
    ['load-snapshot', 'load-snapshot-modal']
  ]) {
    expect(await ctx.panel.click(trigger)).toBe(true)
    const item = `[data-testid="build-actions-${action}"]`
    await ctx.panel.waitForVisible(item)
    expect(await ctx.panel.click(item)).toBe(true)
    await ctx.panel.waitForVisible(`[data-testid="${modal}"]`)
    expect(await ctx.panel.click('.takeover-back')).toBe(true)
    await expect.poll(() => ctx.panel.exists(`[data-testid="${modal}"]`)).toBe(false)
    await expectChooserVisible(ctx.panel)
  }
})

test('activate hook focuses the existing chooser host instead of spawning a duplicate @windows @macos @linux', async () => {
  const before = await evalWithRetry(() =>
    ctx.app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).length
    )
  )
  expect(before).toBe(1)

  await ctx.app.evaluate(({ app }) => {
    app.emit('activate')
  })
  await new Promise((r) => setTimeout(r, 200))

  const after = await evalWithRetry(() =>
    ctx.app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).length
    )
  )
  expect(after).toBe(1)
})

test('title popup + system modal webContents are pre-warmed on the chooser host @windows @macos @linux', async () => {
  await waitForWebContents(ctx.app, 'comfyTitlePopup.html', 10_000)
  await waitForWebContents(ctx.app, 'comfySystemModal.html', 10_000)
})

test('title popup opens, renders menu items, and closes via bridge @windows @macos @linux', async () => {
  await openTitleMenu(ctx.titleBar)

  await expect
    .poll(() => isPopupVisible(ctx.app, 'comfyTitlePopup.html'), {
      timeout: 5_000,
      intervals: [100, 200]
    })
    .toBe(true)

  const popupItems = await readPopupMenuItems(ctx.app, 'comfyTitlePopup.html')
  expect(popupItems).toEqual([
    'Open Dashboard',
    'Performance Tests',
    'Benchmarks',
    'Desktop Settings',
    'Close Window',
    'Quit Desktop'
  ])

  await evalWithRetry(() =>
    ctx.app.evaluate(({ webContents }) => {
      const wc = webContents
        .getAllWebContents()
        .find((w) => w.getURL().includes('comfyTitlePopup.html'))
      if (!wc) return
      return wc.executeJavaScript(`(window).__comfyTitlePopup.close()`)
    })
  )
  await expect
    .poll(() => isPopupVisible(ctx.app, 'comfyTitlePopup.html'), {
      timeout: 5_000,
      intervals: [100, 200]
    })
    .toBe(false)
})

test('title popup reopens after a blur dismiss (menu-closed IPC clears the reopen guard) @windows @macos @linux', async () => {
  await new Promise((resolve) => setTimeout(resolve, TITLE_REOPEN_SUPPRESSION_MS))

  await openTitleMenu(ctx.titleBar)
  await expect
    .poll(() => isPopupVisible(ctx.app, 'comfyTitlePopup.html'), {
      timeout: 5_000,
      intervals: [100, 200]
    })
    .toBe(true)

  await ctx.app.evaluate(({ webContents }) => {
    const wc = webContents
      .getAllWebContents()
      .find((w) => w.getURL().includes('comfyTitlePopup.html'))
    if (!wc) throw new Error('title popup webContents missing')
    ;(wc as unknown as { emit: (event: string) => void }).emit('blur')
  })
  await expect
    .poll(() => isPopupVisible(ctx.app, 'comfyTitlePopup.html'), {
      timeout: 5_000,
      intervals: [100, 200]
    })
    .toBe(false)

  await new Promise((resolve) => setTimeout(resolve, TITLE_REOPEN_SUPPRESSION_MS))

  await openTitleMenu(ctx.titleBar)
  await expect
    .poll(() => isPopupVisible(ctx.app, 'comfyTitlePopup.html'), {
      timeout: 5_000,
      intervals: [100, 200]
    })
    .toBe(true)
})

test('title-bar tooltip popup is created on demand and hides cleanly @windows @macos @linux', async () => {
  expect(await findWebContentsId(ctx.app, 'comfyTitleTooltip.html')).toBeNull()

  await evalWithRetry(() =>
    ctx.app.evaluate(({ webContents }) => {
      const wc = webContents
        .getAllWebContents()
        .find((w) => w.getURL().includes('comfyTitleBar.html'))
      if (!wc) throw new Error('title-bar webContents missing')
      return wc.executeJavaScript(
        `(window).__comfyTitleBar.showTooltip({ text: 'e2e tooltip', leftX: 50, rightX: 200, bottomY: 30 })`
      )
    })
  )

  await waitForWebContents(ctx.app, 'comfyTitleTooltip.html', 5_000)
  await expect
    .poll(() => isPopupVisible(ctx.app, 'comfyTitleTooltip.html'), {
      timeout: 5_000,
      intervals: [100, 200]
    })
    .toBe(true)

  await evalWithRetry(() =>
    ctx.app.evaluate(({ webContents }) => {
      const wc = webContents
        .getAllWebContents()
        .find((w) => w.getURL().includes('comfyTitleBar.html'))
      if (!wc) throw new Error('title-bar webContents missing')
      return wc.executeJavaScript(`(window).__comfyTitleBar.hideTooltip()`)
    })
  )

  await expect
    .poll(() => isPopupVisible(ctx.app, 'comfyTitleTooltip.html'), {
      timeout: 5_000,
      intervals: [100, 200]
    })
    .toBe(false)
})

async function readPopupMenuItems(app: ElectronApplication, marker: string): Promise<string[]> {
  return evalWithRetry(() =>
    app.evaluate(({ webContents }, m) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL().includes(m))
      if (!wc) throw new Error(`${m} webContents missing`)
      return wc.executeJavaScript(`(() => {
      const candidates = [
        'button.menu-item',
        '[role="menuitem"]',
        '.title-popup-menu-item',
        'li button',
        'button',
      ]
      for (const sel of candidates) {
        const els = Array.from(document.querySelectorAll(sel))
        if (els.length > 0) return els.map(el => (el.textContent || '').trim()).filter(Boolean)
      }
      return []
    })()`) as Promise<string[]>
    }, marker)
  )
}
