import { describe, expect, it, vi } from 'vitest'

import {
  beginFirebaseSessionInjection,
  buildIndexedDbInjectScript,
  CLOUD_WEB_SESSION_COOKIE,
  FIREBASE_SESSION_INJECTION_OWNER_FIELD,
  injectFirebaseSession,
  isFirebaseSessionInjectionRecordOwnedBy,
  releaseFirebaseSessionInjection
} from './inject'

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

function fakeHostedView(removeCookie: () => Promise<void> = () => Promise.resolve()) {
  const executeJavaScript = vi
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce(true)
    .mockResolvedValue(undefined)
  const remove = vi.fn(removeCookie)
  const contents = {
    getURL: vi.fn(() => `${ORIGIN}/workspaces/test`),
    isDestroyed: vi.fn(() => false),
    mainFrame: { executeJavaScript, isDestroyed: vi.fn(() => false) },
    session: { cookies: { remove } }
  } as unknown as Electron.WebContents
  return { contents, executeJavaScript, remove }
}

describe('injectFirebaseSession', () => {
  it('removes the previous Cloud session cookie before the reload', async () => {
    const { contents, executeJavaScript, remove } = fakeHostedView()

    const injection = beginFirebaseSessionInjection(contents)
    await expect(injectFirebaseSession(injection, ORIGIN, SAMPLE_USER, 'AIzaTEST')).resolves.toBe(
      true
    )

    expect(remove).toHaveBeenCalledWith(`${ORIGIN}/`, CLOUD_WEB_SESSION_COOKIE)
    expect(remove.mock.invocationCallOrder[0]).toBeLessThan(
      executeJavaScript.mock.invocationCallOrder[1]!
    )
    releaseFirebaseSessionInjection(injection)
  })

  it('still writes the user when the cookie cannot be removed', async () => {
    const { contents, executeJavaScript } = fakeHostedView(() =>
      Promise.reject(new Error('cookie store unavailable'))
    )

    const injection = beginFirebaseSessionInjection(contents)
    await expect(injectFirebaseSession(injection, ORIGIN, SAMPLE_USER, 'AIzaTEST')).resolves.toBe(
      true
    )

    expect(executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('location.reload()'),
      true
    )
    releaseFirebaseSessionInjection(injection)
  })

  it('leaves the cookie alone when the view is on another origin', async () => {
    const { contents, remove } = fakeHostedView()

    const injection = beginFirebaseSessionInjection(contents)
    await expect(
      injectFirebaseSession(injection, 'https://stagingcloud.comfy.org', SAMPLE_USER, 'AIzaTEST')
    ).resolves.toBe(false)

    expect(remove).not.toHaveBeenCalled()
    releaseFirebaseSessionInjection(injection)
  })

  it('executes on the captured main frame and invalidates it when superseded', async () => {
    const { contents, executeJavaScript } = fakeHostedView()

    const first = beginFirebaseSessionInjection(contents)
    await expect(injectFirebaseSession(first, ORIGIN, SAMPLE_USER, 'AIzaTEST')).resolves.toBe(true)

    const second = beginFirebaseSessionInjection(contents)
    expect(executeJavaScript).toHaveBeenLastCalledWith(expect.stringContaining('= null'))

    releaseFirebaseSessionInjection(second)
  })
})
