import { test, expect, type ElectronApplication } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { findWebContentsId } from './support/cdpPages'
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

test('desktop-update pill is hidden when state is idle @windows @macos @linux', async () => {
  expect(await ctx.titleBar.exists('.title-update-pill.is-app-update')).toBe(false)
})

test('desktop-update pill renders for state=available @windows @macos @linux', async () => {
  await setAppUpdateState(ctx.app, { kind: 'available', version: '1.2.3', autoUpdate: false })
  await expect
    .poll(() => ctx.titleBar.exists('.title-update-pill.is-app-update'), {
      timeout: 5_000,
      intervals: [100, 200]
    })
    .toBe(true)
  const label = await ctx.titleBar.textOf(
    '.title-update-pill.is-app-update .title-update-pill-label'
  )
  expect(label?.toLowerCase()).toContain('update')
  expect(await ctx.titleBar.exists('.title-update-pill.is-app-update.is-ready')).toBe(false)
  expect(await ctx.titleBar.exists('.title-update-pill.is-app-update.is-downloading')).toBe(false)
})

test('desktop-update pill renders for state=downloading @windows @macos @linux', async () => {
  await setAppUpdateState(ctx.app, { kind: 'downloading', version: '1.2.3', autoUpdate: true })
  await expect
    .poll(() => ctx.titleBar.exists('.title-update-pill.is-app-update.is-downloading'), {
      timeout: 5_000,
      intervals: [100, 200]
    })
    .toBe(true)
})

test('desktop-update pill renders for state=ready @windows @macos @linux', async () => {
  await setAppUpdateState(ctx.app, { kind: 'ready', version: '1.2.3', autoUpdate: true })
  await expect
    .poll(() => ctx.titleBar.exists('.title-update-pill.is-app-update.is-ready'), {
      timeout: 5_000,
      intervals: [100, 200]
    })
    .toBe(true)
})

test('clicking the ready desktop-update pill opens the embedded system-modal restart prompt @windows @macos @linux', async () => {
  await setAppUpdateState(ctx.app, { kind: 'ready', version: '1.2.3', autoUpdate: true })
  await expect
    .poll(() => ctx.titleBar.exists('.title-update-pill.is-app-update.is-ready'), {
      timeout: 5_000,
      intervals: [100, 200]
    })
    .toBe(true)

  const ok = await ctx.titleBar.click('.title-update-pill.is-app-update')
  expect(ok, 'desktop-update pill click dispatched').toBe(true)

  await expect
    .poll(() => isSystemModalVisible(ctx.app), {
      timeout: 5_000,
      intervals: [100, 200]
    })
    .toBe(true)
})

test('clicking the ready desktop-update pill waits for its position to settle @windows @macos @linux', async () => {
  await setAppUpdateState(ctx.app, { kind: 'ready', version: '1.2.3', autoUpdate: true })
  await ctx.titleBar.waitForVisible('.title-update-pill.is-app-update.is-ready')
  await ctx.titleBar.evaluate(`(() => {
    const pill = document.querySelector('.title-update-pill.is-app-update')
    const getBounds = pill.getBoundingClientRect.bind(pill)
    pill.getBoundingClientRect = () => {
      const bounds = getBounds()
      pill.getBoundingClientRect = getBounds
      queueMicrotask(() => { pill.style.transform = 'translateX(-160px)' })
      return bounds
    }
  })()`)

  try {
    expect(await ctx.titleBar.click('.title-update-pill.is-app-update')).toBe(true)
    await expect
      .poll(() => isSystemModalVisible(ctx.app), {
        timeout: 5_000,
        intervals: [100, 200]
      })
      .toBe(true)
  } finally {
    await ctx.titleBar.evaluate(`(() => {
      const pill = document.querySelector('.title-update-pill.is-app-update')
      delete pill.getBoundingClientRect
      pill.style.removeProperty('transform')
    })()`)
  }
})

test('install-update chip stays hidden on the install-less chooser host even with an override @windows @macos @linux', async () => {
  await setInstallUpdate(ctx.app, { available: true, version: '99.0.0' })
  await new Promise((r) => setTimeout(r, 250))
  await expect
    .poll(() => ctx.titleBar.exists('.title-install-update-chip'), {
      timeout: 3_000,
      intervals: [100, 200]
    })
    .toBe(false)
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
