import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { expect, test, type ElectronApplication } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { clickInstallTile, expectChooserVisible } from './support/chooserHelpers'
import { WebContentsPage, titlePopupPage } from './support/cdpPages'
import {
  opsFlagsGrantSeed,
  reserveFreePort,
  writeFakeComfyInstall
} from './support/fakeComfyInstall'
import { captureHostWindow } from './support/windowCapture'

test.describe.configure({ mode: 'serial', timeout: 180_000 })

const INSTALL_ID = 'inst-beta-notice'
const INSTALL_NAME = 'Beta Notice Fixture'
let port = 0
const GRANT_ARG = '--enable-asset-hashing'
const GRANT_MIN_CORE = '0.3.80'

let ctx: AppContext
let installPath: string

function coachmarkPopup(app: ElectronApplication): WebContentsPage {
  return new WebContentsPage(app, 'comfyTitleTooltip')
}

async function captureWindow(app: ElectronApplication, name: string): Promise<string> {
  const file = path.join(test.info().outputDir, `${name}.png`)
  await mkdir(path.dirname(file), { recursive: true })
  return captureHostWindow(app, ctx.panel, file)
}

const UNREACHABLE_POSTHOG_HOST = 'http://127.0.0.1:1'
let previousPosthogHost: string | undefined

test.beforeAll(async () => {
  previousPosthogHost = process.env['POSTHOG_HOST']
  process.env['POSTHOG_HOST'] = UNREACHABLE_POSTHOG_HOST

  installPath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-beta-notice-'))
  port = await reserveFreePort()
  await writeFakeComfyInstall({ installPath, port })

  ctx = await launchApp({
    settings: {
      firstUseCompleted: true,
      telemetryEnabled: true,
      betaFeaturesEnabled: true,
      hasSeenCentralPillHint: true
    },
    installations: [
      {
        id: INSTALL_ID,
        name: INSTALL_NAME,
        sourceId: 'comfybuilder',
        sourceLabel: 'ComfyBuilder',
        installPath,
        status: 'installed',
        launchArgs: `--port ${port}`,
        launchMode: 'window',
        browserPartition: 'unique',
        seen: true,
        comfyVersion: {
          commit: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
          baseTag: 'v0.3.99',
          commitsAhead: 0,
          baseTagVerified: true
        }
      }
    ],
    opsFlags: opsFlagsGrantSeed({ arg: GRANT_ARG, minCoreVersion: GRANT_MIN_CORE })
  })
  await expectChooserVisible(ctx.panel)
})

test.afterAll(async () => {
  await ctx?.cleanup()
  if (installPath) await rm(installPath, { recursive: true, force: true })
  if (previousPosthogHost === undefined) delete process.env['POSTHOG_HOST']
  else process.env['POSTHOG_HOST'] = previousPosthogHost
})

test('a first beta activation raises a nonblocking notice over live ComfyUI @linux', async () => {
  await clickInstallTile(ctx.panel, INSTALL_NAME)

  await ctx.panel.waitFor(
    async () =>
      (await ctx.app.evaluate(
        ({ webContents }, p) =>
          webContents.getAllWebContents().some((wc) => wc.getURL().includes(String(p))),
        port
      )) === true,
    { timeout: 90_000, message: 'ComfyUI stub never came up / the host never attached' }
  )

  const popup = coachmarkPopup(ctx.app)
  await popup.waitFor(
    async () => {
      try {
        return await popup.exists('.coachmark')
      } catch {
        return false
      }
    },
    { timeout: 30_000, message: 'beta activation notice never appeared' }
  )

  expect(await popup.textOf('.coachmark-title')).toBe('A beta feature is on')
  expect(await popup.textOf('.coachmark-text')).not.toContain(GRANT_ARG)
  expect(await popup.textOf('.coachmark-action')).toBe('Settings')
  expect(await popup.textOf('.coachmark-dismiss')).toBe('Got it')

  const shot = await captureWindow(ctx.app, '01-notice-over-comfyui')
  test.info().attach('notice over ComfyUI', { path: shot, contentType: 'image/png' })
})

