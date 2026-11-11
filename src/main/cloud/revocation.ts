import * as mainTelemetry from '../lib/telemetry'
import { CLOUD_REFRESH_TOKEN_LIFETIME_MS, revokeUrlOf } from './config'
import { revoke } from './oauth'
import type { RevokeResult } from './oauth'
import { addPendingRevocation, loadPendingRevocations, removePendingRevocation } from './tokenStore'
import type { PendingRevocation } from './tokenStore'

export const GRANT_REVOCATION_EVENT = 'comfy.desktop.auth.grant_revocation'

const FIRST_RETRY_MS = 5_000
const MAX_RETRY_MS = 15 * 60_000

export class Revocations {
  private draining: Promise<void> | null = null
  private drainAgain = false
  private failures = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private readonly settledButSaved = new Set<string>()
  private readonly reportedWaiting = new Set<string>()

  add(revocation: Omit<PendingRevocation, 'queuedAt'>): void {
    addPendingRevocation({ ...revocation, queuedAt: Date.now() })
    if (this.draining) this.drainAgain = true
    else void this.drain()
  }

  drain(): Promise<void> {
    if (this.draining) return this.draining
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    const draining = this.sendPending().finally(() => {
      this.draining = null
      const again = this.drainAgain && !this.retryTimer
      this.drainAgain = false
      if (again) void this.drain()
    })
    this.draining = draining
    return draining
  }

  private async sendPending(): Promise<void> {
    for (const refreshToken of this.settledButSaved) {
      if (removePendingRevocation(refreshToken)) this.settledButSaved.delete(refreshToken)
    }
    const failed = new Set<string>()
    for (;;) {
      const { pending, complete } = loadPendingRevocations()
      const next = pending.find(
        (entry) => !failed.has(entry.refreshToken) && !this.settledButSaved.has(entry.refreshToken)
      )
      if (!next) {
        if (complete && failed.size === 0 && this.settledButSaved.size === 0) this.failures = 0
        else this.scheduleRetry()
        return
      }
      const expired = next.queuedAt + CLOUD_REFRESH_TOKEN_LIFETIME_MS <= Date.now()
      const outcome = expired
        ? 'expired'
        : await revoke(next.refreshToken, next.clientId, revokeUrlOf(next.issuer))
      this.report(next.refreshToken, outcome)
      if (outcome === 'retry') {
        failed.add(next.refreshToken)
      } else if (!removePendingRevocation(next.refreshToken)) {
        this.settledButSaved.add(next.refreshToken)
      }
    }
  }

  private report(refreshToken: string, outcome: RevokeResult | 'expired'): void {
    if (outcome === 'retry') {
      if (this.reportedWaiting.has(refreshToken)) return
      this.reportedWaiting.add(refreshToken)
    } else {
      this.reportedWaiting.delete(refreshToken)
    }
    mainTelemetry.emit(GRANT_REVOCATION_EVENT, { outcome })
  }

  private scheduleRetry(): void {
    const delay = Math.min(FIRST_RETRY_MS * 2 ** this.failures, MAX_RETRY_MS)
    this.failures += 1
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.drain()
    }, delay)
  }
}
