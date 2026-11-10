import { expect } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import type { WebContentsPage } from './cdpPages'
import { titlePopupPage, waitForWebContents } from './cdpPages'
import { getIpcInvocations } from './devHooks'
import { evalWithRetry } from './evalRetry'

export async function liveWindowCount(app: ElectronApplication): Promise<number> {
  return evalWithRetry(() =>
    app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).length
    )
  )
}

export async function openPicker(
  app: ElectronApplication,
  panel: WebContentsPage,
  bridgeFn: 'pickInstall' | 'openInstallNewWindow'
): Promise<void> {
  await panel.evaluate<boolean>(`(() => { window.api.openInstancePicker({}); return true })()`)
  await waitForWebContents(app, 'comfyTitlePopup.html')
  const popup = titlePopupPage(app)
  await popup.waitFor(
    async () =>
      popup.evaluate<boolean>(`typeof window.__comfyTitlePopup?.${bridgeFn} === "function"`),
    { timeout: 10_000, message: 'picker bridge never appeared' }
  )
}

export async function expectNoIpcInvocation(
  app: ElectronApplication,
  channel: string,
  match: (call: Record<string, unknown>) => boolean,
  opts?: { windowMs?: number; intervalMs?: number; message?: string }
): Promise<void> {
  const windowMs = opts?.windowMs ?? 2_000
  const intervalMs = opts?.intervalMs ?? 200
  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

  const assertNoHit = async (): Promise<void> => {
    const calls = (await getIpcInvocations(app, channel)) as Record<string, unknown>[]
    const hit = calls.find(match)
    expect(
      hit,
      opts?.message ?? `unexpected ${channel} IPC: ${JSON.stringify(hit)}`
    ).toBeUndefined()
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
