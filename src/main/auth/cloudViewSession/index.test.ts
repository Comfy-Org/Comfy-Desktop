import { Buffer } from 'node:buffer'
import type { WebContents } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DesktopIdentity } from './index'
import type { CloudViewAuthState, DesktopSessionMarker } from './pageState'
import { serializeMarker } from './pageState'

const h = vi.hoisted(() => ({
  session: {
    signedIn: true,
    sub: 'desktop-sub' as string | null,
    fam: 'fam-1' as string | null,
    generation: 1,
    accessToken: '' as string | null
  },
  emit: vi.fn(),
  requestWebSessionToken: vi.fn(),
  signInWithCustomToken: vi.fn(),
  lookupAccount: vi.fn(),
  buildPersistedUserFromCustomToken: vi.fn(),
  beginFirebaseSessionInjection: vi.fn(() => ({ token: 'injection' })),
  injectFirebaseSession: vi.fn(),
  releaseFirebaseSessionInjection: vi.fn(),
  hasActiveFirebaseSessionInjection: vi.fn(() => false),
  bindSignedInUser: vi.fn(),
  keepsTokensInOsKeychain: vi.fn(() => true)
}))

vi.mock('electron', () => ({ net: { fetch: vi.fn() } }))

vi.mock('../../devplatform/session', () => ({
  getCloudSession: () => ({
    isSignedIn: () => h.session.signedIn,
    currentSubject: () => (h.session.signedIn ? h.session.sub : null),
    currentGrantFamily: () => (h.session.signedIn ? h.session.fam : null),
    currentAuthGeneration: () => h.session.generation,
    getGrantAccessToken: () => Promise.resolve(h.session.accessToken)
  })
}))

vi.mock('../../lib/telemetry', () => ({
  emit: h.emit,
  bucketError: () => 'bucketed'
}))

vi.mock('./client', () => ({ requestWebSessionToken: h.requestWebSessionToken }))

vi.mock('./storageStrength', () => ({ keepsTokensInOsKeychain: h.keepsTokensInOsKeychain }))

vi.mock('../desktopLoginCode/customTokenSignIn', () => ({
  signInWithCustomToken: h.signInWithCustomToken,
  lookupAccount: h.lookupAccount,
  buildPersistedUserFromCustomToken: h.buildPersistedUserFromCustomToken
}))

vi.mock('../firebaseBridge/inject', () => ({
  beginFirebaseSessionInjection: h.beginFirebaseSessionInjection,
  injectFirebaseSession: h.injectFirebaseSession,
  releaseFirebaseSessionInjection: h.releaseFirebaseSessionInjection,
  hasActiveFirebaseSessionInjection: h.hasActiveFirebaseSessionInjection
}))

vi.mock('../firebaseBridge/flowShared', () => ({ bindSignedInUser: h.bindSignedInUser }))

const { CLOUD_VIEW_SESSION_EVENT, decideCloudViewSession, reconcileCloudViewSession } =
  await import('./index')

const CLOUD_URL = 'https://cloud.comfy.org/cloud'

function jwt(claims: Record<string, unknown>): string {
  const encode = (value: unknown): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none' })}.${encode(claims)}.sig`
}

const WEB_SESSION_TOKEN = jwt({
  sub: 'desktop-sub',
  scope: 'comfy-cloud:user:read comfy-cloud:web-session'
})
const READ_ONLY_TOKEN = jwt({ sub: 'desktop-sub', scope: 'comfy-cloud:user:read' })

function marker(overrides: Partial<DesktopSessionMarker> = {}): DesktopSessionMarker {
  return {
    v: 1,
    uid: 'desktop-uid',
    sub: 'desktop-sub',
    fam: 'fam-1',
    state: 'active',
    ...overrides
  }
}

interface FakeView {
  contents: WebContents
  executeJavaScript: ReturnType<typeof vi.fn>
  scripts: () => string[]
}

function fakeView(state: { uid: string | null; marker: string | null }, url = CLOUD_URL): FakeView {
  const executeJavaScript = vi.fn((script: string) => {
    if (script.includes('indexedDB.databases')) return Promise.resolve(state)
    if (script.includes('expectedUid')) return Promise.resolve(true)
    return Promise.resolve(true)
  })
  const contents = {
    isDestroyed: () => false,
    getURL: () => url,
    executeJavaScript
  } as unknown as WebContents
  return {
    contents,
    executeJavaScript,
    scripts: () => executeJavaScript.mock.calls.map(([script]) => script as string)
  }
}

function outcomes(): unknown[] {
  return h.emit.mock.calls
    .filter(([event]) => event === CLOUD_VIEW_SESSION_EVENT)
    .map(([, context]) => context)
}

