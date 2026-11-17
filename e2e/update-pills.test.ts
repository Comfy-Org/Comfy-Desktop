import { test, expect, type ElectronApplication } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { findWebContentsId, systemModalPage } from './support/cdpPages'
import { evalWithRetry } from './support/evalRetry'
import { setAppUpdateState, setInstallUpdate, type AppUpdateStateLike } from './support/devHooks'

let ctx: AppContext

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  ctx = await launchApp({ settings: { firstUseCompleted: true, telemetryEnabled: false } })
})

test.afterAll(async () => {
  await ctx.cleanup()
})

test.beforeEach(async () => {
  await closeSystemModalIfOpen(ctx.app)
  await setAppUpdateState(ctx.app, IDLE_APP_UPDATE)
  await setInstallUpdate(ctx.app, { available: false })
})

const IDLE_APP_UPDATE: AppUpdateStateLike = { kind: null, version: null, autoUpdate: true }
const SIDEBAR_UPDATE = '[data-testid="app-sidebar-desktop-update"]'

function sidebarUpdateIn(kind: NonNullable<AppUpdateStateLike['kind']>): string {
  return `${SIDEBAR_UPDATE}[data-state="${kind}"]`
}

async function expectSidebarUpdate(kind: NonNullable<AppUpdateStateLike['kind']>): Promise<void> {
  await ctx.panel.waitForVisible(sidebarUpdateIn(kind), { timeout: 5_000 })
}

async function expectSystemModalWith(text: string): Promise<void> {
  await expect
    .poll(() => isSystemModalVisible(ctx.app), {
      timeout: 5_000,
      intervals: [100, 200],
      message: 'the update question did not open in the system modal'
    })
    .toBe(true)
  await expect
    .poll(() => systemModalPage(ctx.app).evaluate<string>('document.body.innerText'), {
      timeout: 5_000,
      intervals: [100, 200]
    })
    .toContain(text)
}

test('desktop update is hidden in the sidebar and the title bar when state is idle @windows @macos @linux', async () => {
  await ctx.panel.waitFor(async () => !(await ctx.panel.exists(SIDEBAR_UPDATE)), {
    timeout: 5_000,
    message: 'sidebar desktop update stayed visible while idle'
  })
  expect(await ctx.titleBar.exists('.title-update-pill')).toBe(false)
})

test('desktop update shows in the sidebar for state=available @windows @macos @linux', async () => {
  await setAppUpdateState(ctx.app, { kind: 'available', version: '1.2.3', autoUpdate: false })
  await expectSidebarUpdate('available')
  expect(await ctx.titleBar.exists('.title-update-pill')).toBe(false)
})

test('desktop update shows in the sidebar for state=downloading @windows @macos @linux', async () => {
  await setAppUpdateState(ctx.app, { kind: 'downloading', version: '1.2.3', autoUpdate: true })
  await expectSidebarUpdate('downloading')
})

test('desktop update shows in the sidebar for state=ready @windows @macos @linux', async () => {
  await setAppUpdateState(ctx.app, { kind: 'ready', version: '1.2.3', autoUpdate: true })
  await expectSidebarUpdate('ready')
})

test('clicking the available sidebar desktop update asks to download in the system modal @windows @macos @linux', async () => {
  await setAppUpdateState(ctx.app, { kind: 'available', version: '1.2.3', autoUpdate: false })
  await expectSidebarUpdate('available')

  expect(await ctx.panel.click(SIDEBAR_UPDATE), 'sidebar desktop update click dispatched').toBe(
    true
  )

  await expectSystemModalWith('Download')
})

test('clicking the ready sidebar desktop update asks to restart in the system modal @windows @macos @linux', async () => {
  await setAppUpdateState(ctx.app, { kind: 'ready', version: '1.2.3', autoUpdate: true })
  await expectSidebarUpdate('ready')

  expect(await ctx.panel.click(SIDEBAR_UPDATE), 'sidebar desktop update click dispatched').toBe(
    true
  )

  await expectSystemModalWith('Restart & Update')
})

async function isSystemModalVisible(app: ElectronApplication): Promise<boolean> {
  try {
    return await evalWithRetry(() =>
      app.evaluate(({ BrowserWindow, WebContentsView }) => {
        for (const win of BrowserWindow.getAllWindows()) {
          for (const child of win.contentView.children) {
            if (!(child instanceof WebContentsView)) continue
            if (!child.webContents.getURL().includes('comfySystemModal.html')) continue
            if (!child.getVisible()) return false
            const b = child.getBounds()
            return b.width > 0 && b.height > 0
          }
        }
        return false
      })
    )
  } catch {
    return false
  }
}

async function closeSystemModalIfOpen(app: ElectronApplication): Promise<void> {
  const id = await findWebContentsId(app, 'comfySystemModal.html')
  if (id === null) return
  if (!(await isSystemModalVisible(app))) return
  await evalWithRetry(() =>
    app.evaluate(({ webContents }) => {
      const wc = webContents
        .getAllWebContents()
        .find((w) => w.getURL().includes('comfySystemModal.html'))
      if (!wc) return
      return wc
        .executeJavaScript(
          `(() => {
      const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      document.dispatchEvent(ev)
    })()`
        )
        .catch(() => {})
    })
  )
  await expect
    .poll(() => isSystemModalVisible(app), { timeout: 3_000, intervals: [100, 200] })
    .toBe(false)
}
