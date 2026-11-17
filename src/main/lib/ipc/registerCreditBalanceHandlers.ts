import { app, ipcMain } from 'electron'

import { CreditBalance } from '../../cloud/creditBalance'
import { issueBillingHandoff } from '../../cloud/billingHandoff'
import { PLATFORM_WEB_BASE_URL } from '../../devplatform/config'
import { getCloudSession } from '../../devplatform/session'
import { comfyWindows } from '../../host/registry'
import { openExternalUrl } from '../openExternal'
import type { CreditBalanceState } from '../../../types/ipc'

export const CREDIT_BALANCE_CHANNELS = {
  get: 'credit-balance:get',
  refresh: 'credit-balance:refresh',
  openManage: 'credit-balance:open-manage',
  changed: 'credit-balance:changed'
} as const

export const AFTER_RUN_REFRESH_DELAY_MS = 60_000

function broadcastCreditBalance(state: CreditBalanceState): void {
  for (const entry of comfyWindows.values()) {
    const panel = entry.panelView
    if (panel && !panel.webContents.isDestroyed()) {
      panel.webContents.send(CREDIT_BALANCE_CHANNELS.changed, state)
    }
  }
}

const creditBalance = new CreditBalance({
  isSignedIn: () => getCloudSession().isSignedIn(),
  getAccessToken: () => getCloudSession().getAccessToken(),
  broadcast: broadcastCreditBalance
})

let afterRunRefresh: ReturnType<typeof setTimeout> | null = null

export function refreshCreditBalance(): void {
  void creditBalance.refresh()
}

export function creditBalanceAuthChanged(signedIn: boolean): void {
  creditBalance.authChanged(signedIn)
}

export function refreshCreditBalanceAfterRun(): void {
  if (afterRunRefresh) return
  afterRunRefresh = setTimeout(() => {
    afterRunRefresh = null
    refreshCreditBalance()
  }, AFTER_RUN_REFRESH_DELAY_MS)
}

async function openManageCredits(): Promise<void> {
  const session = getCloudSession()
  const workspaceId = session.currentWorkspaceId()
  const accessToken = await session.getGrantAccessToken()
  if (!workspaceId || !accessToken) return
  const handoff = await issueBillingHandoff(accessToken, {
    workspaceId,
    receiver: 'platform',
    clientVersion: app.getVersion()
  })
  if (handoff.status === 'issued') return openExternalUrl(handoff.entryUrl)
  const billing = new URL('/profile/billing', PLATFORM_WEB_BASE_URL)
  billing.searchParams.set('workspace', workspaceId)
  return openExternalUrl(billing.toString())
}

export function registerCreditBalanceHandlers(): void {
  ipcMain.handle(CREDIT_BALANCE_CHANNELS.get, () => creditBalance.current())
  ipcMain.handle(CREDIT_BALANCE_CHANNELS.refresh, () => creditBalance.refresh())
  ipcMain.handle(CREDIT_BALANCE_CHANNELS.openManage, () => openManageCredits())
}