test('the card is anchored on the bell it points at @linux', async () => {
  const bellCentre = await ctx.titleBar.evaluate<number>(`(() => {
    const el = document.querySelector('.title-announcement-button')
    if (!el) return -1
    const r = el.getBoundingClientRect()
    return (r.left + r.right) / 2
  })()`)
  expect(bellCentre).toBeGreaterThan(0)

  const popup = await ctx.app.evaluate(({ BrowserWindow, WebContentsView }) => {
    const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.isVisible())
    if (!win) return null
    for (const child of win.contentView.children) {
      if (!(child instanceof WebContentsView)) continue
      if (!child.webContents.getURL().includes('comfyTitleTooltip')) continue
      const b = child.getBounds()
      return { centre: b.x + b.width / 2, x: b.x, right: b.x + b.width, width: b.width }
    }
    return null
  })
  expect(popup, 'coachmark popup view not found').not.toBeNull()

  expect(popup!.x).toBeLessThanOrEqual(bellCentre)
  expect(popup!.right).toBeGreaterThanOrEqual(bellCentre)

  const sample = async (): Promise<{ offset: number; detail: string } | null> => {
    try {
      const bell = await ctx.titleBar.evaluate<number>(`(() => {
        const el = document.querySelector('.title-announcement-button')
        if (!el) return -1
        const r = el.getBoundingClientRect()
        return (r.left + r.right) / 2
      })()`)
      const view = await ctx.app.evaluate(({ BrowserWindow, WebContentsView }) => {
        const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.isVisible())
        if (!win) return null
        for (const child of win.contentView.children) {
          if (!(child instanceof WebContentsView)) continue
          if (!child.webContents.getURL().includes('comfyTitleTooltip')) continue
          const b = child.getBounds()
          return { x: b.x, width: b.width }
        }
        return null
      })
      const raw = await coachmarkPopup(ctx.app).evaluate<string>(`(() => {
        const c = document.querySelector('.coachmark')
        const b = document.querySelector('.coachmark-beak')
        if (!c || !b) return JSON.stringify({ beak: -1, card: 'card=<absent>' })
        const cr = c.getBoundingClientRect(), br = b.getBoundingClientRect()
        const beak = (br.left + br.right) / 2
        return JSON.stringify({
          beak,
          card: 'cardLeft=' + cr.left + ' cardWidth=' + cr.width +
                ' beakInCard=' + (beak - cr.left) +
                ' beakInlineStyle=' + (b.style.left || '<none>') +
                ' pageWidth=' + window.innerWidth
        })
      })()`)
      const card = JSON.parse(raw) as { beak: number; card: string }
      if (bell < 0 || !view || card.beak < 0) return null
      return {
        offset: Math.abs(view.x + card.beak - bell),
        detail:
          `bell=${bell} viewX=${view.x} viewWidth=${view.width} ${card.card}` +
          ` | viewCentreVsBell=${view.x + view.width / 2 - bell}`
      }
    } catch {
      return null
    }
  }

  expect(await sample(), 'could not read the card geometry at all').not.toBeNull()

  const windowWidth = await ctx.app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.isVisible())
    return win ? win.getContentBounds().width : 0
  })
  const clamped = popup!.x <= 0 || popup!.right >= windowWidth
  if (!clamped) {
    let taken = await sample()
    const deadline = Date.now() + 10_000
    for (let i = 0; i < 40 && (taken === null || taken.offset > 2); i++) {
      if (Date.now() >= deadline) break
      await new Promise((resolve) => setTimeout(resolve, 250))
      const next = await sample()
      if (next !== null) taken = next
    }
    expect(taken, 'never read the card geometry within the budget').not.toBeNull()
    const offset = taken!.offset
    const detail = taken!.detail
    expect(
      offset,
      'the beak must point at the bell, not merely sit in a view that is centred on it. ' + detail
    ).toBeLessThanOrEqual(2)
  }
})

test('the notice does not block the canvas underneath it @linux', async () => {
  const bounds = await ctx.app.evaluate(({ BrowserWindow, WebContentsView }) => {
    const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.isVisible())
    if (!win) throw new Error('no visible window')
    const content = win.getContentBounds()
    for (const child of win.contentView.children) {
      if (!(child instanceof WebContentsView) || !child.getVisible()) continue
      if (!child.webContents.getURL().includes('comfyTitleTooltip')) continue
      const b = child.getBounds()
      return { card: b, window: { width: content.width, height: content.height } }
    }
    return null
  })

  expect(bounds, 'coachmark popup view not found among the window children').not.toBeNull()
  expect(bounds!.card.height).toBeLessThan(bounds!.window.height / 2)
  expect(bounds!.card.width).toBeLessThan(bounds!.window.width / 2)
})

test('the settings link lands on the beta opt-in row and retires the card @linux', async () => {
  const popup = coachmarkPopup(ctx.app)
  expect(await popup.click('.coachmark-action')).toBe(true)

  const settings = titlePopupPage(ctx.app)
  await settings.waitForVisible('.global-settings', { timeout: 15_000 })
  await settings.waitForVisible('[data-field-id="betaFeaturesEnabled"]', { timeout: 15_000 })

  await settings.waitFor(
    () => settings.exists('[data-field-id="betaFeaturesEnabled"].gs-field-flash'),
    { timeout: 10_000, message: 'beta opt-in row was never highlighted' }
  )
  const state = await settings.evaluate<{
    checked: string | null
    disabled: string | null
  }>(`(() => {
    const el = document.querySelector('[data-field-id="betaFeaturesEnabled"] button[role="switch"]')
    if (!el) return { checked: null, disabled: null }
    return {
      checked: el.getAttribute('aria-checked'),
      disabled: el.getAttribute('aria-disabled'),
    }
  })()`)
  expect(state.checked).toBe('true')
  expect(state.disabled).toBe('false')

  const shot = await captureWindow(ctx.app, '02-settings-beta-optout-highlighted')
  test.info().attach('settings opt-out highlighted', { path: shot, contentType: 'image/png' })
})

test('the notice is spent: a second launch stays silent @linux', async () => {
  const stillPending = await ctx.titleBar.evaluate<unknown>(
    `window.api.getPendingBetaNotice(${JSON.stringify(INSTALL_ID)})`
  )
  expect(stillPending).toBeNull()

  const announced = await ctx.titleBar.evaluate<unknown>(
    `window.api.getSetting('betaNoticeAnnouncedArgs')`
  )
  expect(announced).toEqual([GRANT_ARG])
})
