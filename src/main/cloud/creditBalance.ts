import type { CreditBalanceState } from '../../types/ipc'
import { CLOUD_CONFIG } from './config'

export const CREDIT_BALANCE_MIN_INTERVAL_MS = 30_000
const TIMEOUT_MS = 15_000

const SIGNED_OUT: CreditBalanceState = { status: 'signed_out' }
const LOADING: CreditBalanceState = { status: 'loading' }

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function balanceCentsOf(body: unknown): number | null {
  if (!body || typeof body !== 'object') return null
  const { effective_balance_micros: effective, amount_micros: amount } = body as Record<
    string,
    unknown
  >
  return finiteNumber(effective) ?? finiteNumber(amount)
}

export async function fetchCreditBalanceCents(
  accessToken: string,
  apiBase: string = CLOUD_CONFIG.apiBase
): Promise<number> {
  const res = await fetch(`${apiBase.replace(/\/+$/, '')}/billing/balance`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  if (!res.ok) throw new Error(`Credit balance failed: HTTP ${res.status}`)
  const cents = balanceCentsOf(await res.json().catch(() => null))
  if (cents === null) throw new Error('Credit balance returned an invalid body')
  return cents
}

export interface CreditBalanceDeps {
  isSignedIn(): boolean
  getAccessToken(): Promise<string | null>
  broadcast(state: CreditBalanceState): void
  fetchCents?: (accessToken: string) => Promise<number>
  now?: () => number
}

export class CreditBalance {
  private state: CreditBalanceState = LOADING
  private inFlight: Promise<void> | null = null
  private forceQueued = false
  private lastFetchAt = Number.NEGATIVE_INFINITY
  private generation = 0

  constructor(private readonly deps: CreditBalanceDeps) {}

  current(): CreditBalanceState {
    return this.deps.isSignedIn() ? this.state : SIGNED_OUT
  }

  authChanged(signedIn: boolean): void {
    this.generation++
    this.lastFetchAt = Number.NEGATIVE_INFINITY
    this.publish(signedIn ? LOADING : SIGNED_OUT)
    if (signedIn) void this.refresh({ force: true })
  }

  refresh({ force = false }: { force?: boolean } = {}): Promise<void> {
    if (!this.deps.isSignedIn()) return Promise.resolve()
    if (this.inFlight) {
      if (force) this.forceQueued = true
      return this.inFlight
    }
    if (!force && this.now() - this.lastFetchAt < CREDIT_BALANCE_MIN_INTERVAL_MS) {
      return Promise.resolve()
    }
    this.inFlight = this.fetchOnce().finally(() => {
      this.inFlight = null
      if (!this.forceQueued) return
      this.forceQueued = false
      void this.refresh({ force: true })
    })
    return this.inFlight
  }

  private async fetchOnce(): Promise<void> {
    const generation = this.generation
    this.lastFetchAt = this.now()
    const settled = (): boolean => generation === this.generation && !this.forceQueued
    try {
      const token = await this.deps.getAccessToken()
      if (!token) throw new Error('No Cloud access token')
      const cents = await (this.deps.fetchCents ?? fetchCreditBalanceCents)(token)
      if (settled()) this.publish({ status: 'ready', cents })
    } catch {
      if (settled() && this.state.status !== 'ready') this.publish({ status: 'error' })
    }
  }

  private publish(state: CreditBalanceState): void {
    this.state = state
    this.deps.broadcast(this.current())
  }

  private now(): number {
    return (this.deps.now ?? Date.now)()
  }
}
