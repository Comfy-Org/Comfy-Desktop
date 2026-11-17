import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CREDIT_BALANCE_MIN_INTERVAL_MS, CreditBalance, balanceCentsOf } from './creditBalance'
import { CLOUD_CONFIG } from './config'
import type { CreditBalanceState } from '../../types/ipc'

const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>()

function balanceReply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function deferred(): { promise: Promise<Response>; resolve: (value: Response) => void } {
  let resolve!: (value: Response) => void
  const promise = new Promise<Response>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => balanceReply({ amount_micros: 500, currency: 'usd' }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function setup(over: { signedIn?: boolean; token?: string | null } = {}) {
  const signed = { in: over.signedIn ?? true }
  const states: CreditBalanceState[] = []
  const balance = new CreditBalance(
    {
      isSignedIn: () => signed.in,
      getAccessToken: async () => (over.token === undefined ? 'ws-token' : over.token)
    },
    (state) => states.push(state)
  )
  return { balance, signed, states }
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

describe('CreditBalance', () => {
  it('reads the workspace balance with the workspace token and broadcasts it', async () => {
    const { balance, states } = setup()

    await expect(balance.refresh()).resolves.toEqual({ status: 'ready', cents: 500 })

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      `${CLOUD_CONFIG.apiBase}/billing/balance`,
      expect.objectContaining({ headers: { Authorization: 'Bearer ws-token' } })
    )
    expect(states).toEqual([{ status: 'ready', cents: 500 }])
  })

  it('fetches at most once every 30 seconds', async () => {
    const { balance } = setup()

    await balance.refresh()
    vi.advanceTimersByTime(CREDIT_BALANCE_MIN_INTERVAL_MS - 1)
    await balance.refresh()
    expect(fetchMock).toHaveBeenCalledOnce()

    vi.advanceTimersByTime(1)
    await balance.refresh()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('shares one fetch between callers while it is in flight', async () => {
    const { balance } = setup()
    const reply = deferred()
    fetchMock.mockReturnValueOnce(reply.promise)

    const first = balance.refresh()
    const second = balance.refresh()
    reply.resolve(balanceReply({ amount_micros: 700 }))

    expect(await Promise.all([first, second])).toEqual([
      { status: 'ready', cents: 700 },
      { status: 'ready', cents: 700 }
    ])
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('refetches at once on sign-in or a workspace switch, inside the 30 seconds', async () => {
    const { balance, states } = setup()
    await balance.refresh()

    balance.authChanged()

    expect(states.at(-1)).toEqual({ status: 'loading' })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })

  it('drops the old workspace value when the workspace switches mid-fetch', async () => {
    const { balance, states } = setup()
    const oldWorkspace = deferred()
    fetchMock
      .mockReturnValueOnce(oldWorkspace.promise)
      .mockResolvedValueOnce(balanceReply({ amount_micros: 42 }))

    const pending = balance.refresh()
    balance.authChanged()
    oldWorkspace.resolve(balanceReply({ amount_micros: 999 }))
    await pending

    await vi.waitFor(() => expect(balance.current()).toEqual({ status: 'ready', cents: 42 }))
    expect(states).not.toContainEqual({ status: 'ready', cents: 999 })
  })

  it('has no value and fetches nothing while signed out', async () => {
    const { balance, signed, states } = setup({ signedIn: false })

    await expect(balance.refresh()).resolves.toEqual({ status: 'signed_out' })
    expect(fetchMock).not.toHaveBeenCalled()

    signed.in = true
    await balance.refresh()
    signed.in = false
    balance.authChanged()

    expect(states.at(-1)).toEqual({ status: 'signed_out' })
    expect(balance.current()).toEqual({ status: 'signed_out' })
  })

  it('shows an error when the first read fails, and keeps a known value when a later one fails', async () => {
    const { balance } = setup()
    fetchMock.mockResolvedValueOnce(balanceReply({}, 503))
    await expect(balance.refresh()).resolves.toEqual({ status: 'error' })

    vi.advanceTimersByTime(CREDIT_BALANCE_MIN_INTERVAL_MS)
    await balance.refresh()
    vi.advanceTimersByTime(CREDIT_BALANCE_MIN_INTERVAL_MS)
    fetchMock.mockResolvedValueOnce(new Response('not json'))

    await expect(balance.refresh()).resolves.toEqual({ status: 'ready', cents: 500 })
  })

  it('shows an error when Desktop has no Cloud token to read with', async () => {
    const { balance } = setup({ token: null })

    await expect(balance.refresh()).resolves.toEqual({ status: 'error' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
