/**
 * Title-bar hover-gate state machine on the install-backed comfy
 * window. Mirrors `title-bar-hover-gate.test.ts` but runs after
 * clicking a seeded Cloud chooser tile, which transitions
 * the host's title bar into install-backed mode (`sourceCategory='cloud'`,
 * `is-install-less` dropped) reactively over IPC — the title-bar
 * WebContentsView is long-lived and no longer reloads on identity
 * flips. Past title-bar bugs have surfaced only once an install
 * attached, so the install-backed surface needs its own regression
 * net even though the underlying composable is shared with the
 * chooser host.
 *
 * The Cloud record points at a test-owned loopback page so the real
 * launch/identity handshake does not depend on public Cloud availability.
 */

import { test, expect } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { launchApp, type AppContext } from './launchApp'
import type { WebContentsPage } from './support/cdpPages'
import {
  dispatchPointerLeave,
  dispatchPointerMove,
  dispatchWindowBlur,
  dispatchWindowFocus,
  isHoverActive,
  waitForHoverActive,
} from './support/hoverGate'

let ctx: AppContext
let titleBar: WebContentsPage
let cloudServer: Server

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  cloudServer = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end('<!doctype html><title>Cloud hover-gate fixture</title>')
  })
  await new Promise<void>((resolve, reject) => {
    cloudServer.once('error', reject)
    cloudServer.listen(0, '127.0.0.1', () => resolve())
  })
  const address = cloudServer.address()
  if (!address || typeof address === 'string') throw new Error('Cloud fixture has no TCP address')
  ctx = await launchApp({
    settings: { firstUseCompleted: true, telemetryEnabled: false },
    installations: [{
      name: 'Comfy Cloud', sourceId: 'cloud', installPath: undefined,
      remoteUrl: `http://127.0.0.1:${address.port}/`, launchMode: 'window', browserPartition: 'shared',
    }],
  })
  titleBar = ctx.titleBar

  // Click the seeded Cloud install row (post unsticky-cloud, it's no
  // longer a dedicated `.chooser-tile-cloud` CTA — it renders through
  // `ChooserInstallTile` like any other install). Wait for the existing
  // title-bar view to flip into install-backed mode via the
  // `comfy-titlebar:installation-id-changed` IPC. The pill dropping
  // `.is-install-less` is the user-visible signal that the identity
  // handshake completed; it doubles as a sanity check before the
  // hover-gate assertions below.
  const cloudTile = '.chooser-tile[data-source-category="cloud"]'
  await ctx.panel.waitForVisible(cloudTile)
  expect(await ctx.panel.click(cloudTile), 'Cloud install tile click dispatched').toBe(true)
  await expect.poll(() => titleBar.exists('.title-install-pill:not(.is-install-less)'), {
    timeout: 30_000,
    intervals: [100, 200, 500],
  }).toBe(true)
})

test.afterAll(async () => {
  try {
    await ctx?.cleanup()
  } finally {
    if (cloudServer?.listening) {
      await new Promise<void>((resolve, reject) => {
        cloudServer.close((error) => error ? reject(error) : resolve())
        cloudServer.closeAllConnections()
      })
    }
  }
})

test.beforeEach(async () => {
  await dispatchWindowBlur(titleBar)
  await waitForHoverActive(titleBar, false)
})

test('hover gate is inert after mount on the comfy-window title bar @windows @macos @linux', async () => {
  expect(await isHoverActive(titleBar)).toBe(false)
})

test('pointermove enables the comfy-window hover gate @windows @macos @linux', async () => {
  await dispatchPointerMove(titleBar)
  await waitForHoverActive(titleBar, true)
})

test('window.blur drops the comfy-window hover gate @windows @macos @linux', async () => {
  await dispatchPointerMove(titleBar)
  await waitForHoverActive(titleBar, true)

  await dispatchWindowBlur(titleBar)
  await waitForHoverActive(titleBar, false)
})

test('window.focus alone does NOT re-enable the comfy-window hover gate — only pointermove does @windows @macos @linux', async () => {
  await dispatchPointerMove(titleBar)
  await waitForHoverActive(titleBar, true)
  await dispatchWindowBlur(titleBar)
  await waitForHoverActive(titleBar, false)

  await dispatchWindowFocus(titleBar)
  await new Promise((r) => setTimeout(r, 150))
  expect(await isHoverActive(titleBar)).toBe(false)

  await dispatchPointerMove(titleBar)
  await waitForHoverActive(titleBar, true)
})

test('pointerleave drops the comfy-window hover gate @windows @macos @linux', async () => {
  await dispatchPointerMove(titleBar)
  await waitForHoverActive(titleBar, true)

  await dispatchPointerLeave(titleBar)
  await waitForHoverActive(titleBar, false)
})
