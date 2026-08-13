import type { WebContents } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as FlowSharedModule from './flowShared'

import {
  closeActiveBridge,
  handleFirebasePopup,
  runBannerCleanup,
  showCopyLinkBanner
} from './index'

const h = vi.hoisted(() => ({
  beginSessionInjection: vi.fn(() => ({ owner: 'test' })),
  bindSignedInUser: vi.fn(),
  capture: vi.fn(),
  emit: vi.fn(),
  injectSession: vi.fn(() => Promise.resolve(true)),
  openExternal: vi.fn(() => Promise.resolve()),
  releaseSessionInjection: vi.fn(),
  restoreParentWindow: vi.fn(),
  signInViaDesktopLoginCode: vi.fn(),
  startBridgeServer: vi.fn()
}))

vi.mock('electron', () => ({ shell: { openExternal: h.openExternal } }))
vi.mock('./copyLinkBanner', () => ({
  buildCopyLinkBannerScript: () => 'show-banner',
  buildRemoveCopyLinkBannerScript: () => 'remove-banner',
  COPY_LINK_BANNER_CSS: '',
  OPEN_LINK_SENTINEL: 'open-again'
}))
vi.mock('./inject', () => ({
  beginFirebaseSessionInjection: h.beginSessionInjection,
  injectFirebaseSession: h.injectSession,
  releaseFirebaseSessionInjection: h.releaseSessionInjection
}))
vi.mock('./restoreParentWindow', () => ({ restoreParentWindow: h.restoreParentWindow }))
vi.mock('./server', () => ({ startBridgeServer: h.startBridgeServer }))
vi.mock('./flowShared', async (importOriginal) => ({
  ...(await importOriginal<typeof FlowSharedModule>()),
  bindSignedInUser: h.bindSignedInUser
}))
vi.mock('../desktopLoginCode', () => ({
  signInViaDesktopLoginCode: h.signInViaDesktopLoginCode
}))
vi.mock('../../lib/i18n', () => ({ t: (key: string) => key }))
vi.mock('../../lib/telemetry', () => ({
  bucketError: () => 'other',
  capture: h.capture,
  emit: h.emit
}))

const AUTH_URL = 'https://dreamboothy.firebaseapp.com/__/auth/handler?providerId=google.com'

function fakeContents(url = 'https://cloud.comfy.org/'): WebContents & {
  executeJavaScript: ReturnType<typeof vi.fn>
  off: ReturnType<typeof vi.fn>
  getURL: ReturnType<typeof vi.fn>
} {
  return {
    executeJavaScript: vi.fn(() => Promise.resolve()),
    getURL: vi.fn(() => url),
    insertCSS: vi.fn(() => Promise.resolve('css-key')),
    isDestroyed: vi.fn(() => false),
    off: vi.fn(),
    on: vi.fn()
  } as unknown as WebContents & {
    executeJavaScript: ReturnType<typeof vi.fn>
    off: ReturnType<typeof vi.fn>
    getURL: ReturnType<typeof vi.fn>
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  h.signInViaDesktopLoginCode.mockResolvedValue('fallback')
})

afterEach(() => {
  closeActiveBridge()
  runBannerCleanup()
  vi.useRealTimers()
})

