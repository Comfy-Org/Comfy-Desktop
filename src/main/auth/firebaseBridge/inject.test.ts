import { describe, expect, it, vi } from 'vitest'

import {
  beginFirebaseSessionInjection,
  buildIndexedDbInjectScript,
  FIREBASE_SESSION_INJECTION_OWNER_FIELD,
  injectFirebaseSession,
  isFirebaseSessionInjectionRecordOwnedBy,
  releaseFirebaseSessionInjection,
  WEB_SESSION_CREATE_TIMEOUT_MS
} from './inject'
import { runOnPartition, trackPartitionCleanup } from './partitionCoordinator'

const ORIGIN = 'https://cloud.comfy.org'
const OWNER = 'owner-token'
const SAMPLE_USER = {
  uid: 'abc123',
  email: 'user@example.com',
  stsTokenManager: { refreshToken: 'rt', accessToken: 'at', expirationTime: 0 }
}

describe('buildIndexedDbInjectScript', () => {
  it('embeds the user JSON verbatim', () => {
    const script = buildIndexedDbInjectScript(SAMPLE_USER, 'AIzaTEST', ORIGIN, OWNER)
    expect(script).toContain('"uid":"abc123"')
    expect(script).toContain('"refreshToken":"rt"')
  })

  it("uses Firebase's documented IDB schema", () => {
    const script = buildIndexedDbInjectScript(SAMPLE_USER, 'AIzaTEST', ORIGIN, OWNER)
    expect(script).toContain("'firebaseLocalStorageDb'")
    expect(script).toContain("'firebaseLocalStorage'")
    expect(script).toContain('fbase_key')
    expect(script).toContain("firebase:authUser:' + apiKey + ':[DEFAULT]")
  })

  it('reloads the page after the IDB write commits', () => {
    const script = buildIndexedDbInjectScript(SAMPLE_USER, 'AIzaTEST', ORIGIN, OWNER)
    expect(script).toContain('location.reload()')
  })

  it('creates the web session from the new ID token before reloading', () => {
    const script = buildIndexedDbInjectScript(SAMPLE_USER, 'AIzaTEST', ORIGIN, OWNER)
    const create = script.indexOf("fetch('/api/auth/session'")
    expect(create).toBeGreaterThan(script.indexOf('if (!committed || !isCurrent()) return false'))
    expect(create).toBeLessThan(script.indexOf('location.reload()'))
    expect(script).toContain("method: 'POST'")
    expect(script).toContain("credentials: 'include'")
    expect(script).toContain("Authorization: 'Bearer ' + idToken")
    expect(script).toContain('userValue.stsTokenManager.accessToken')
    expect(script).toContain(`AbortSignal.timeout(${WEB_SESSION_CREATE_TIMEOUT_MS})`)
  })

  it('does not reload for a flow superseded while the web session was being created', () => {
    const script = buildIndexedDbInjectScript(SAMPLE_USER, 'AIzaTEST', ORIGIN, OWNER)
    const afterCreate = script.slice(script.indexOf("fetch('/api/auth/session'"))
    expect(afterCreate.indexOf('if (!isCurrent()) return false')).toBeLessThan(
      afterCreate.indexOf('location.reload()')
    )
  })

  it('is parseable as JavaScript', () => {
    const script = buildIndexedDbInjectScript(SAMPLE_USER, 'AIzaTEST', ORIGIN, OWNER)
    expect(() => new Function(script)).not.toThrow()
  })

  it('escapes embedded values to prevent script breakage', () => {
    const tricky = { malicious: '"; alert(1); //' }
    const script = buildIndexedDbInjectScript(tricky, 'AIza', ORIGIN, OWNER)
    expect(() => new Function(script)).not.toThrow()
  })

  it('checks document origin and flow ownership before materializing credentials', () => {
    const script = buildIndexedDbInjectScript(SAMPLE_USER, 'AIzaTEST', ORIGIN, OWNER)
    expect(script.indexOf('if (!isCurrent()) return false')).toBeLessThan(
      script.indexOf('const userValue')
    )
    expect(script).toContain('location.origin === expectedOrigin')
    expect(script).toContain('globalThis[ownerKey] === ownerToken')
    expect(script).toContain('current.result[recordOwnerKey] === ownerToken')
    expect(script).toContain('cleanupStore.delete(storageKey)')
  })

  it('does not let stale cleanup delete a replacement flow record', () => {
    const staleOwner = 'stale-owner'
    const replacementOwner = 'replacement-owner'
    let currentRecord: Record<string, unknown> | null = {
      fbase_key: 'firebase:authUser:key:[DEFAULT]',
      value: { uid: 'old-user' },
      [FIREBASE_SESSION_INJECTION_OWNER_FIELD]: staleOwner
    }
    expect(isFirebaseSessionInjectionRecordOwnedBy(currentRecord, staleOwner)).toBe(true)

    currentRecord = {
      fbase_key: 'firebase:authUser:key:[DEFAULT]',
      value: { uid: 'new-user' },
      [FIREBASE_SESSION_INJECTION_OWNER_FIELD]: replacementOwner
    }
    if (isFirebaseSessionInjectionRecordOwnedBy(currentRecord, staleOwner)) currentRecord = null

    expect(currentRecord).toMatchObject({
      value: { uid: 'new-user' },
      [FIREBASE_SESSION_INJECTION_OWNER_FIELD]: replacementOwner
    })
  })
})

