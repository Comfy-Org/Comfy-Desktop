import { ipcMain } from 'electron'

import { CreditBalance } from '../../cloud/creditBalance'
import { getCloudSession } from '../../devplatform/session'
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

export function registerCreditBalanceHandlers(): void {
  ipcMain.handle('credit-balance:refresh', () => creditBalance.refresh())
}