describe('handleFirebasePopup legacy flow', () => {
  it('falls back when the login-code orchestrator rejects unexpectedly', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.signInViaDesktopLoginCode.mockRejectedValueOnce(new Error('unexpected'))
    h.startBridgeServer.mockRejectedValueOnce(new Error('legacy unavailable'))

    try {
      await handleFirebasePopup(AUTH_URL, fakeContents())

      expect(h.startBridgeServer).toHaveBeenCalledOnce()
      expect(consoleError).toHaveBeenCalledWith(
        'Desktop login-code flow failed unexpectedly; using legacy fallback'
      )
    } finally {
      consoleError.mockRestore()
    }
  })

  it('does not inject the legacy session after the hosted view changes origin', async () => {
    const contents = fakeContents()
    contents.getURL
      .mockReturnValueOnce('https://cloud.comfy.org/')
      .mockReturnValue('https://evil.example.com/')
    h.startBridgeServer.mockResolvedValue({
      url: 'http://localhost:9876/',
      signInPromise: Promise.resolve({ user: { uid: 'user-1' }, apiKey: 'api-key' }),
      close: vi.fn()
    })

    const flow = handleFirebasePopup(AUTH_URL, contents)
    await vi.runAllTimersAsync()
    await flow

    expect(h.injectSession).not.toHaveBeenCalled()
    expect(h.bindSignedInUser).not.toHaveBeenCalled()
    expect(h.restoreParentWindow).not.toHaveBeenCalled()
  })

  it('does not inject the legacy session when the starting origin is unavailable', async () => {
    const contents = fakeContents('')
    h.startBridgeServer.mockResolvedValue({
      url: 'http://localhost:9876/',
      signInPromise: Promise.resolve({ user: { uid: 'user-1' }, apiKey: 'api-key' }),
      close: vi.fn()
    })

    const flow = handleFirebasePopup(AUTH_URL, contents)
    await vi.runAllTimersAsync()
    await flow

    expect(h.injectSession).not.toHaveBeenCalled()
    expect(h.bindSignedInUser).not.toHaveBeenCalled()
    expect(h.restoreParentWindow).not.toHaveBeenCalled()
  })

  it('cannot inject or clean up newer UI after being superseded during the success hold', async () => {
    const contents = fakeContents()
    const close = vi.fn()
    h.startBridgeServer.mockResolvedValue({
      url: 'http://localhost:9876/',
      signInPromise: Promise.resolve({ user: { uid: 'old-user' }, apiKey: 'api-key' }),
      close
    })

    const staleFlow = handleFirebasePopup(AUTH_URL, contents)
    await vi.advanceTimersByTimeAsync(0)
    expect(h.bindSignedInUser).not.toHaveBeenCalled()
    expect(h.capture).toHaveBeenCalledWith('comfy.desktop.auth.sign_in_started', {
      provider: 'google.com',
      flow: 'loopback_bridge'
    })

    closeActiveBridge()
    runBannerCleanup()
    showCopyLinkBanner(contents, 'https://cloud.comfy.org/new-login')
    await vi.advanceTimersByTimeAsync(3000)
    await staleFlow

    expect(h.injectSession).not.toHaveBeenCalled()
    expect(h.bindSignedInUser).not.toHaveBeenCalled()
    expect(h.restoreParentWindow).not.toHaveBeenCalled()
    expect(contents.off).toHaveBeenCalledTimes(1)
    runBannerCleanup()
    expect(contents.off).toHaveBeenCalledTimes(2)
    expect(close).toHaveBeenCalled()
  })

  it('settles a flow cancelled while it is waiting for the bridge callback', async () => {
    h.startBridgeServer.mockResolvedValue({
      url: 'http://localhost:9876/',
      signInPromise: new Promise(() => {}),
      close: vi.fn()
    })

    const staleFlow = handleFirebasePopup(AUTH_URL, fakeContents())
    await vi.advanceTimersByTimeAsync(0)
    closeActiveBridge()

    await expect(staleFlow).resolves.toBeUndefined()
    expect(h.emit).not.toHaveBeenCalled()
  })

  it('settles during server startup and closes the handle if startup finishes later', async () => {
    let resolveStart!: (handle: {
      url: string
      signInPromise: Promise<never>
      close: () => void
    }) => void
    const startingBridge = new Promise<{
      url: string
      signInPromise: Promise<never>
      close: () => void
    }>((resolve) => {
      resolveStart = resolve
    })
    h.startBridgeServer.mockReturnValue(startingBridge)

    const staleFlow = handleFirebasePopup(AUTH_URL, fakeContents())
    await vi.advanceTimersByTimeAsync(0)
    closeActiveBridge()
    await expect(staleFlow).resolves.toBeUndefined()

    const close = vi.fn()
    resolveStart({
      url: 'http://localhost:9876/',
      signInPromise: new Promise(() => {}),
      close
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(close).toHaveBeenCalledOnce()
  })

  it('tags legacy failures with the loopback flow axis', async () => {
    h.startBridgeServer.mockRejectedValueOnce(new Error('startup failed'))
    const onError = vi.fn()

    await handleFirebasePopup(AUTH_URL, fakeContents(), { onError })

    expect(h.emit).toHaveBeenCalledWith('comfy.desktop.auth.sign_in_failed', {
      provider: 'google.com',
      error_class: 'unknown',
      error_bucket: 'other',
      flow: 'loopback_bridge'
    })
    expect(onError).toHaveBeenCalledWith({
      provider: 'google.com',
      error_class: 'unknown',
      error_bucket: 'other',
      flow: 'loopback_bridge'
    })
  })

  it('continues through the banner when the initial browser open rejects', async () => {
    h.openExternal.mockRejectedValueOnce(new Error('no default browser'))
    h.startBridgeServer.mockResolvedValue({
      url: 'http://localhost:9876/',
      signInPromise: Promise.resolve({ user: { uid: 'user-1' }, apiKey: 'api-key' }),
      close: vi.fn()
    })

    const flow = handleFirebasePopup(AUTH_URL, fakeContents())
    await vi.runAllTimersAsync()

    await expect(flow).resolves.toBeUndefined()
    expect(h.emit).not.toHaveBeenCalled()
  })

  it('binds the verified user only after the legacy session injection succeeds', async () => {
    const contents = fakeContents()
    const user = { uid: 'user-1', email: 'user@example.com' }
    h.startBridgeServer.mockResolvedValue({
      url: 'http://localhost:9876/',
      signInPromise: Promise.resolve({ user, apiKey: 'api-key' }),
      close: vi.fn()
    })

    const flow = handleFirebasePopup(AUTH_URL, contents)
    await vi.runAllTimersAsync()
    await flow

    expect(h.bindSignedInUser).toHaveBeenCalledWith(user, contents)
    expect(h.bindSignedInUser.mock.invocationCallOrder[0]).toBeGreaterThan(
      h.injectSession.mock.invocationCallOrder[0]!
    )
    expect(h.restoreParentWindow).toHaveBeenCalledOnce()
  })

  it('does not bind when legacy session injection fails', async () => {
    const contents = fakeContents()
    h.injectSession.mockResolvedValueOnce(false)
    h.startBridgeServer.mockResolvedValue({
      url: 'http://localhost:9876/',
      signInPromise: Promise.resolve({ user: { uid: 'user-1' }, apiKey: 'api-key' }),
      close: vi.fn()
    })

    const flow = handleFirebasePopup(AUTH_URL, contents)
    await vi.runAllTimersAsync()
    await flow

    expect(h.injectSession).toHaveBeenCalledOnce()
    expect(h.bindSignedInUser).not.toHaveBeenCalled()
    expect(h.restoreParentWindow).not.toHaveBeenCalled()
  })
})
