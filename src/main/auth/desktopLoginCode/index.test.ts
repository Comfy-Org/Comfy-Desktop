import type { BrowserWindow, WebContents } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as ClientModule from './client'
import type * as OrchestratorModule from './index'
import type * as FlowSharedModule from '../firebaseBridge/flowShared'

const h = vi.hoisted(() => ({
  appIsPackaged: false,
  openExternal: vi.fn((_url: string) => Promise.resolve()),
  capture: vi.fn(),
  emit: vi.fn(),
  bucketError: vi.fn(() => 'bucketed'),
  bindSignedInUser: vi.fn(),
  showCopyLinkBanner: vi.fn(),
  runBannerCleanup: vi.fn(),
  closeActiveBridge: vi.fn(),
  settingsGet: vi.fn(),
  getDeviceId: vi.fn(() => 'machine-hash-1234'),
  createDesktopLoginCode: vi.fn(),
  exchangeDesktopLoginCode: vi.fn(),
  signInWithCustomToken: vi.fn(),
  lookupAccount: vi.fn(),
  buildPersistedUserFromCustomToken: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getVersion: () => '1.2.3',
    get isPackaged() {
      return h.appIsPackaged
    }
  },
  shell: { openExternal: h.openExternal }
}))

vi.mock('../../lib/telemetry', () => ({
  capture: h.capture,
  emit: h.emit,
  bucketError: h.bucketError
}))

vi.mock('../../lib/deviceId', () => ({ getDeviceId: h.getDeviceId }))

vi.mock('../../settings', () => ({ get: h.settingsGet }))

vi.mock('../firebaseBridge/flowState', () => ({
  showCopyLinkBanner: h.showCopyLinkBanner,
  runBannerCleanup: h.runBannerCleanup,
  closeActiveBridge: h.closeActiveBridge,
  openExternalSafely: (url: string) => {
    void h.openExternal(url).catch(() => {})
  }
}))

vi.mock('../firebaseBridge/flowShared', async (importOriginal) => ({
  ...(await importOriginal<typeof FlowSharedModule>()),
  bindSignedInUser: h.bindSignedInUser,
  POST_SIGNIN_HOLD_MS: 3000
}))

vi.mock('./client', async (importOriginal) => ({
  ...(await importOriginal<typeof ClientModule>()),
  createDesktopLoginCode: h.createDesktopLoginCode,
  exchangeDesktopLoginCode: h.exchangeDesktopLoginCode
}))

vi.mock('./customTokenSignIn', () => ({
  signInWithCustomToken: h.signInWithCustomToken,
  lookupAccount: h.lookupAccount,
  buildPersistedUserFromCustomToken: h.buildPersistedUserFromCustomToken
}))

const AUTH_URL = 'https://dreamboothy.firebaseapp.com/__/auth/handler?providerId=google.com'

const GRANT = {
  code: 'dlc_test-code',
  expires_in: 300,
  poll_interval: 3
}

function fakeContents(url = 'https://cloud.comfy.org/'): WebContents & {
  executeJavaScript: ReturnType<typeof vi.fn>
} {
  return {
    isDestroyed: vi.fn(() => false),
    getURL: vi.fn(() => url),
    executeJavaScript: vi.fn(() => Promise.resolve())
  } as unknown as WebContents & { executeJavaScript: ReturnType<typeof vi.fn> }
}

/** Fresh module per test — the singleton AbortController lives at module scope. */
async function loadOrchestrator(): Promise<typeof OrchestratorModule> {
  vi.resetModules()
  return await import('./index')
}