function fakeContents() {
  const frame = {
    executeJavaScript: vi.fn((script: string): Promise<unknown> =>
      Promise.resolve(script.includes('location.reload()') ? true : undefined)
    ),
    isDestroyed: vi.fn(() => false)
  }
  const contents = {
    getURL: vi.fn(() => `${ORIGIN}/workspaces/test`),
    isDestroyed: vi.fn(() => false),
    executeJavaScript: vi.fn(() => Promise.resolve(true)),
    session: {},
    mainFrame: frame
  }
  return { frame, contents, electron: contents as unknown as Electron.WebContents }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('injectFirebaseSession', () => {
  it('executes on the captured main frame and invalidates it when superseded', async () => {
    const { frame, electron } = fakeContents()

    const first = beginFirebaseSessionInjection(electron)
    await expect(injectFirebaseSession(first, ORIGIN, SAMPLE_USER, 'AIzaTEST')).resolves.toBe(
      'injected'
    )

    const second = beginFirebaseSessionInjection(electron)
    expect(frame.executeJavaScript).toHaveBeenLastCalledWith(expect.stringContaining('= null'))

    releaseFirebaseSessionInjection(second)
  })

  it('reports a marker that could not be saved apart from a view that kept its own session', async () => {
    const { frame, electron } = fakeContents()
    frame.executeJavaScript.mockImplementation((script: string) =>
      Promise.resolve(script.includes('location.reload()') ? 'marker_unsaved' : undefined)
    )
    const injection = beginFirebaseSessionInjection(electron)

    await expect(
      injectFirebaseSession(injection, ORIGIN, SAMPLE_USER, 'AIzaTEST', { onlyIfSignedOut: true })
    ).resolves.toBe('marker_unsaved')

    releaseFirebaseSessionInjection(injection)
  })

  it("cancels a Desktop sign-out cleanup on the same partition and waits for it to settle before the person's sign-in writes", async () => {
    const cleanupView = fakeContents()
    const signInView = fakeContents()
    signInView.contents.session = cleanupView.contents.session
    const untrack = trackPartitionCleanup(cleanupView.electron, 'cleanup-token')
    const cleanup = deferred()
    const cleanupRun = runOnPartition(cleanupView.electron, () => cleanup.promise)

    const injection = beginFirebaseSessionInjection(signInView.electron)
    const injecting = injectFirebaseSession(injection, ORIGIN, SAMPLE_USER, 'AIzaTEST')

    expect(cleanupView.contents.executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('"cleanup-token"')
    )
    await Promise.resolve()
    expect(signInView.frame.executeJavaScript).not.toHaveBeenCalled()

    untrack()
    cleanup.resolve()
    await cleanupRun
    await expect(injecting).resolves.toBe('injected')
    expect(signInView.frame.executeJavaScript).toHaveBeenCalled()

    releaseFirebaseSessionInjection(injection)
  })

  it("lets Desktop's own sign-in wait for a cleanup without cancelling it", async () => {
    const { contents, electron } = fakeContents()
    const untrack = trackPartitionCleanup(electron, 'cleanup-token')
    const cleanup = deferred()
    const cleanupRun = runOnPartition(electron, () => cleanup.promise)

    const injection = beginFirebaseSessionInjection(electron)
    const injecting = injectFirebaseSession(injection, ORIGIN, SAMPLE_USER, 'AIzaTEST', {
      onlyIfSignedOut: true
    })

    expect(contents.executeJavaScript).not.toHaveBeenCalled()

    untrack()
    cleanup.resolve()
    await cleanupRun
    await expect(injecting).resolves.toBe('injected')

    releaseFirebaseSessionInjection(injection)
  })

  it('keeps separate partitions independent', async () => {
    const busy = fakeContents()
    const other = fakeContents()
    const cleanup = deferred()
    void runOnPartition(busy.electron, () => cleanup.promise)

    const injection = beginFirebaseSessionInjection(other.electron)
    await expect(injectFirebaseSession(injection, ORIGIN, SAMPLE_USER, 'AIzaTEST')).resolves.toBe(
      'injected'
    )

    cleanup.resolve()
    releaseFirebaseSessionInjection(injection)
  })
})
