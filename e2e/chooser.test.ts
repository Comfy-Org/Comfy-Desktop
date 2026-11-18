import { test, expect, type ElectronApplication } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import {
  clickNewInstallTile,
  openTitleMenu,
  expectChooserVisible,
  expectNewBuildModalOpen,
  openNewBuildChangeSetup,
  pickFromTitleMenu,
  pickFromSetupDropdown,
  setupDropdownOffers,
  setupDropdownValue,
  SOURCE_DROPDOWN,
  WHERE_IT_IS_DROPDOWN,
  openDesktopSettings,
  showBuildsPage
} from './support/chooserHelpers'
import {
  closeTitlePopupIfOpen,
  findWebContentsId,
  isPopupVisible,
  TITLE_REOPEN_SUPPRESSION_MS,
  waitForWebContents
} from './support/cdpPages'
import { evalWithRetry } from './support/evalRetry'
import { captureHostWindow } from './support/windowCapture'

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

test('title bar leaves the middle empty on the chooser host @windows @macos @linux', async () => {
  expect(await ctx.titleBar.exists('.title-center')).toBe(true)
  expect(await ctx.titleBar.exists('.title-center > *')).toBe(false)
  expect(await ctx.titleBar.exists('.title-install-pill')).toBe(false)
})

test('Desktop Settings opens from the sidebar footer when expanded and collapsed @windows @macos @linux', async () => {
  const settings = '[data-testid="app-sidebar-settings"]'
  const sidebar = '[data-testid="app-sidebar"]'

  for (const collapsed of [false, true]) {
    expect(await ctx.panel.textOf(settings)).toBe(collapsed ? '' : 'Desktop Settings')
    expect(
      await ctx.panel.evaluate<boolean>(`(() => {
        const sidebar = document.querySelector('${sidebar}').getBoundingClientRect()
        const settings = document.querySelector('${settings}').getBoundingClientRect()
        const account = document.querySelector('.sidebar-account').getBoundingClientRect()
        return settings.top >= sidebar.top && settings.bottom <= account.top && account.bottom <= sidebar.bottom
      })()`)
    ).toBe(true)
    const name = collapsed ? 'sidebar-collapsed.png' : 'sidebar-expanded.png'
    const shot = await captureHostWindow(ctx.app, ctx.panel, test.info().outputPath(name))
    await test.info().attach(name, { path: shot, contentType: 'image/png' })

    await openDesktopSettings(ctx.app, ctx.panel)
    expect(await ctx.panel.isVisible('.chooser-view')).toBe(true)
    await closeTitlePopupIfOpen(ctx.app)
    expect(await ctx.panel.click('[data-testid="app-sidebar-toggle"]')).toBe(true)
    await ctx.panel.waitFor(
      () =>
        ctx.panel.evaluate<boolean>(
          `document.querySelector('${sidebar}').dataset.collapsed === '${!collapsed}'`
        ),
      { message: 'the sidebar did not toggle' }
    )
  }
})

test('clicking New Install tile opens the new-install takeover @windows @macos @linux', async () => {
  await clickNewInstallTile(ctx.panel)
  await expectNewBuildModalOpen(ctx.panel)
  const pickedSource = (): Promise<string> => setupDropdownValue(ctx.panel, SOURCE_DROPDOWN)
  await openNewBuildChangeSetup(ctx.panel)
  expect(
    await setupDropdownOffers(
      ctx.panel,
      SOURCE_DROPDOWN,
      '[data-testid="workspace-install-source-managed"]'
    ),
    "the Source dropdown offers Your team's builds"
  ).toBe(true)
  expect(await ctx.panel.exists('.setup-modal-close')).toBe(false)
  const sourceBeforeDiscard = await pickedSource()
  expect(await ctx.panel.click('[data-testid="config-discard-changes"]')).toBe(true)
  await ctx.panel.waitForVisible('.setup-modal-close')
  await openNewBuildChangeSetup(ctx.panel)
  expect(await pickedSource(), 'Discard keeps the source Desktop picked').toBe(sourceBeforeDiscard)
  expect(await ctx.panel.click('[data-testid="config-discard-changes"]')).toBe(true)
  await ctx.panel.waitForVisible('.setup-modal-close')
  expect(await ctx.panel.click('.setup-modal-close')).toBe(true)
  await expect.poll(() => ctx.panel.exists('[data-testid="new-build-modal"]')).toBe(false)
  await expectChooserVisible(ctx.panel)
})