beforeEach(() => {
  vi.clearAllMocks()
  h.session.signedIn = true
  h.session.sub = 'desktop-sub'
  h.session.fam = 'fam-1'
  h.session.generation = 1
  h.session.accessToken = WEB_SESSION_TOKEN
  h.requestWebSessionToken.mockResolvedValue({ kind: 'minted', customToken: 'custom-token' })
  h.signInWithCustomToken.mockResolvedValue({
    idToken: 'id',
    refreshToken: 'rt',
    expiresIn: '3600'
  })
  h.lookupAccount.mockResolvedValue({ localId: 'desktop-uid' })
  h.buildPersistedUserFromCustomToken.mockReturnValue({ uid: 'desktop-uid' })
  h.injectFirebaseSession.mockResolvedValue(true)
  h.hasActiveFirebaseSessionInjection.mockReturnValue(false)
  h.keepsTokensInOsKeychain.mockReturnValue(true)
})

describe('decideCloudViewSession', () => {
  const signedIn: DesktopIdentity = { signedIn: true, sub: 'desktop-sub', fam: 'fam-1' }
  const signedOut: DesktopIdentity = { signedIn: false }
  const cases: [string, CloudViewAuthState, DesktopIdentity, unknown][] = [
    ['signs an empty view in', { uid: null, marker: null }, signedIn, { kind: 'sign_in' }],
    [
      'leaves an empty view alone when Desktop is signed out',
      { uid: null, marker: null },
      signedOut,
      { kind: 'none' }
    ],
    ["keeps the person's own session", { uid: 'person', marker: null }, signedIn, { kind: 'none' }],
    [
      "keeps the person's own session after Desktop signs out",
      { uid: 'person', marker: null },
      signedOut,
      { kind: 'none' }
    ],
    [
      'keeps the session Desktop added while Desktop stays signed in',
      { uid: 'desktop-uid', marker: marker() },
      signedIn,
      { kind: 'none' }
    ],
    [
      'removes the session Desktop added once Desktop signs out',
      { uid: 'desktop-uid', marker: marker() },
      signedOut,
      { kind: 'sign_out', uid: 'desktop-uid' }
    ],
    [
      'removes the session Desktop added once Desktop is another user',
      { uid: 'desktop-uid', marker: marker() },
      { signedIn: true, sub: 'other-sub', fam: 'fam-2' },
      { kind: 'sign_out', uid: 'desktop-uid' }
    ],
    [
      'drops a marker left by an account the person switched away from',
      { uid: 'person', marker: marker() },
      signedIn,
      { kind: 'write_marker', marker: null }
    ],
    [
      'remembers that the person signed out of the view',
      { uid: null, marker: marker() },
      signedIn,
      { kind: 'write_marker', marker: marker({ state: 'declined' }) }
    ],
    [
      'stays out after the person signed out of the view',
      { uid: null, marker: marker({ state: 'declined' }) },
      signedIn,
      { kind: 'none' }
    ],
    [
      'signs in again after a new Desktop sign-in',
      { uid: null, marker: marker({ state: 'declined' }) },
      { signedIn: true, sub: 'desktop-sub', fam: 'fam-2' },
      { kind: 'sign_in' }
    ],
    [
      'clears the marker once Desktop signs out',
      { uid: null, marker: marker({ state: 'declined' }) },
      signedOut,
      { kind: 'write_marker', marker: null }
    ]
  ]

  it.each(cases)('%s', (_name, state, desktop, expected) => {
    expect(decideCloudViewSession(state, desktop)).toEqual(expected)
  })
})

