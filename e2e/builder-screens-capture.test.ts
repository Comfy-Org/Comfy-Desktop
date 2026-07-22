// Screen capture for the Comfy Builder Desktop flow (DES-565). Not a CI test — a
// screenshot harness. Each sign-in phase is reached by swapping the real IPC
// method, so every frame is a genuine render of the shipped state machine. @macos
import { test, type ElectronApplication } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { launchApp, type AppContext } from './launchApp'

// Override with FIGMA_SCREENS_DIR to send captures elsewhere.
const OUT =
  process.env['FIGMA_SCREENS_DIR'] ??
  path.resolve(__dirname, '..', 'test-results', 'figma-screens')

async function shoot(app: ElectronApplication, name: string): Promise<void> {
  // Let the 180ms phase crossfade finish — capturing on `visible` alone catches
  // the frame at partial opacity.
  await new Promise((r) => setTimeout(r, 500))
  const b64 = await app.evaluate(async ({ webContents }) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().includes('panel.html'))
    if (!wc) return ''
    return (await wc.capturePage()).toPNG().toString('base64')
  })
  await writeFile(`${OUT}/${name}.png`, Buffer.from(b64, 'base64'))
}

type SignInMode = 'hang' | 'timeout' | 'error' | 'success'

/**
 * Swap the sign-in IPC handler so the next CTA click drives a chosen phase.
 * Replaced main-side, not in the renderer: `window.api` comes through
 * contextBridge and is frozen, so assigning to it silently no-ops and the real
 * browser handoff runs instead.
 */
async function stubSignIn(ctx: AppContext, mode: SignInMode): Promise<void> {
  await ctx.app.evaluate(({ ipcMain }, m) => {
    ipcMain.removeHandler('comfybuilder:signIn')
    ipcMain.handle('comfybuilder:signIn', async () => {
      // Never settles — the renderer holds `waiting-for-browser`.
      if (m === 'hang') return new Promise(() => {})
      // Matches the loopback listener's real rejection, which the store maps to `timeout`.
      if (m === 'timeout') throw new Error('Loopback OAuth callback timed out')
      if (m === 'error') throw new Error('access_denied')
      return {
        signedIn: true,
        email: 'willie@comfy.org',
        workspaceId: 'ComfyUI Team',
        workspaceType: 'team',
        role: 'member',
      }
    })
  }, mode)
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  await mkdir(OUT, { recursive: true })
})

/**
 * Wait for the start screen AND for its async boot to settle before touching the
 * picker. `onMounted` awaits the experiment flag + capacity fetch and then calls
 * `applyForkExperimentDefault`, which overwrites `pickedChoice` unconditionally —
 * so a card clicked inside that window gets silently reset to the default.
 */
async function settleStart(ctx: AppContext): Promise<void> {
  await ctx.panel.waitForVisible('.start-hero', { timeout: 15_000 })
  await ctx.panel.waitForVisible('[data-testid="first-use-pick-builder"]')
  await new Promise((r) => setTimeout(r, 2000))
}

/** Fork screen → Builder card → into the chain, sitting on sign-in idle. */
async function toSignIn(ctx: AppContext): Promise<void> {
  await settleStart(ctx)
  await ctx.panel.click('[data-testid="first-use-pick-builder"]')
  await ctx.panel.click('[data-testid="first-use-consent-tos"] input')
  await ctx.panel.click('[data-testid="first-use-continue"]')
  await ctx.panel.waitForVisible('[data-testid="devplatform-signin-cta"]', { timeout: 10_000 })
}

// `waiting-for-browser` has only a Cancel exit, so it gets its own launch rather
// than being escaped mid-run.
test('sign-in: waiting for browser @macos', async () => {
  const ctx = await launchApp()
  try {
    await toSignIn(ctx)
    await stubSignIn(ctx, 'hang')
    await ctx.panel.click('[data-testid="devplatform-signin-cta"]')
    await ctx.panel.waitForVisible('[data-testid="devplatform-signin-progress"]', {
      timeout: 5_000,
    })
    await shoot(ctx.app, '04-signin-waiting-for-browser')
  } finally {
    await ctx.cleanup()
  }
})

