import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, () => unknown>(),
  broadcast: vi.fn(),
  isSignedIn: vi.fn(() => true)
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: () => unknown) => mocks.handlers.set(channel, handler)
  }
}))
vi.mock('./broadcast', () => ({ _broadcastToRenderer: mocks.broadcast }))
vi.mock('../../devplatform/session', () => ({
  getCloudSession: () => ({
    isSignedIn: mocks.isSignedIn,
    getAccessToken: async () => 'ws-token'
  })
}))

import {
  AFTER_RUN_REFRESH_DELAY_MS,
  creditBalanceAuthChanged,
  refreshCreditBalanceAfterRun,
  registerCreditBalanceHandlers
} from './registerCreditBalanceHandlers'

const fetchMock = vi.fn(async () => new Response(JSON.stringify({ amount_micros: 100 })))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  registerCreditBalanceHandlers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('credit balance handlers', () => {
  it('broadcasts each new balance to the Desktop windows and answers refresh with it', async () => {
    creditBalanceAuthChanged()

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
  })

  it('refetches a minute after a run starts, once however many runs start meanwhile', async () => {
    vi.useFakeTimers()
    creditBalanceAuthChanged()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    fetchMock.mockClear()

    refreshCreditBalanceAfterRun()
    refreshCreditBalanceAfterRun()
    await vi.advanceTimersByTimeAsync(AFTER_RUN_REFRESH_DELAY_MS - 1)
    expect(fetchMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
