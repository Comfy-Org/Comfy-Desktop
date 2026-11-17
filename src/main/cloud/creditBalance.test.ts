import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  CREDIT_BALANCE_MIN_INTERVAL_MS,
  CreditBalance,
  balanceCentsOf,
  fetchCreditBalanceCents
} from './creditBalance'
import type { CreditBalanceState } from '../../types/ipc'

afterEach(() => {
  vi.unstubAllGlobals()
})

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function setup(over: { signedIn?: boolean; token?: string | null } = {}) {
  const clock = { now: 1_000_000 }
  const signed = { in: over.signedIn ?? true }
  const states: CreditBalanceState[] = []
  const fetchCents = vi.fn<(token: string) => Promise<number>>(async () => 500)
  const getAccessToken = vi.fn(async () => (over.token === undefined ? 'ws-token' : over.token))
  const balance = new CreditBalance({
    isSignedIn: () => signed.in,
    getAccessToken,
    broadcast: (state) => states.push(state),
    fetchCents,
    now: () => clock.now
  })
  return { balance, clock, signed, states, fetchCents, getAccessToken }
}

describe('balanceCentsOf', () => {
  it('prefers the effective balance, which takes pending charges off', () => {
    expect(balanceCentsOf({ amount_micros: 900, effective_balance_micros: -40 })).toBe(-40)
  })

  it('falls back to the total balance when there is no effective one', () => {
    expect(balanceCentsOf({ amount_micros: 900, currency: 'usd' })).toBe(900)
  })

  it.each([
    ['no body', null],
    ['a list', [1]],
    ['a string amount', { amount_micros: '900' }],
    ['a non-finite amount', { amount_micros: Number.POSITIVE_INFINITY }],
    ['no amount at all', { currency: 'usd' }]
  ])('reads nothing from %s', (_what, body) => {
    expect(balanceCentsOf(body)).toBeNull()
  })
})

describe('fetchCreditBalanceCents', () => {
  it('reads the workspace balance with the bearer token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ amount_micros: 1_234, currency: 'usd' })))
    )

    await expect(fetchCreditBalanceCents('ws-token', 'https://cloud.test/api/')).resolves.toBe(
      1_234
    )
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      'https://cloud.test/api/billing/balance',
      expect.objectContaining({
        headers: { Accept: 'application/json', Authorization: 'Bearer ws-token' }
      })
    )
  })

  it('fails on an HTTP error or a body it cannot read', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 503 }))
    )
    await expect(fetchCreditBalanceCents('t', 'https://cloud.test/api')).rejects.toThrow('503')

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not json'))
    )
    await expect(fetchCreditBalanceCents('t', 'https://cloud.test/api')).rejects.toThrow(
      'invalid body'
    )
  })
})

describe('CreditBalance', () => {
  it('fetches with the workspace token and broadcasts the value to every panel', async () => {
    const { balance, states, fetchCents } = setup()

    await balance.refresh()

    expect(fetchCents).toHaveBeenCalledExactlyOnceWith('ws-token')
    expect(states).toEqual([{ status: 'ready', cents: 500 }])
    expect(balance.current()).toEqual({ status: 'ready', cents: 500 })
  })

  it('fetches at most once every 30 seconds', async () => {
    const { balance, clock, fetchCents } = setup()

    await balance.refresh()
    clock.now += CREDIT_BALANCE_MIN_INTERVAL_MS - 1
    await balance.refresh()
    expect(fetchCents).toHaveBeenCalledOnce()

    clock.now += 1
    await balance.refresh()
    expect(fetchCents).toHaveBeenCalledTimes(2)
  })

  it('shares one fetch between callers while it is in flight', async () => {
    const { balance, fetchCents } = setup()
    const reply = deferred<number>()
    fetchCents.mockReturnValueOnce(reply.promise)

    const first = balance.refresh()
    const second = balance.refresh()
    reply.resolve(700)
    await Promise.all([first, second])

    expect(fetchCents).toHaveBeenCalledOnce()
    expect(balance.current()).toEqual({ status: 'ready', cents: 700 })
  })

  it('refetches at once on sign-in or a workspace switch, inside the 30 seconds', async () => {
    const { balance, states, fetchCents } = setup()
    await balance.refresh()

    balance.authChanged(true)
    await vi.waitFor(() => expect(fetchCents).toHaveBeenCalledTimes(2))

    expect(states).toContainEqual({ status: 'loading' })
  })

  it('drops the old workspace value when the workspace switches mid-fetch', async () => {
    const { balance, fetchCents } = setup()
    const oldWorkspace = deferred<number>()
    fetchCents.mockReturnValueOnce(oldWorkspace.promise).mockResolvedValueOnce(42)

    void balance.refresh()
    balance.authChanged(true)
    oldWorkspace.resolve(999)

    await vi.waitFor(() => expect(balance.current()).toEqual({ status: 'ready', cents: 42 }))
    expect(fetchCents).toHaveBeenCalledTimes(2)
  })

  it('has no value and fetches nothing while signed out', async () => {
    const { balance, signed, states, fetchCents } = setup({ signedIn: false })

    await balance.refresh()
    expect(fetchCents).not.toHaveBeenCalled()
    expect(balance.current()).toEqual({ status: 'signed_out' })

    signed.in = true
    await balance.refresh()
    signed.in = false
    balance.authChanged(false)

    expect(states.at(-1)).toEqual({ status: 'signed_out' })
    expect(balance.current()).toEqual({ status: 'signed_out' })
  })

  it('shows an error when the first fetch fails, and keeps a known value when a later one fails', async () => {
    const { balance, clock, fetchCents } = setup()
    fetchCents.mockRejectedValueOnce(new Error('HTTP 503'))

    await balance.refresh()
    expect(balance.current()).toEqual({ status: 'error' })

    clock.now += CREDIT_BALANCE_MIN_INTERVAL_MS
    await balance.refresh()
    clock.now += CREDIT_BALANCE_MIN_INTERVAL_MS
    fetchCents.mockRejectedValueOnce(new Error('HTTP 503'))
    await balance.refresh()

    expect(balance.current()).toEqual({ status: 'ready', cents: 500 })
  })

  it('shows an error when Desktop has no Cloud token to read with', async () => {
    const { balance, fetchCents } = setup({ token: null })

    await balance.refresh()

    expect(fetchCents).not.toHaveBeenCalled()
    expect(balance.current()).toEqual({ status: 'error' })
  })
})
