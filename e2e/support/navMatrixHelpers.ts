/**
 * Shared helpers for the nav-matrix specs (dashboard / instance / cloud) so the
 * picker-open and window-count plumbing stays in one place.
 */
import { expect } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import type { WebContentsPage } from './cdpPages'
import { titlePopupPage, waitForWebContents } from './cdpPages'
import { getIpcInvocations } from './devHooks'

/** Count of live (non-destroyed) BrowserWindows. */
export async function liveWindowCount(app: ElectronApplication): Promise<number> {
  return app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).length,
  )
}

/**
 * Open the instance picker from the chooser host's panel and wait until its
 * bridge is ready. `bridgeFn` is the bridge method each spec drives next
 * (`pickInstall` or `openInstallNewWindow`) — we wait on the one we'll call.
 */
export async function openPicker(
  app: ElectronApplication,
  panel: WebContentsPage,
  bridgeFn: 'pickInstall' | 'openInstallNewWindow',
): Promise<void> {
  await panel.evaluate<boolean>(`(() => { window.api.openInstancePicker({}); return true })()`)
  await waitForWebContents(app, 'comfyTitlePopup.html')
  const popup = titlePopupPage(app)
  await popup.waitFor(
    async () => popup.evaluate<boolean>(`typeof window.__comfyTitlePopup?.${bridgeFn} === "function"`),
    { timeout: 10_000, message: 'picker bridge never appeared' },
  )
}

/**
 * Assert a `channel` IPC matching `match` is NEVER observed across a settle
 * window. Negative checks can't use `expect.poll(...).toBe(0)`: poll resolves on
 * the first passing sample, and the count starts at 0, so it passes at t=0 and a
 * late IPC slips through. This samples for the full `windowMs` and fails the
 * instant a matching call appears.
 */
export async function expectNoIpcInvocation(
  app: ElectronApplication,
  channel: string,
  match: (call: Record<string, unknown>) => boolean,
  opts?: { windowMs?: number; intervalMs?: number; message?: string },
): Promise<void> {
  const windowMs = opts?.windowMs ?? 2_000
  const intervalMs = opts?.intervalMs ?? 200
  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

  const assertNoHit = async (): Promise<void> => {
    const calls = (await getIpcInvocations(app, channel)) as Record<string, unknown>[]
    const hit = calls.find(match)
    expect(hit, opts?.message ?? `unexpected ${channel} IPC: ${JSON.stringify(hit)}`).toBeUndefined()
  }

  const deadline = Date.now() + windowMs
  let remaining = windowMs
  while (remaining > 0) {
    await assertNoHit()
    await sleep(Math.min(intervalMs, remaining))
    remaining = deadline - Date.now()
  }
  await assertNoHit()
}