describe('reconcileCloudViewSession', () => {
  it('signs a signed-out Cloud view in without replacing anything', async () => {
    const view = fakeView({ uid: null, marker: null })

    await reconcileCloudViewSession(view.contents)

    expect(h.requestWebSessionToken).toHaveBeenCalledWith(WEB_SESSION_TOKEN)
    expect(h.injectFirebaseSession).toHaveBeenCalledTimes(1)
    const [, origin, user, , options] = h.injectFirebaseSession.mock.calls[0] as unknown[]
    expect(origin).toBe('https://cloud.comfy.org')
    expect(user).toEqual({ uid: 'desktop-uid' })
    expect(options).toEqual({
      onlyIfSignedOut: true,
      marker: { key: '__comfyDesktopCloudViewSession', value: serializeMarker(marker()) }
    })
    expect(h.releaseFirebaseSessionInjection).toHaveBeenCalledTimes(1)
    expect(h.bindSignedInUser).toHaveBeenCalledWith({ uid: 'desktop-uid' }, view.contents, {
      via: 'desktop_web_session'
    })
    expect(outcomes()).toEqual([{ outcome: 'signed_in' }])
  })

  it('reports a view that gained its own session in the meantime', async () => {
    h.injectFirebaseSession.mockResolvedValue(false)

    await reconcileCloudViewSession(fakeView({ uid: null, marker: null }).contents)

    expect(h.bindSignedInUser).not.toHaveBeenCalled()
    expect(outcomes()).toEqual([{ outcome: 'kept_existing' }])
  })

  it('does not ask Cloud when the Desktop grant lacks the web-session scope', async () => {
    h.session.accessToken = READ_ONLY_TOKEN

    await reconcileCloudViewSession(fakeView({ uid: null, marker: null }).contents)

    expect(h.requestWebSessionToken).not.toHaveBeenCalled()
    expect(outcomes()).toEqual([{ outcome: 'scope_missing' }])
  })

  it('does not ask Cloud when Desktop cannot keep its tokens in an OS keychain', async () => {
    h.keepsTokensInOsKeychain.mockReturnValue(false)

    await reconcileCloudViewSession(fakeView({ uid: null, marker: null }).contents)

    expect(h.requestWebSessionToken).not.toHaveBeenCalled()
    expect(outcomes()).toEqual([{ outcome: 'weak_storage' }])
  })

  it('leaves the view signed out when Cloud declines', async () => {
    h.requestWebSessionToken.mockResolvedValue({ kind: 'declined', status: 404 })

    await reconcileCloudViewSession(fakeView({ uid: null, marker: null }).contents)

    expect(h.signInWithCustomToken).not.toHaveBeenCalled()
    expect(h.injectFirebaseSession).not.toHaveBeenCalled()
    expect(outcomes()).toEqual([{ outcome: 'declined', reason: 'http', http_status: 404 }])
  })

  it('reports only known Cloud error codes', async () => {
    h.requestWebSessionToken.mockResolvedValue({
      kind: 'declined',
      status: 403,
      code: 'something_new'
    })

    await reconcileCloudViewSession(fakeView({ uid: null, marker: null }).contents)

    expect(outcomes()).toEqual([
      { outcome: 'declined', reason: 'http', http_status: 403, error_code: 'other' }
    ])
  })

  it('drops the token when Desktop signs out during the exchange', async () => {
    h.requestWebSessionToken.mockImplementation(() => {
      h.session.generation += 1
      h.session.signedIn = false
      return Promise.resolve({ kind: 'minted', customToken: 'custom-token' })
    })

    await reconcileCloudViewSession(fakeView({ uid: null, marker: null }).contents)

    expect(h.signInWithCustomToken).not.toHaveBeenCalled()
    expect(h.injectFirebaseSession).not.toHaveBeenCalled()
  })

  it('waits for a sign-in flow the person started', async () => {
    h.hasActiveFirebaseSessionInjection.mockReturnValue(true)

    await reconcileCloudViewSession(fakeView({ uid: null, marker: null }).contents)

    expect(h.beginFirebaseSessionInjection).not.toHaveBeenCalled()
    expect(h.injectFirebaseSession).not.toHaveBeenCalled()
  })

  it("never contacts Cloud for a view signed in with the person's own account", async () => {
    await reconcileCloudViewSession(fakeView({ uid: 'person', marker: null }).contents)

    expect(h.requestWebSessionToken).not.toHaveBeenCalled()
    expect(h.injectFirebaseSession).not.toHaveBeenCalled()
  })

  it('removes the session it added once Desktop signs out', async () => {
    h.session.signedIn = false
    const view = fakeView({ uid: 'desktop-uid', marker: serializeMarker(marker()) })

    await reconcileCloudViewSession(view.contents)

    const removal = view.scripts().find((script) => script.includes('expectedUid'))
    expect(removal).toContain('"desktop-uid"')
    expect(outcomes()).toEqual([{ outcome: 'signed_out' }])
  })

  it.each([
    ['another site', 'https://example.com/'],
    [
      'a Cloud environment other than the one Desktop signs in to',
      'https://stagingcloud.comfy.org/'
    ]
  ])('does not touch %s', async (_name, url) => {
    const view = fakeView({ uid: null, marker: null }, url)

    await reconcileCloudViewSession(view.contents)

    expect(view.executeJavaScript).not.toHaveBeenCalled()
  })

  it('runs again for a sign-out that lands while a sign-in is still running', async () => {
    let finishExchange: (value: unknown) => void = () => {}
    h.requestWebSessionToken.mockReturnValue(
      new Promise((resolve) => {
        finishExchange = resolve
      })
    )
    const state = { uid: null as string | null, marker: null as string | null }
    const view = fakeView(state)

    const first = reconcileCloudViewSession(view.contents)
    await vi.waitFor(() => expect(h.requestWebSessionToken).toHaveBeenCalled())
    const second = reconcileCloudViewSession(view.contents)
    finishExchange({ kind: 'minted', customToken: 'custom-token' })
    await first
    await second

    const reads = view.scripts().filter((script) => script.includes('indexedDB.databases'))
    expect(reads).toHaveLength(2)
  })
})