test('Change setup asks first for a new install or a ComfyUI already there, and shows each choice in the sheet @windows @macos @linux', async () => {
  await clickNewInstallTile(ctx.panel)
  await expectNewBuildModalOpen(ctx.panel)
  await openNewBuildChangeSetup(ctx.panel)
  await ctx.panel.waitForVisible(SOURCE_DROPDOWN)
  expect(
    await setupDropdownOffers(ctx.panel, SOURCE_DROPDOWN, '[data-testid="install-source-remote"]'),
    'a server is not offered as a place to get a new install from'
  ).toBe(false)

  expect(await ctx.panel.click('[data-testid="config-start-from-existing"]')).toBe(true)
  await ctx.panel.waitForVisible('[data-testid="existing-comfy-folder-form"]')
  expect(await ctx.panel.exists(SOURCE_DROPDOWN)).toBe(false)
  expect(await ctx.panel.exists('[data-testid="config-save-changes"]')).toBe(false)
  expect(await ctx.panel.textOf('[data-testid="config-use-existing"]')).toBe('Add build')

  expect(
    await pickFromSetupDropdown(
      ctx.panel,
      WHERE_IT_IS_DROPDOWN,
      '[data-testid="existing-comfy-snapshot"]'
    )
  ).toBe(true)
  await ctx.panel.waitForVisible('[data-testid="existing-comfy-snapshot-form"]')
  expect(await ctx.panel.exists('[data-testid="existing-comfy-folder-form"]')).toBe(false)
  expect(await ctx.panel.textOf('[data-testid="config-use-existing"]')).toBe('Create build')
  expect(
    await ctx.panel.exists('[data-testid="load-snapshot-modal"]'),
    'the snapshot is asked for in the sheet, not in a second window'
  ).toBe(false)

  expect(
    await pickFromSetupDropdown(
      ctx.panel,
      WHERE_IT_IS_DROPDOWN,
      '[data-testid="install-source-remote"]'
    )
  ).toBe(true)
  await ctx.panel.waitForVisible('#sf-url')
  expect(await ctx.panel.textOf('[data-testid="config-use-existing"]')).toBe('Connect')

  expect(await ctx.panel.click('[data-testid="config-start-from-new"]')).toBe(true)
  await ctx.panel.waitForVisible(SOURCE_DROPDOWN)
  await ctx.panel.waitForVisible('[data-testid="config-save-changes"]')
  expect(await ctx.panel.exists('#sf-url')).toBe(false)

  expect(await ctx.panel.click('[data-testid="config-discard-changes"]')).toBe(true)
  await ctx.panel.waitForVisible('.setup-modal-close')
  expect(await ctx.panel.click('.setup-modal-close')).toBe(true)
  await expect.poll(() => ctx.panel.exists('[data-testid="new-build-modal"]')).toBe(false)
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
    expect(await ctx.panel.click('.setup-modal-close')).toBe(true)
    await expect.poll(() => ctx.panel.exists(`[data-testid="${modal}"]`)).toBe(false)
    await expectChooserVisible(ctx.panel)
  }
})

test('activate hook focuses the existing chooser host instead of spawning a duplicate @windows @macos @linux', async () => {
  expect(await openWindowCount()).toBe(1)

  await evalWithRetry(() =>
    ctx.app.evaluate(({ app }) => {
      app.emit('activate')
    })
  )
  await new Promise((r) => setTimeout(r, 200))

  expect(await openWindowCount()).toBe(1)
})

test('title popup + system modal webContents are pre-warmed on the chooser host @windows @macos @linux', async () => {
  await waitForWebContents(ctx.app, 'comfyTitlePopup.html', 10_000)
  await waitForWebContents(ctx.app, 'comfySystemModal.html', 10_000)
})

test('the Desktop window tests menu opens with Performance tests and Benchmarks, and closes via bridge @windows @macos @linux', async () => {
  await openTitleMenu(ctx.titleBar)

  await expect
    .poll(() => isPopupVisible(ctx.app, 'comfyTitlePopup.html'), {
      timeout: 5_000,
      intervals: [100, 200]
    })
    .toBe(true)

  const popupItems = await readPopupMenuItems(ctx.app, 'comfyTitlePopup.html')
  expect(popupItems).toEqual(['Performance tests', 'Benchmarks'])

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

test('the tests menu opens Performance tests and Benchmarks in the Desktop window itself @windows @macos @linux', async () => {
  for (const [label, page] of [
    ['Performance tests', '[data-testid="performance-test"]'],
    ['Benchmarks', '[data-testid="benchmarks"]']
  ] as const) {
    await new Promise((resolve) => setTimeout(resolve, TITLE_REOPEN_SUPPRESSION_MS))
    await pickFromTitleMenu(ctx.app, ctx.titleBar, label)
    await ctx.panel.waitForVisible(page)
    expect(await openWindowCount(), `${label} opened without a second window`).toBe(1)
  }

  await showBuildsPage(ctx.panel)
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

  await evalWithRetry(() =>
    ctx.app.evaluate(({ webContents }) => {
      const wc = webContents
        .getAllWebContents()
        .find((w) => w.getURL().includes('comfyTitlePopup.html'))
      if (!wc) throw new Error('title popup webContents missing')
      ;(wc as unknown as { emit: (event: string) => void }).emit('blur')
    })
  )
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

async function openWindowCount(): Promise<number> {
  return evalWithRetry(() =>
    ctx.app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).length
    )
  )
}

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