/** Resolve the flow's happy tail so the poll loop can complete. */
function mockSignInChain(persistedUser: Record<string, unknown>): void {
  h.signInWithCustomToken.mockResolvedValue({
    idToken: 'id-token',
    refreshToken: 'refresh-token',
    expiresIn: '3600'
  })
  h.lookupAccount.mockResolvedValue({ localId: 'uid-1' })
  h.buildPersistedUserFromCustomToken.mockReturnValue(persistedUser)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
  h.appIsPackaged = false
  h.openExternal.mockResolvedValue(undefined)
  vi.spyOn(Math, 'random').mockReturnValue(0)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('signInViaDesktopLoginCode', () => {
  it('falls back to the legacy bridge when code creation fails, without opening the browser', async () => {
    h.settingsGet.mockReturnValue(true)
    h.createDesktopLoginCode.mockRejectedValue(new Error('create failed'))
    const mod = await loadOrchestrator()

    const outcome = await mod.signInViaDesktopLoginCode(AUTH_URL, fakeContents(), {})

    expect(outcome).toBe('fallback')
    expect(h.openExternal).not.toHaveBeenCalled()
    expect(h.showCopyLinkBanner).not.toHaveBeenCalled()
    // The legacy path emits its own funnel events — including its own
    // sign_in_started, so this path must not have double-counted one.
    expect(h.capture).not.toHaveBeenCalled()
    expect(h.emit).not.toHaveBeenCalled()
  })

  it('does not fall back when the view is destroyed before code creation fails', async () => {
    h.settingsGet.mockReturnValue(true)
    let destroyed = false
    h.createDesktopLoginCode.mockImplementation(async () => {
      destroyed = true
      throw new Error('create failed')
    })
    const contents = fakeContents()
    contents.isDestroyed = vi.fn(() => destroyed)
    const mod = await loadOrchestrator()

    const outcome = await mod.signInViaDesktopLoginCode(AUTH_URL, contents, {})

    expect(outcome).toBe('handled')
    expect(h.openExternal).not.toHaveBeenCalled()
    expect(h.showCopyLinkBanner).not.toHaveBeenCalled()
    expect(h.capture).not.toHaveBeenCalled()
    expect(h.emit).not.toHaveBeenCalled()
  })

  it('completes the happy path: opens the browser, polls pending→complete, injects the user', async () => {
    h.settingsGet.mockReturnValue(true)
    h.createDesktopLoginCode.mockResolvedValue(GRANT)
    h.exchangeDesktopLoginCode
      .mockResolvedValueOnce({ status: 'pending' })
      .mockResolvedValueOnce({ status: 'complete', custom_token: 'custom-token-value' })
    const persistedUser = { uid: 'uid-1' }
    mockSignInChain(persistedUser)
    const mod = await loadOrchestrator()
    const contents = fakeContents()
    const parentWindow = {
      isDestroyed: vi.fn(() => false),
      isMinimized: vi.fn(() => true),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn()
    }

    const promise = mod.signInViaDesktopLoginCode(AUTH_URL, contents, {
      parentWindow: parentWindow as unknown as BrowserWindow
    })
    await vi.runAllTimersAsync()
    const outcome = await promise

    expect(outcome).toBe('handled')
    expect(h.capture).toHaveBeenCalledWith('comfy.desktop.auth.sign_in_started', {
      provider: 'google.com',
      flow: 'desktop_login_code'
    })

    expect(h.openExternal).toHaveBeenCalledTimes(1)
    const openedUrl = h.openExternal.mock.calls[0]![0]
    expect(openedUrl.startsWith('https://cloud.comfy.org/cloud/login')).toBe(true)
    expect(openedUrl).toContain('desktop_login_code=dlc_test-code')
    expect(openedUrl).not.toContain('installation_id')
    expect(openedUrl).not.toContain('machine-hash-1234')
    expect(h.showCopyLinkBanner).toHaveBeenCalledWith(contents, openedUrl)

    expect(h.createDesktopLoginCode).toHaveBeenCalledWith(
      'https://cloud.comfy.org',
      expect.objectContaining({
        installation_id: 'machine-hash-1234',
        platform: process.platform,
        app_version: '1.2.3'
      }),
      expect.anything()
    )

    expect(h.exchangeDesktopLoginCode).toHaveBeenCalledTimes(2)
    expect(h.signInWithCustomToken).toHaveBeenCalledWith(expect.any(String), 'custom-token-value', {
      signal: expect.any(AbortSignal)
    })
    expect(h.bindSignedInUser).toHaveBeenCalledWith(persistedUser)
    expect(h.capture).toHaveBeenCalledWith('comfy.desktop.identity.login_attributed', {
      via: 'desktop_login_code'
    })
    expect(contents.executeJavaScript).toHaveBeenCalledTimes(1)
    expect(parentWindow.restore).toHaveBeenCalled()
    expect(parentWindow.show).toHaveBeenCalled()
    expect(parentWindow.focus).toHaveBeenCalled()
    expect(h.emit).not.toHaveBeenCalled()
    expect(h.runBannerCleanup).toHaveBeenCalled()
    // A stale legacy loopback bridge is torn down before the flow starts.
    expect(h.closeActiveBridge).toHaveBeenCalledTimes(1)
  })

  it('continues through the banner when the initial browser open rejects', async () => {
    h.openExternal.mockRejectedValueOnce(new Error('no default browser'))
    h.createDesktopLoginCode.mockResolvedValue(GRANT)
    h.exchangeDesktopLoginCode.mockResolvedValue({
      status: 'complete',
      custom_token: 'custom-token-value'
    })
    mockSignInChain({ uid: 'uid-1' })
    const mod = await loadOrchestrator()

    const promise = mod.signInViaDesktopLoginCode(AUTH_URL, fakeContents(), {})
    await vi.runAllTimersAsync()

    expect(await promise).toBe('handled')
    expect(h.showCopyLinkBanner).toHaveBeenCalledOnce()
    expect(h.emit).not.toHaveBeenCalled()
  })

  it.each([
    'https://dreamboothy.firebaseapp.com/__/auth/handler',
    'https://dreamboothy.firebaseapp.com/__/auth/handler?providerId=microsoft.com'
  ])('deliberately routes %s through the provider-neutral Cloud login page', async (authUrl) => {
    h.createDesktopLoginCode.mockResolvedValue(GRANT)
    h.exchangeDesktopLoginCode.mockResolvedValue({
      status: 'complete',
      custom_token: 'custom-token-value'
    })
    mockSignInChain({ uid: 'uid-1' })
    const mod = await loadOrchestrator()

    const promise = mod.signInViaDesktopLoginCode(authUrl, fakeContents(), {})
    await vi.runAllTimersAsync()

    expect(await promise).toBe('handled')
    expect(h.capture).toHaveBeenCalledWith('comfy.desktop.auth.sign_in_started', {
      provider: 'cloud',
      flow: 'desktop_login_code'
    })
  })

  it('uses production Cloud for a prod sign-in opened from a local ComfyUI view', async () => {
    h.createDesktopLoginCode.mockResolvedValue(GRANT)
    h.exchangeDesktopLoginCode.mockResolvedValue({
      status: 'complete',
      custom_token: 'custom-token-value'
    })
    mockSignInChain({ uid: 'uid-1' })
    const mod = await loadOrchestrator()

    const promise = mod.signInViaDesktopLoginCode(
      AUTH_URL,
      fakeContents('http://127.0.0.1:8188/'),
      {}
    )
    await vi.runAllTimersAsync()

    expect(await promise).toBe('handled')
    expect(h.createDesktopLoginCode).toHaveBeenCalledWith(
      'https://cloud.comfy.org',
      expect.anything(),
      expect.anything()
    )
    expect(h.openExternal.mock.calls[0]![0]).toMatch(/^https:\/\/cloud\.comfy\.org\/cloud\/login/)
  })

  it('omits installation_id when telemetry consent is off or undecided', async () => {
    for (const consent of [false, undefined]) {
      h.settingsGet.mockReturnValue(consent)
      h.createDesktopLoginCode.mockResolvedValue(GRANT)
      h.exchangeDesktopLoginCode.mockResolvedValue({
        status: 'complete',
        custom_token: 'custom-token-value'
      })
      mockSignInChain({ uid: 'uid-1' })
      const mod = await loadOrchestrator()

      const promise = mod.signInViaDesktopLoginCode(AUTH_URL, fakeContents(), {})
      await vi.runAllTimersAsync()
      await promise

      const request = h.createDesktopLoginCode.mock.lastCall![1] as Record<string, unknown>
      expect(request).not.toHaveProperty('installation_id')
      expect(h.getDeviceId).not.toHaveBeenCalled()
    }
  })

  it('keeps polling through retryable exchange errors', async () => {
    const { DesktopLoginCodeError } = await import('./client')
    h.settingsGet.mockReturnValue(true)
    h.createDesktopLoginCode.mockResolvedValue(GRANT)
    h.exchangeDesktopLoginCode
      .mockRejectedValueOnce(new DesktopLoginCodeError('server hiccup', { retryable: true }))
      .mockResolvedValueOnce({ status: 'complete', custom_token: 'custom-token-value' })
    mockSignInChain({ uid: 'uid-1' })
    const mod = await loadOrchestrator()

    const promise = mod.signInViaDesktopLoginCode(AUTH_URL, fakeContents(), {})
    await vi.runAllTimersAsync()

    expect(await promise).toBe('handled')
    expect(h.exchangeDesktopLoginCode).toHaveBeenCalledTimes(2)
    expect(h.bindSignedInUser).toHaveBeenCalled()
    expect(h.emit).not.toHaveBeenCalled()
  })

  it('fails in place on a terminal exchange error — no legacy restart after the browser opened', async () => {
    const { DesktopLoginCodeError } = await import('./client')
    h.settingsGet.mockReturnValue(true)
    h.createDesktopLoginCode.mockResolvedValue(GRANT)
    h.exchangeDesktopLoginCode.mockRejectedValue(
      new DesktopLoginCodeError('desktop login code exchange failed: 403', { status: 403 })
    )
    const onError = vi.fn()
    const mod = await loadOrchestrator()

    const promise = mod.signInViaDesktopLoginCode(AUTH_URL, fakeContents(), { onError })
    await vi.runAllTimersAsync()

    expect(await promise).toBe('handled')
    expect(h.emit).toHaveBeenCalledWith(
      'comfy.desktop.auth.sign_in_failed',
      {
        provider: 'google.com',
        error_class: 'DesktopLoginCodeError',
        error_bucket: 'bucketed',
        flow: 'desktop_login_code',
        retried_poll_errors: 0
      }
    )
    expect(onError).toHaveBeenCalledWith({
      provider: 'google.com',
      error_class: 'DesktopLoginCodeError',
      error_bucket: 'bucketed',
      flow: 'desktop_login_code',
      retried_poll_errors: 0
    })
    expect(h.bindSignedInUser).not.toHaveBeenCalled()
  })

  it('gives up at the expiry deadline with a sign_in_failed event', async () => {
    h.settingsGet.mockReturnValue(true)
    h.createDesktopLoginCode.mockResolvedValue({
      code: 'dlc_x',
      expires_in: 7,
      poll_interval: 3
    })
    h.exchangeDesktopLoginCode.mockResolvedValue({ status: 'pending' })
    const onError = vi.fn()
    const mod = await loadOrchestrator()

    const promise = mod.signInViaDesktopLoginCode(AUTH_URL, fakeContents(), { onError })
    await vi.runAllTimersAsync()

    expect(await promise).toBe('handled')
    // Polls at t=3s and t=6s; the t=9s wake-up is past the 7s deadline
    // but still makes one final exchange attempt before giving up.
    expect(h.exchangeDesktopLoginCode).toHaveBeenCalledTimes(3)
    expect(h.emit).toHaveBeenCalledWith(
      'comfy.desktop.auth.sign_in_failed',
      expect.objectContaining({ flow: 'desktop_login_code' })
    )
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'google.com',
        error_class: 'unknown',
        flow: 'desktop_login_code'
      })
    )
  })

  it('honors a redeem that landed in the last poll interval via a final exchange at the deadline', async () => {
    h.settingsGet.mockReturnValue(true)
    h.createDesktopLoginCode.mockResolvedValue({
      code: 'dlc_x',
      expires_in: 7,
      poll_interval: 3
    })
    h.exchangeDesktopLoginCode
      .mockResolvedValueOnce({ status: 'pending' })
      .mockResolvedValueOnce({ status: 'pending' })
      // t=9s: past the 7s deadline, but the backend's 120s post-redeem
      // window still honors the exchange.
      .mockResolvedValueOnce({ status: 'complete', custom_token: 'late-token' })
    mockSignInChain({ uid: 'uid-1' })
    const mod = await loadOrchestrator()

    const promise = mod.signInViaDesktopLoginCode(AUTH_URL, fakeContents(), {})
    await vi.runAllTimersAsync()

    expect(await promise).toBe('handled')
    expect(h.exchangeDesktopLoginCode).toHaveBeenCalledTimes(3)
    expect(h.signInWithCustomToken).toHaveBeenCalledWith(expect.any(String), 'late-token', {
      signal: expect.any(AbortSignal)
    })
    expect(h.bindSignedInUser).toHaveBeenCalled()
    expect(h.emit).not.toHaveBeenCalled()
  })

  it('retries a transient mint failure after redemption at the original deadline', async () => {
    const { DesktopLoginCodeError } = await import('./client')
    h.createDesktopLoginCode.mockResolvedValue({
      code: 'dlc_x',
      expires_in: 7,
      poll_interval: 3
    })
    h.exchangeDesktopLoginCode
      .mockResolvedValueOnce({ status: 'pending' })
      .mockResolvedValueOnce({ status: 'pending' })
      .mockRejectedValueOnce(new DesktopLoginCodeError('mint unavailable', { retryable: true }))
      .mockResolvedValueOnce({ status: 'complete', custom_token: 'late-token' })
    mockSignInChain({ uid: 'uid-1' })
    const mod = await loadOrchestrator()

    const promise = mod.signInViaDesktopLoginCode(AUTH_URL, fakeContents(), {})
    await vi.runAllTimersAsync()

    expect(await promise).toBe('handled')
    expect(h.exchangeDesktopLoginCode).toHaveBeenCalledTimes(4)
    expect(h.signInWithCustomToken).toHaveBeenCalledWith(expect.any(String), 'late-token', {
      signal: expect.any(AbortSignal)
    })
  })

  it('aborts the prior poll loop on re-entry without reporting a failure', async () => {
    h.settingsGet.mockReturnValue(true)
    h.createDesktopLoginCode.mockResolvedValue(GRANT)
    h.exchangeDesktopLoginCode.mockResolvedValue({ status: 'pending' })
    const mod = await loadOrchestrator()

    const first = mod.signInViaDesktopLoginCode(AUTH_URL, fakeContents(), {})
    await vi.advanceTimersByTimeAsync(3500)
    expect(h.exchangeDesktopLoginCode).toHaveBeenCalledTimes(1)

    // Second click: the new attempt cancels the stale poll loop. Its own
    // create fails fast so the test doesn't leave a flow in flight.
    h.createDesktopLoginCode.mockRejectedValueOnce(new Error('create failed'))
    const second = mod.signInViaDesktopLoginCode(AUTH_URL, fakeContents(), {})

    expect(await first).toBe('handled')
    expect(await second).toBe('fallback')
    // A superseded attempt is not a failure.
    expect(h.emit).not.toHaveBeenCalled()

    // The stale loop is dead: no further polls happen.
    await vi.advanceTimersByTimeAsync(30_000)
    expect(h.exchangeDesktopLoginCode).toHaveBeenCalledTimes(1)
  })

  it('cancels a prior code flow before falling back to the legacy bridge', async () => {
    h.settingsGet.mockReturnValue(true)
    h.createDesktopLoginCode.mockResolvedValue(GRANT)
    h.exchangeDesktopLoginCode.mockResolvedValue({ status: 'pending' })
    const mod = await loadOrchestrator()

    const first = mod.signInViaDesktopLoginCode(AUTH_URL, fakeContents(), {})
    await vi.advanceTimersByTimeAsync(3500)
    expect(h.exchangeDesktopLoginCode).toHaveBeenCalledTimes(1)

    const fallback = await mod.signInViaDesktopLoginCode(
      'https://dreamboothy-dev.firebaseapp.com/__/auth/handler?providerId=google.com',
      fakeContents('https://cloud.comfy.org/'),
      {}
    )

    expect(fallback).toBe('fallback')
    expect(await first).toBe('handled')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(h.exchangeDesktopLoginCode).toHaveBeenCalledTimes(1)
    expect(h.emit).not.toHaveBeenCalled()
  })

  it('performs no tail side-effects when superseded after the exchange completed', async () => {
    h.settingsGet.mockReturnValue(true)
    h.createDesktopLoginCode.mockResolvedValue(GRANT)
    h.exchangeDesktopLoginCode.mockResolvedValue({
      status: 'complete',
      custom_token: 'token-a'
    })
    // Park flow A inside the tail, on the custom-token sign-in.
    let resolveSignIn!: (value: unknown) => void
    h.signInWithCustomToken.mockImplementation(
      () => new Promise((resolve) => (resolveSignIn = resolve))
    )
    const mod = await loadOrchestrator()
    const contents = fakeContents()
    const parentWindow = {
      isDestroyed: vi.fn(() => false),
      isMinimized: vi.fn(() => false),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn()
    }

    const first = mod.signInViaDesktopLoginCode(AUTH_URL, contents, {
      parentWindow: parentWindow as unknown as BrowserWindow
    })
    await vi.advanceTimersByTimeAsync(3000)
    expect(h.signInWithCustomToken).toHaveBeenCalledTimes(1)

    // Re-click while A is mid-tail: B aborts A, then fails create fast so
    // the test doesn't leave a second flow in flight.
    h.createDesktopLoginCode.mockRejectedValueOnce(new Error('create failed'))
    const second = mod.signInViaDesktopLoginCode(AUTH_URL, contents, {})
    const bannerCleanupsAfterSecondStart = h.runBannerCleanup.mock.calls.length

    resolveSignIn({ idToken: 'id-token', refreshToken: 'refresh-token', expiresIn: '3600' })
    expect(await first).toBe('handled')
    expect(await second).toBe('fallback')

    // The superseded flow ran none of its tail: no lookup, no identity
    // bind/attribution, no inject, no focus steal...
    expect(h.lookupAccount).not.toHaveBeenCalled()
    expect(h.bindSignedInUser).not.toHaveBeenCalled()
    expect(h.capture).not.toHaveBeenCalledWith(
      'comfy.desktop.identity.login_attributed',
      expect.anything()
    )
    expect(contents.executeJavaScript).not.toHaveBeenCalled()
    expect(parentWindow.focus).not.toHaveBeenCalled()
    // ...and did not tear down the newer flow's banner on the way out.
    expect(h.runBannerCleanup).toHaveBeenCalledTimes(bannerCleanupsAfterSecondStart)
    // A superseded attempt is not a failure.
    expect(h.emit).not.toHaveBeenCalled()
  })

  it('falls back immediately for a dev-project auth URL on the production Cloud origin', async () => {
    const mod = await loadOrchestrator()

    const outcome = await mod.signInViaDesktopLoginCode(
      'https://dreamboothy-dev.firebaseapp.com/__/auth/handler?providerId=google.com',
      fakeContents('https://cloud.comfy.org/'),
      {}
    )

    // The prod backend would mint a prod custom token the dev Firebase
    // project rejects — the legacy bridge owns dev sign-ins.
    expect(outcome).toBe('fallback')
    expect(h.createDesktopLoginCode).not.toHaveBeenCalled()
    expect(h.openExternal).not.toHaveBeenCalled()
    // The legacy path emits its own sign_in_started.
    expect(h.capture).not.toHaveBeenCalled()
  })

  it('runs the code flow for a dev-project auth URL when the view is on a loopback dev origin', async () => {
    h.settingsGet.mockReturnValue(true)
    h.createDesktopLoginCode.mockResolvedValue(GRANT)
    h.exchangeDesktopLoginCode.mockResolvedValue({
      status: 'complete',
      custom_token: 'custom-token-value'
    })
    mockSignInChain({ uid: 'uid-1' })
    const mod = await loadOrchestrator()

    const promise = mod.signInViaDesktopLoginCode(
      'https://dreamboothy-dev.firebaseapp.com/__/auth/handler?providerId=google.com',
      fakeContents('http://localhost:5173/'),
      {}
    )
    await vi.runAllTimersAsync()

    expect(await promise).toBe('handled')
    expect(h.createDesktopLoginCode).toHaveBeenCalledWith(
      'http://localhost:5173',
      expect.anything(),
      expect.anything()
    )
  })

  it('does not trust a loopback dev origin in a packaged build', async () => {
    h.appIsPackaged = true
    const mod = await loadOrchestrator()

    const outcome = await mod.signInViaDesktopLoginCode(
      'https://dreamboothy-dev.firebaseapp.com/__/auth/handler?providerId=google.com',
      fakeContents('http://localhost:5173/'),
      {}
    )

    expect(outcome).toBe('fallback')
    expect(h.createDesktopLoginCode).not.toHaveBeenCalled()
  })
})
