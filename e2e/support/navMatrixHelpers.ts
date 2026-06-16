/**
 * Shared helpers for the nav-matrix specs (dashboard / instance / cloud) so the
 * picker-open and window-count plumbing stays in one place.
 */
import type { ElectronApplication } from 'playwright'
import type { WebContentsPage } from './cdpPages'
import { titlePopupPage, waitForWebContents } from './cdpPages'

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
