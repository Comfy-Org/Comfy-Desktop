import { revokeUrlOf } from './config'
import { revoke } from './oauth'
import { addPendingRevocation, loadPendingRevocations, removePendingRevocation } from './tokenStore'
import type { PendingRevocation } from './tokenStore'

const FIRST_RETRY_MS = 5_000
const MAX_RETRY_MS = 15 * 60_000

export class Revocations {
  private draining: Promise<void> | null = null
  private drainAgain = false
  private failures = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private readonly settledButSaved = new Set<string>()

  add(revocation: PendingRevocation): void {
    addPendingRevocation(revocation)
    if (this.draining) this.drainAgain = true
    else if (!this.retryTimer) void this.drain()
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
      if ((await revoke(next.refreshToken, next.clientId, revokeUrlOf(next.issuer))) === 'retry') {
        failed.add(next.refreshToken)
      } else if (!removePendingRevocation(next.refreshToken)) {
        this.settledButSaved.add(next.refreshToken)
      }
    }
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
