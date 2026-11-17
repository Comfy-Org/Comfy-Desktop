import type { CreditBalanceState } from '../../types/ipc'
import { CLOUD_CONFIG } from './config'

export const CREDIT_BALANCE_MIN_INTERVAL_MS = 30_000

const SIGNED_OUT: CreditBalanceState = { status: 'signed_out' }

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function balanceCentsOf(body: unknown): number | null {
  const fields = (body ?? {}) as Record<string, unknown>
  return finite(fields['effective_balance_micros']) ?? finite(fields['amount_micros'])
}

export class CreditBalance {
  private state: CreditBalanceState = { status: 'loading' }
  private inFlight: Promise<void> | null = null
  private forceQueued = false
  private lastFetchAt = Number.NEGATIVE_INFINITY

  constructor(
    private readonly session: {
      isSignedIn(): boolean
      getAccessToken(): Promise<string | null>
      rejectAccessToken(accessToken: string): void
    },
    private readonly broadcast: (state: CreditBalanceState) => void
  ) {}

  current(): CreditBalanceState {
    return this.session.isSignedIn() ? this.state : SIGNED_OUT
  }

  authChanged(): void {
    this.publish({ status: 'loading' })
    void this.refresh(true)
  }

  async refresh(force = false): Promise<CreditBalanceState> {
    if (this.inFlight) this.forceQueued ||= force
    else if (this.session.isSignedIn() && (force || this.isStale())) {
      this.inFlight = this.fetchOnce()
    }
    await this.inFlight
    return this.current()
  }

  private isStale(): boolean {
    return Date.now() - this.lastFetchAt >= CREDIT_BALANCE_MIN_INTERVAL_MS
  }

  private async fetchCents(accessToken: string): Promise<number> {
    const res = await fetch(`${CLOUD_CONFIG.apiBase}/billing/balance`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000)
    })
    if (res.status === 401) this.session.rejectAccessToken(accessToken)
    const cents = res.ok ? balanceCentsOf(await res.json().catch(() => null)) : null
    if (cents === null) throw new Error(`Credit balance unreadable: HTTP ${res.status}`)
    return cents
  }

  private async fetchOnce(): Promise<void> {
    this.lastFetchAt = Date.now()
    let next: CreditBalanceState | null
    try {
      const token = await this.session.getAccessToken()
      if (!token) throw new Error('No Cloud access token')
      next = { status: 'ready', cents: await this.fetchCents(token) }
    } catch {
      next = this.state.status === 'ready' ? null : { status: 'error' }
    }
    this.inFlight = null
    if (this.forceQueued) {
      this.forceQueued = false
      void this.refresh(true)
    } else if (next) {
      this.publish(next)
    }
  }

  private publish(state: CreditBalanceState): void {
    this.state = state
    this.broadcast(this.current())
  }
}
