import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as HandlersModule from './registerCreditBalanceHandlers'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, () => unknown>(),
  broadcast: vi.fn(),
  rejectAccessToken: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: () => unknown) => mocks.handlers.set(channel, handler)
  }
}))
vi.mock('./broadcast', () => ({ _broadcastToRenderer: mocks.broadcast }))
vi.mock('../../devplatform/session', () => ({
  getCloudSession: () => ({ isSignedIn: () => true, getAccessToken: async () => 'ws-token' }),
  rejectAccessToken: mocks.rejectAccessToken
}))

type Handlers = typeof HandlersModule

const fetchMock = vi.fn(async () => new Response(JSON.stringify({ amount_micros: 100 })))
let handlers: Handlers

beforeEach(async () => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.stubGlobal('fetch', fetchMock)
  vi.resetModules()
  handlers = await import('./registerCreditBalanceHandlers')
  handlers.registerCreditBalanceHandlers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('credit balance handlers', () => {
  it('broadcasts each new balance to the Desktop windows and answers refresh with it', async () => {
    handlers.creditBalanceAuthChanged()

    await vi.waitFor(() =>
      expect(mocks.broadcast).toHaveBeenLastCalledWith('credit-balance:changed', {
        status: 'ready',
        cents: 100
      })
    )
    await expect(mocks.handlers.get('credit-balance:refresh')?.()).resolves.toEqual({
      status: 'ready',
      cents: 100
    })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('refetches a minute after the last run starts', async () => {
    handlers.refreshCreditBalanceAfterRun()
    await vi.advanceTimersByTimeAsync(handlers.AFTER_RUN_REFRESH_DELAY_MS - 1)
    handlers.refreshCreditBalanceAfterRun()
    await vi.advanceTimersByTimeAsync(handlers.AFTER_RUN_REFRESH_DELAY_MS - 1)
    expect(fetchMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('hands a refused token to the session so a revoked workspace token is dropped', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 401 }))

    await mocks.handlers.get('credit-balance:refresh')?.()

    expect(mocks.rejectAccessToken).toHaveBeenCalledExactlyOnceWith('ws-token')
  })
})
