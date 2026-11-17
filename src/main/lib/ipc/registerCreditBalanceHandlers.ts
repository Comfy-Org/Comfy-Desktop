import { app, ipcMain } from 'electron'

import { issueBillingHandoff } from '../../cloud/billingHandoff'
import { CreditBalance } from '../../cloud/creditBalance'
import { getCloudSession } from '../../devplatform/session'
import { openExternalUrl } from '../openExternal'
import { _broadcastToRenderer } from './broadcast'

export const AFTER_RUN_REFRESH_DELAY_MS = 60_000

const creditBalance = new CreditBalance(
  {
    isSignedIn: () => getCloudSession().isSignedIn(),
    getAccessToken: () => getCloudSession().getAccessToken()
  },
  (state) => _broadcastToRenderer('credit-balance:changed', state)
)

let afterRunRefresh: ReturnType<typeof setTimeout> | null = null

export function refreshCreditBalance(): void {
  void creditBalance.refresh()
}

export function creditBalanceAuthChanged(): void {
  creditBalance.authChanged()
}

export function refreshCreditBalanceAfterRun(): void {
  afterRunRefresh ??= setTimeout(() => {
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
  if (handoff.status === 'issued') await openExternalUrl(handoff.entryUrl)
}

export function registerCreditBalanceHandlers(): void {
  ipcMain.handle('credit-balance:refresh', () => creditBalance.refresh())
  ipcMain.handle('credit-balance:open-manage', () => openManageCredits())
}
