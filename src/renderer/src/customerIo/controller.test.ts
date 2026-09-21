import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMessagingController, type MessagingClient } from './controller'
import type { CustomerIoSession } from '../../../shared/customerIo'

const session: CustomerIoSession = {
  userId: 'user-a',
  locale: 'en',
  writeKey: 'test',
  siteId: 'test',
  page: 'desktop/comfyui'
}
function client(): MessagingClient {
  return {
    identify: vi.fn(async () => {}),
    page: vi.fn(async () => {}),
    reset: vi.fn(async () => {}),
    dismiss: vi.fn()
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('Desktop messaging lifecycle', () => {
  afterEach(() => vi.useRealTimers())
  it('does not load for an ineligible session and identifies before reporting the page', async () => {
    const sdk = client()
    const load = vi.fn(async () => sdk)
    const controller = createMessagingController(load)
    await controller.update(null)
    expect(load).not.toHaveBeenCalled()
    await controller.update(session)
    await controller.update({ ...session })
    expect(load).toHaveBeenCalledTimes(1)
    expect(sdk.identify).toHaveBeenCalledExactlyOnceWith(session)
    expect(sdk.page).toHaveBeenCalledExactlyOnceWith(session)
    expect(vi.mocked(sdk.identify).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(sdk.page).mock.invocationCallOrder[0]!
    )
  })

  it('never identifies a user who signs out while the SDK is loading', async () => {
    const loading = deferred<MessagingClient>()
    const sdk = client()
    const load = vi.fn(() => loading.promise)
    const controller = createMessagingController(load)
    const first = controller.update(session)
    await Promise.resolve()
    expect(load).toHaveBeenCalledOnce()
    const logout = controller.update(null)
    loading.resolve(sdk)
    await Promise.all([first, logout])
    expect(sdk.identify).not.toHaveBeenCalled()
    expect(sdk.page).not.toHaveBeenCalled()
    expect(sdk.reset).toHaveBeenCalledOnce()
  })

  it('hides the message immediately on logout while identify is pending', async () => {
    const sdk = client()
    const controller = createMessagingController(async () => sdk)
    await controller.update(session)
    const identifying = deferred<void>()
    const started = deferred<void>()
    vi.mocked(sdk.identify).mockImplementationOnce(() => {
      started.resolve()
      return identifying.promise
    })
    const changing = controller.update({ ...session, locale: 'ja' })
    await started.promise
    const logout = controller.update(null)
    expect(sdk.dismiss).toHaveBeenCalled()
    identifying.resolve()
    await Promise.all([changing, logout])
    expect(sdk.page).toHaveBeenCalledTimes(1)
    await controller.update(session)
    expect(sdk.identify).toHaveBeenLastCalledWith(session)
    expect(sdk.page).toHaveBeenCalledTimes(2)
  })

  it('resets between accounts and exposes only the newest identity to event filtering', async () => {
    const sdk = client()
    let current!: () => CustomerIoSession | null
    const controller = createMessagingController(async (_session, getSession) => {
      current = getSession
      return sdk
    })
    await controller.update(session)
    const second = { ...session, userId: 'user-b' }
    const changing = controller.update(second)
    expect(current()).toBeNull()
    await changing
    expect(current()).toEqual(second)
    expect(sdk.reset).toHaveBeenCalledTimes(2)
    expect(sdk.identify).toHaveBeenLastCalledWith(second)
    const logout = controller.update(null)
    expect(current()).toBeNull()
    await logout
  })

  it('recovers from an unavailable SDK on the next activation', async () => {
    const sdk = client()
    const load = vi
      .fn<Parameters<typeof createMessagingController>[0]>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(sdk)
    const report = vi.fn()
    const controller = createMessagingController(load, report)
    await controller.update(session)
    expect(report).toHaveBeenCalledOnce()
    await controller.update(session)
    expect(sdk.page).toHaveBeenCalledOnce()
  })
})

describe('SDK ownership after a timeout', () => {
  afterEach(() => vi.useRealTimers())

  it('keeps the original loader when activation times out and is retried', async () => {
    vi.useFakeTimers()
    const loading = deferred<MessagingClient>()
    const sdk = client()
    const load = vi.fn(() => loading.promise)
    const controller = createMessagingController(load, vi.fn())
    const first = controller.update(session)
    await vi.advanceTimersByTimeAsync(10_000)
    await first
    const retry = controller.update(session)
    await vi.advanceTimersByTimeAsync(0)
    expect(load).toHaveBeenCalledOnce()
    loading.resolve(sdk)
    await retry
    expect(sdk.identify).toHaveBeenCalledExactlyOnceWith(session)
  })

  it.each(['identify', 'reset'] as const)(
    'does not let a newer identity overtake a timed-out %s',
    async (operation) => {
      vi.useFakeTimers()
      const sdk = client()
      const controller = createMessagingController(async () => sdk, vi.fn())
      await controller.update(session)
      const pending = deferred<void>()
      vi.mocked(sdk[operation]).mockImplementationOnce(() => pending.promise)
      const changing = controller.update(
        operation === 'reset' ? null : { ...session, locale: 'ja' }
      )
      await vi.advanceTimersByTimeAsync(10_000)
      await changing
      const second = { ...session, userId: 'user-b' }
      const switching = controller.update(second)
      await vi.advanceTimersByTimeAsync(0)
      expect(sdk.identify).not.toHaveBeenCalledWith(second)
      pending.resolve()
      await switching
      expect(sdk.identify).toHaveBeenLastCalledWith(second)
      expect(sdk.page).toHaveBeenLastCalledWith(second)
    }
  )

  it('reconciles a late identify from reset and keeps messaging disabled until ownership is released', async () => {
    vi.useFakeTimers()
    const sdk = client()
    const identifying = deferred<void>()
    vi.mocked(sdk.identify).mockImplementationOnce(() => identifying.promise)
    let current!: () => CustomerIoSession | null
    const controller = createMessagingController(async (_session, getSession) => {
      current = getSession
      return sdk
    }, vi.fn())
    const first = controller.update(session)
    await vi.advanceTimersByTimeAsync(10_000)
    await first
    expect(current()).toBeNull()
    expect(sdk.dismiss).toHaveBeenCalled()
    expect(sdk.page).not.toHaveBeenCalled()
    identifying.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(sdk.reset).toHaveBeenCalledTimes(2)
    expect(sdk.identify).toHaveBeenCalledTimes(2)
    expect(sdk.page).toHaveBeenCalledExactlyOnceWith(session)
    expect(current()).toEqual(session)
  })

  it('cleans up a late loader without activating a user revoked during its timeout', async () => {
    vi.useFakeTimers()
    const loading = deferred<MessagingClient>()
    const sdk = client()
    const controller = createMessagingController(() => loading.promise, vi.fn())
    const first = controller.update(session)
    await vi.advanceTimersByTimeAsync(10_000)
    await first
    const logout = controller.update(null)
    loading.resolve(sdk)
    await logout
    expect(sdk.identify).not.toHaveBeenCalled()
    expect(sdk.page).not.toHaveBeenCalled()
    expect(sdk.dismiss).toHaveBeenCalled()
    expect(sdk.reset).toHaveBeenCalledOnce()
  })
})
