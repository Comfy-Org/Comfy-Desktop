import { Buffer } from 'node:buffer'
import type { WebContents } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DesktopIdentity } from './index'
import type { CloudViewAuthState, DesktopSessionMarker } from './pageState'
import { DESKTOP_SESSION_MARKER_KEY, serializeMarker } from './pageState'

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
const { preemptPartitionCleanup } = await import('../firebaseBridge/partitionCoordinator')

const CLOUD_URL = 'https://cloud.comfy.org/cloud'

function jwt(claims: Record<string, unknown>): string {
  const encode = (value: unknown): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none' })}.${encode(claims)}.sig`
}

const WEB_SESSION_TOKEN = jwt({
  sub: 'desktop-sub',
  scope: 'comfy-cloud:user:read comfy-cloud:web-session:mint'
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
  markers: () => (string | null)[]
}

interface PageState {
  uid: string | null
  marker: string | null
}

function runMarkerWrite(script: string, state: PageState, url: string): unknown {
  const localStorage = {
    getItem: (key: string) => (key === DESKTOP_SESSION_MARKER_KEY ? state.marker : null),
    setItem: (key: string, value: string) => {
      if (key === DESKTOP_SESSION_MARKER_KEY) state.marker = value
    },
    removeItem: (key: string) => {
      if (key === DESKTOP_SESSION_MARKER_KEY) state.marker = null
    }
  }
  const page = new Function('location', 'localStorage', `return ${script}`) as (
    location: { origin: string },
    storage: typeof localStorage
  ) => unknown
  return page({ origin: new URL(url).origin }, localStorage)
}

interface FakeViewOptions {
  url?: string
  partition?: object
  remove?: (script: string) => Promise<unknown>
  read?: () => Promise<unknown>
}

function fakeView(state: PageState, options: FakeViewOptions | string = {}): FakeView {
  const {
    url = CLOUD_URL,
    partition = {},
    remove,
    read
  } = typeof options === 'string' ? { url: options } : options
  const markers: (string | null)[] = []
  const executeJavaScript = vi.fn((script: string) => {
    if (script.includes('held.controller.abort')) return Promise.resolve(true)
    if (script.includes('expectedUid'))
      return remove ? remove(script) : Promise.resolve('signed_out')
    if (script.includes('indexedDB.databases')) {
      const snapshot = { ...state }
      return read ? read().then(() => snapshot) : Promise.resolve(snapshot)
    }
    const written = runMarkerWrite(script, state, url)
    markers.push(state.marker)
    return Promise.resolve(written)
  })
  const contents = {
    isDestroyed: () => false,
    getURL: () => url,
    session: partition,
    executeJavaScript
  } as unknown as WebContents
  return {
    contents,
    executeJavaScript,
    scripts: () => executeJavaScript.mock.calls.map(([script]) => script as string),
    markers: () => [...markers]
  }
}

function deferred<T = unknown>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function reads(view: FakeView): string[] {
  return view
    .scripts()
    .filter((script) => script.includes('indexedDB.databases') && !script.includes('expectedUid'))
}

function removals(view: FakeView): string[] {
  return view.scripts().filter((script) => script.includes('expectedUid'))
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
  h.injectFirebaseSession.mockResolvedValue('injected')
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
      'keeps the session it added under a new Desktop sign-in to the same account',
      { uid: 'desktop-uid', marker: marker() },
      { signedIn: true, sub: 'desktop-sub', fam: 'fam-2' },
      { kind: 'write_marker', marker: marker({ fam: 'fam-2' }) }
    ],
    [
      "remembers that the person swapped Desktop's account for their own",
      { uid: 'person', marker: marker() },
      signedIn,
      { kind: 'write_marker', marker: marker({ state: 'declined' }) }
    ],
    [
      'drops the marker of an earlier Desktop sign-in while the person uses their own account',
      { uid: 'person', marker: marker({ state: 'declined' }) },
      { signedIn: true, sub: 'desktop-sub', fam: 'fam-2' },
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
    h.injectFirebaseSession.mockResolvedValue('kept')

    await reconcileCloudViewSession(fakeView({ uid: null, marker: null }).contents)

    expect(h.bindSignedInUser).not.toHaveBeenCalled()
    expect(outcomes()).toEqual([{ outcome: 'kept_existing' }])
  })

  it('reports a sign-in it abandoned because the marker could not be saved', async () => {
    h.injectFirebaseSession.mockResolvedValue('marker_unsaved')

    await reconcileCloudViewSession(fakeView({ uid: null, marker: null }).contents)

    expect(h.bindSignedInUser).not.toHaveBeenCalled()
    expect(outcomes()).toEqual([{ outcome: 'marker_unsaved' }])
  })

  it('does not ask Cloud when the Desktop grant lacks the web-session scope', async () => {
    h.session.accessToken = READ_ONLY_TOKEN

    await reconcileCloudViewSession(fakeView({ uid: null, marker: null }).contents)

    expect(h.requestWebSessionToken).not.toHaveBeenCalled()
    expect(outcomes()).toEqual([{ outcome: 'scope_missing' }])
  })

  it('reports a grant without the web-session scope once, not on every page load', async () => {
    h.session.accessToken = READ_ONLY_TOKEN
    h.session.fam = 'fam-reported-once'

    await reconcileCloudViewSession(fakeView({ uid: null, marker: null }).contents)
    await reconcileCloudViewSession(fakeView({ uid: null, marker: null }).contents)
    expect(outcomes()).toEqual([{ outcome: 'scope_missing' }])

    h.session.fam = 'fam-after-sign-in'
    await reconcileCloudViewSession(fakeView({ uid: null, marker: null }).contents)
    expect(outcomes()).toEqual([{ outcome: 'scope_missing' }, { outcome: 'scope_missing' }])
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

  it.each(['web_session_unavailable', 'credential_unsupported', 'oauth_grant_ended'])(
    'reports the Cloud refusal %s by name',
    async (code) => {
      h.requestWebSessionToken.mockResolvedValue({ kind: 'declined', status: 403, code })

      await reconcileCloudViewSession(fakeView({ uid: null, marker: null }).contents)

      expect(outcomes()).toEqual([
        { outcome: 'declined', reason: 'http', http_status: 403, error_code: code }
      ])
    }
  )

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

  it('keeps the view signed out when the person signs out after Desktop signed out and back in while the view was closed', async () => {
    h.session.fam = 'fam-2'
    const state: PageState = { uid: 'desktop-uid', marker: serializeMarker(marker()) }
    const view = fakeView(state)
    await reconcileCloudViewSession(view.contents)

    state.uid = null
    await reconcileCloudViewSession(view.contents)

    expect(h.requestWebSessionToken).not.toHaveBeenCalled()
    expect(h.injectFirebaseSession).not.toHaveBeenCalled()
    expect(view.markers()).toEqual([
      serializeMarker(marker({ fam: 'fam-2' })),
      serializeMarker(marker({ fam: 'fam-2', state: 'declined' }))
    ])
  })

  it("keeps the view signed out when the person swaps Desktop's account for their own and then signs out", async () => {
    const state: PageState = { uid: 'person', marker: serializeMarker(marker()) }
    const view = fakeView(state)
    await reconcileCloudViewSession(view.contents)

    state.uid = null
    await reconcileCloudViewSession(view.contents)

    expect(h.requestWebSessionToken).not.toHaveBeenCalled()
    expect(h.injectFirebaseSession).not.toHaveBeenCalled()
    expect(state.marker).toBe(serializeMarker(marker({ state: 'declined' })))
  })

  it('signs the view in again once Desktop signs in again after the person swapped accounts and signed out', async () => {
    const state: PageState = { uid: 'person', marker: serializeMarker(marker()) }
    const view = fakeView(state)
    await reconcileCloudViewSession(view.contents)
    state.uid = null

    h.session.fam = 'fam-2'
    await reconcileCloudViewSession(view.contents)

    expect(h.requestWebSessionToken).toHaveBeenCalledTimes(1)
    expect(outcomes()).toEqual([{ outcome: 'signed_in' }])
  })

  it('removes the session it added once Desktop signs out', async () => {
    h.session.signedIn = false
    const view = fakeView({ uid: 'desktop-uid', marker: serializeMarker(marker()) })

    await reconcileCloudViewSession(view.contents)

    const removal = view.scripts().find((script) => script.includes('expectedUid'))
    expect(removal).toContain('"desktop-uid"')
    expect(removal).toContain(JSON.stringify(serializeMarker(marker())))
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

    expect(reads(view)).toHaveLength(2)
  })
})

