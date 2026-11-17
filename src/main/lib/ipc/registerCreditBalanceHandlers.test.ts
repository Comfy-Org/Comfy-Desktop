import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, () => unknown>(),
  windows: new Map<number, { panelView: unknown }>(),
  isSignedIn: vi.fn(() => true),
  getAccessToken: vi.fn(async () => 'ws-token'),
  getGrantAccessToken: vi.fn(async () => 'grant-token' as string | null),
  currentWorkspaceId: vi.fn(() => 'ws-1' as string | null),
  issueBillingHandoff: vi.fn(),
  openExternalUrl: vi.fn(async () => {})
}))

vi.mock('electron', () => ({
  app: { getVersion: () => '1.2.3' },
  ipcMain: {
    handle: (channel: string, handler: () => unknown) => mocks.handlers.set(channel, handler)
  }
}))
vi.mock('../../host/registry', () => ({
  get comfyWindows() {
    return mocks.windows
  }
}))
vi.mock('../../devplatform/session', () => ({
  getCloudSession: () => ({
    isSignedIn: mocks.isSignedIn,
    getAccessToken: mocks.getAccessToken,
    getGrantAccessToken: mocks.getGrantAccessToken,
    currentWorkspaceId: mocks.currentWorkspaceId
  })
}))
vi.mock('../../cloud/billingHandoff', () => ({ issueBillingHandoff: mocks.issueBillingHandoff }))
vi.mock('../openExternal', () => ({ openExternalUrl: mocks.openExternalUrl }))

import {
  AFTER_RUN_REFRESH_DELAY_MS,
  CREDIT_BALANCE_CHANNELS,
  creditBalanceAuthChanged,
  refreshCreditBalanceAfterRun,
  registerCreditBalanceHandlers
} from './registerCreditBalanceHandlers'

function panel(destroyed = false) {
  return { webContents: { isDestroyed: () => destroyed, send: vi.fn() } }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.handlers.clear()
  mocks.windows.clear()
  registerCreditBalanceHandlers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('credit balance handlers', () => {
  it('sends a new balance to the panel of every Desktop window', async () => {
    const first = panel()
    const second = panel()
    const closed = panel(true)
    mocks.windows.set(1, { panelView: first })
    mocks.windows.set(2, { panelView: second })
    mocks.windows.set(3, { panelView: closed })
    mocks.windows.set(4, { panelView: null })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ amount_micros: 100 })))
    )

    creditBalanceAuthChanged(true)

    await vi.waitFor(() =>
      expect(first.webContents.send).toHaveBeenLastCalledWith(CREDIT_BALANCE_CHANNELS.changed, {
        status: 'ready',
        cents: 100
      })
    )
    expect(second.webContents.send.mock.calls).toEqual(first.webContents.send.mock.calls)
    expect(closed.webContents.send).not.toHaveBeenCalled()
  })

  it('refetches once a minute after a run starts, however many runs start meanwhile', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn(async () => new Response(JSON.stringify({ amount_micros: 100 })))
    vi.stubGlobal('fetch', fetch)
    creditBalanceAuthChanged(false)

    refreshCreditBalanceAfterRun()
    refreshCreditBalanceAfterRun()
    await vi.advanceTimersByTimeAsync(AFTER_RUN_REFRESH_DELAY_MS - 1)
    expect(fetch).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('opens Manage plan & credits on the Developer Platform through a billing handoff', async () => {
    mocks.issueBillingHandoff.mockResolvedValue({
      status: 'issued',
      entryUrl: 'https://platform.test/handoff'
    })

    await mocks.handlers.get(CREDIT_BALANCE_CHANNELS.openManage)?.()

    expect(mocks.issueBillingHandoff).toHaveBeenCalledExactlyOnceWith('grant-token', {
      workspaceId: 'ws-1',
      receiver: 'platform',
      clientVersion: '1.2.3'
    })
    expect(mocks.openExternalUrl).toHaveBeenCalledExactlyOnceWith('https://platform.test/handoff')
  })

  it('opens the Platform billing page for the workspace when Cloud refuses the handoff', async () => {
    mocks.issueBillingHandoff.mockResolvedValue({ status: 'refused' })

    await mocks.handlers.get(CREDIT_BALANCE_CHANNELS.openManage)?.()

    expect(mocks.openExternalUrl).toHaveBeenCalledExactlyOnceWith(
      'https://platform.comfy.org/profile/billing?workspace=ws-1'
    )
  })

  it('opens nothing while signed out', async () => {
    mocks.getGrantAccessToken.mockResolvedValue(null)

    await mocks.handlers.get(CREDIT_BALANCE_CHANNELS.openManage)?.()

    expect(mocks.issueBillingHandoff).not.toHaveBeenCalled()
    expect(mocks.openExternalUrl).not.toHaveBeenCalled()
  })
})
