import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CustomerIoSession } from '../../../shared/customerIo'
import { createMessagingClientLoader } from './adapter'
import { createMessagingController } from './controller'

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  pluginIdentify: vi.fn(),
  analytics: {
    addSourceMiddleware: vi.fn(),
    register: vi.fn(),
    identify: vi.fn(),
    page: vi.fn(),
    reset: vi.fn()
  },
  gist: {
    currentMessages: [],
    clearUserToken: vi.fn(),
    setUserLocale: vi.fn(),
    setCurrentRoute: vi.fn(),
    dismissMessage: vi.fn()
  }
}))
vi.mock('@customerio/cdp-analytics-browser', () => ({
  AnalyticsBrowser: { load: mocks.load },
  InAppPlugin: () => ({ identify: mocks.pluginIdentify })
}))
vi.mock('customerio-gist-web', () => ({ default: mocks.gist }))

const session: CustomerIoSession = {
  userId: 'user-a',
  locale: 'en',
  writeKey: 'test',
  siteId: 'test',
  page: 'desktop/comfyui'
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.load.mockReturnValue(mocks.analytics)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({ integrations: { 'Customer.io Data Pipelines': { apiKey: 'test' } } })
    )
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('Desktop SDK adapter ownership', () => {
  it('recovers from an offline settings fetch before constructing one SDK', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'))
    const report = vi.fn()
    const controller = createMessagingController(createMessagingClientLoader(vi.fn()), report)
    await controller.update(session)
    expect(mocks.load).not.toHaveBeenCalled()
    expect(report).toHaveBeenCalledOnce()
    await controller.update(session)
    await controller.update(session)
    expect(mocks.load).toHaveBeenCalledOnce()
    expect(mocks.load.mock.calls[0]![0]).toMatchObject({
      cdnSettings: { integrations: { 'Customer.io Data Pipelines': { apiKey: 'test' } } }
    })
    expect(mocks.analytics.identify).toHaveBeenCalledExactlyOnceWith('user-a', { locale: 'en' })
    expect(mocks.analytics.page).toHaveBeenCalledOnce()
  })

  it('aborts an unavailable settings request so the next activation can recover', async () => {
    vi.useFakeTimers()
    let signal!: AbortSignal
    vi.mocked(fetch).mockImplementationOnce((_url, options) => {
      signal = options!.signal!
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })
    })
    const controller = createMessagingController(createMessagingClientLoader(vi.fn()), vi.fn())
    const first = controller.update(session)
    await vi.advanceTimersByTimeAsync(10_000)
    await first
    expect(signal.aborted).toBe(true)
    expect(mocks.load).not.toHaveBeenCalled()
    await controller.update(session)
    expect(mocks.load).toHaveBeenCalledOnce()
    expect(mocks.analytics.page).toHaveBeenCalledOnce()
  })

  it('retains pending SDK initialization across timeout and retry', async () => {
    vi.useFakeTimers()
    const readiness = deferred<void>()
    mocks.load.mockReturnValue({
      ...mocks.analytics,
      then: readiness.promise.then.bind(readiness.promise)
    })
    const controller = createMessagingController(createMessagingClientLoader(vi.fn()), vi.fn())
    const first = controller.update(session)
    await vi.advanceTimersByTimeAsync(10_000)
    await first
    const retry = controller.update(session)
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.load).toHaveBeenCalledOnce()
    expect(mocks.analytics.addSourceMiddleware).not.toHaveBeenCalled()
    readiness.resolve()
    await retry
    expect(mocks.analytics.register).toHaveBeenCalledOnce()
    expect(mocks.analytics.identify).toHaveBeenCalledOnce()
  })

  it('quarantines a rejected SDK initialization instead of creating another partial client', async () => {
    mocks.load.mockImplementation(() => ({
      ...mocks.analytics,
      then: (_resolve: unknown, reject: (error: Error) => void) => reject(new Error('SDK failed'))
    }))
    const report = vi.fn()
    const controller = createMessagingController(createMessagingClientLoader(vi.fn()), report)
    await controller.update(session)
    await controller.update(session)
    expect(mocks.load).toHaveBeenCalledOnce()
    expect(mocks.analytics.addSourceMiddleware).not.toHaveBeenCalled()
    expect(mocks.analytics.identify).not.toHaveBeenCalled()
    expect(report).toHaveBeenCalledTimes(2)
  })

  it('rejects revoked identity and route callbacks at the in-app plugin', async () => {
    let current: CustomerIoSession | null = session
    await createMessagingClientLoader(vi.fn())(session, () => current)
    const plugin = mocks.analytics.register.mock.calls[0]![0]
    const oldEvent = { event: { userId: session.userId, name: session.page } }
    current = null
    await plugin.identify(oldEvent)
    await plugin.page(oldEvent)
    current = { ...session, userId: 'user-b' }
    await plugin.identify(oldEvent)
    await plugin.page(oldEvent)
    expect(mocks.pluginIdentify).not.toHaveBeenCalled()
    expect(mocks.gist.setCurrentRoute).not.toHaveBeenCalled()
    const newEvent = { event: { userId: current.userId, name: current.page } }
    await plugin.identify(newEvent)
    expect(mocks.pluginIdentify).toHaveBeenCalledExactlyOnceWith(newEvent)
    const route = deferred<void>()
    mocks.gist.setCurrentRoute.mockReturnValue(route.promise)
    const done = vi.fn()
    const changing = plugin.page(newEvent).then(done)
    await Promise.resolve()
    expect(done).not.toHaveBeenCalled()
    route.resolve()
    await changing
  })

  it('retries an identity skipped while offline on the next online activation', async () => {
    const controller = createMessagingController(createMessagingClientLoader(vi.fn()), vi.fn())
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await controller.update(session)
    expect(mocks.analytics.identify).not.toHaveBeenCalled()
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    await controller.update(session)
    expect(mocks.load).toHaveBeenCalledOnce()
    expect(mocks.analytics.identify).toHaveBeenCalledOnce()
    expect(mocks.analytics.page).toHaveBeenCalledOnce()
  })
})
