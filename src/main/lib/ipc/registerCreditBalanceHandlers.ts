import { ipcMain } from 'electron'

import { CreditBalance } from '../../cloud/creditBalance'
import { getCloudSession, rejectAccessToken } from '../../devplatform/session'
import { _broadcastToRenderer } from './broadcast'

export const AFTER_RUN_REFRESH_DELAY_MS = 60_000

const creditBalance = new CreditBalance(
  {
    isSignedIn: () => getCloudSession().isSignedIn(),
    getAccessToken: () => getCloudSession().getAccessToken(),
    rejectAccessToken
  },
  (state) => _broadcastToRenderer('credit-balance:changed', state)
)

let afterRunRefresh: ReturnType<typeof setTimeout> | undefined

export function refreshCreditBalance(): void {
  void creditBalance.refresh()
}

export function creditBalanceAuthChanged(): void {
  creditBalance.authChanged()
}

export function refreshCreditBalanceAfterRun(): void {
  clearTimeout(afterRunRefresh)
  afterRunRefresh = setTimeout(refreshCreditBalance, AFTER_RUN_REFRESH_DELAY_MS)
}

export function registerCreditBalanceHandlers(): void {
  ipcMain.handle('credit-balance:refresh', () => creditBalance.refresh())
}