describe('reconcileCloudViewSession across views on one partition', () => {
  it('lets a second view read only after the first finished signing out', async () => {
    h.session.signedIn = false
    const partition = {}
    const removal = deferred()
    const first = fakeView(
      { uid: 'desktop-uid', marker: serializeMarker(marker()) },
      { partition, remove: () => removal.promise }
    )
    const second = fakeView({ uid: null, marker: null }, { partition })

    const firstRun = reconcileCloudViewSession(first.contents)
    await vi.waitFor(() => expect(removals(first)).toHaveLength(1))
    const secondRun = reconcileCloudViewSession(second.contents)
    await Promise.resolve()
    expect(reads(second)).toHaveLength(0)

    removal.resolve('signed_out')
    await firstRun
    await secondRun
    expect(reads(second)).toHaveLength(1)
  })

  it('cancels a running cleanup when the person signs in, then decides again from what the page holds', async () => {
    h.session.signedIn = false
    const state: PageState = { uid: 'desktop-uid', marker: serializeMarker(marker()) }
    const removal = deferred()
    const view = fakeView(state, { remove: () => removal.promise })

    const run = reconcileCloudViewSession(view.contents)
    await vi.waitFor(() => expect(removals(view)).toHaveLength(1))
    const token = /const cleanupToken = "([^"]+)"/.exec(removals(view)[0]!)?.[1]

    preemptPartitionCleanup(view.contents)
    expect(view.scripts().at(-1)).toContain(`"${token}"`)
    state.uid = 'person'
    state.marker = serializeMarker(marker({ state: 'declined' }))
    removal.resolve('superseded')
    await run

    expect(reads(view)).toHaveLength(2)
    expect(removals(view)).toHaveLength(1)
    expect(outcomes()).toEqual([])
  })

  it('never starts a cleanup the person preempted while the view was being read', async () => {
    h.session.signedIn = false
    const state: PageState = { uid: 'desktop-uid', marker: serializeMarker(marker()) }
    const read = deferred()
    let firstRead = true
    const view = fakeView(state, {
      read: () => {
        if (!firstRead) return Promise.resolve()
        firstRead = false
        return read.promise
      }
    })

    const run = reconcileCloudViewSession(view.contents)
    await vi.waitFor(() => expect(reads(view)).toHaveLength(1))
    preemptPartitionCleanup(view.contents)
    state.uid = 'person'
    state.marker = serializeMarker(marker({ state: 'declined' }))
    read.resolve(undefined)
    await run

    expect(removals(view)).toHaveLength(0)
    expect(reads(view)).toHaveLength(2)
  })

  it('gives up retrying a cleanup that keeps being superseded', async () => {
    h.session.signedIn = false
    const view = fakeView(
      { uid: 'desktop-uid', marker: serializeMarker(marker()) },
      { remove: () => Promise.resolve('superseded') }
    )

    await reconcileCloudViewSession(view.contents)

    expect(removals(view)).toHaveLength(4)
  })

  it('asks Cloud for one web session when two views on the partition load at once', async () => {
    const partition = {}
    const exchange = deferred()
    h.requestWebSessionToken.mockReturnValue(exchange.promise)
    const first = fakeView({ uid: null, marker: null }, { partition })
    const second = fakeView({ uid: null, marker: null }, { partition })

    const runs = [
      reconcileCloudViewSession(first.contents),
      reconcileCloudViewSession(second.contents)
    ]
    await vi.waitFor(() => expect(reads(second)).toHaveLength(1))
    exchange.resolve({ kind: 'minted', customToken: 'custom-token' })
    await Promise.all(runs)

    expect(h.requestWebSessionToken).toHaveBeenCalledTimes(1)
    expect(h.injectFirebaseSession).toHaveBeenCalledTimes(1)
  })

  it('signs in views on separate partitions independently', async () => {
    await Promise.all([
      reconcileCloudViewSession(fakeView({ uid: null, marker: null }).contents),
      reconcileCloudViewSession(fakeView({ uid: null, marker: null }).contents)
    ])

    expect(h.requestWebSessionToken).toHaveBeenCalledTimes(2)
  })
})