test('first-use: fork → sign-in phases → workspace → chooser @macos', async () => {
  const ctx = await launchApp()
  try {
    // 01 — start screen, three-card fork
    await settleStart(ctx)
    await shoot(ctx.app, '01-first-use-fork-three-cards')

    // 02 — Comfy Builder selected, Continue relabelled "Log in"
    await ctx.panel.click('[data-testid="first-use-pick-builder"]')
    await shoot(ctx.app, '02-first-use-builder-selected')

    // 03 — sign-in idle
    await ctx.panel.click('[data-testid="first-use-consent-tos"] input')
    await ctx.panel.click('[data-testid="first-use-continue"]')
    await ctx.panel.waitForVisible('[data-testid="devplatform-signin-cta"]', { timeout: 10_000 })
    await shoot(ctx.app, '03-signin-idle')

    // 05 — timeout: reject the way the loopback listener does.
    await stubSignIn(ctx, 'timeout')
    await ctx.panel.click('[data-testid="devplatform-signin-cta"]')
    await ctx.panel.waitForVisible('[data-testid="devplatform-signin-retry"]', { timeout: 5_000 })
    await shoot(ctx.app, '05-signin-timeout')

    // 06 — error: any other rejection.
    await stubSignIn(ctx, 'error')
    await ctx.panel.click('[data-testid="devplatform-signin-retry"]')
    await ctx.panel.waitForVisible('[data-testid="devplatform-signin-retry-error"]', {
      timeout: 5_000,
    })
    await shoot(ctx.app, '06-signin-error')

    // 07 — success. Held for 1500ms before the chain advances, so grab it fast.
    await stubSignIn(ctx, 'success')
    await ctx.panel.click('[data-testid="devplatform-signin-retry-error"]')
    await ctx.panel.waitForVisible('[data-testid="devplatform-signin-success"]', { timeout: 5_000 })
    await shoot(ctx.app, '07-signin-success')

    // 09 — the bypass: sign-in ends first-use straight onto the chooser.
    await ctx.panel.waitForVisible('.chooser-view', { timeout: 15_000 })
    await ctx.panel.waitForVisible('[data-testid^="chooser-dist-tile-"]', { timeout: 10_000 })
    await new Promise((r) => setTimeout(r, 1200))
    await shoot(ctx.app, '09-chooser-signed-in-distribution-tiles')

    // 10 — account chip menu.
    await ctx.panel.click('[data-testid="devplatform-account-chip"]')
    await ctx.panel.waitForVisible('[data-testid="devplatform-account-signout"]', {
      timeout: 5_000,
    })
    await shoot(ctx.app, '10-account-chip-menu')
  } finally {
    await ctx.cleanup()
  }
})

test('first-use: skip returns to the start screen @macos', async () => {
  const ctx = await launchApp()
  try {
    await settleStart(ctx)
    await ctx.panel.click('[data-testid="first-use-pick-builder"]')
    await ctx.panel.click('[data-testid="first-use-consent-tos"] input')
    await ctx.panel.click('[data-testid="first-use-continue"]')
    await ctx.panel.waitForVisible('[data-testid="devplatform-chain-exit"]', { timeout: 10_000 })
    await ctx.panel.click('[data-testid="devplatform-chain-exit"]')
    await ctx.panel.waitForVisible('[data-testid="first-use-pick-builder"]', { timeout: 10_000 })
    await shoot(ctx.app, '11-first-use-after-skip')
  } finally {
    await ctx.cleanup()
  }
})

test('chooser: signed out @macos', async () => {
  const ctx = await launchApp({ settings: { firstUseCompleted: true, telemetryEnabled: false } })
  try {
    await ctx.panel.waitForVisible('.chooser-view', { timeout: 15_000 })
    await ctx.panel.waitForVisible('[data-testid="devplatform-account-signin"]', {
      timeout: 10_000,
    })
    await new Promise((r) => setTimeout(r, 800))
    await shoot(ctx.app, '12-chooser-signed-out')
  } finally {
    await ctx.cleanup()
  }
})
