import { describe, expect, it, vi } from 'vitest'

import {
  beginFirebaseSessionInjection,
  buildIndexedDbInjectScript,
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
    // `Function` surfaces syntax errors without executing the body.
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

    // Replacement write wins before the stale flow's compensating cleanup.
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

describe('injectFirebaseSession', () => {
  it('executes on the captured main frame and invalidates it when superseded', async () => {
    const executeJavaScript = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(true)
      .mockResolvedValue(undefined)
    const frame = {
      executeJavaScript,
      isDestroyed: vi.fn(() => false)
    }
    const contents = {
      getURL: vi.fn(() => `${ORIGIN}/workspaces/test`),
      isDestroyed: vi.fn(() => false),
      mainFrame: frame
    } as unknown as Electron.WebContents

    const first = beginFirebaseSessionInjection(contents)
    await expect(injectFirebaseSession(first, ORIGIN, SAMPLE_USER, 'AIzaTEST')).resolves.toBe(true)

    const second = beginFirebaseSessionInjection(contents)
    expect(executeJavaScript).toHaveBeenLastCalledWith(expect.stringContaining('= null'))

    releaseFirebaseSessionInjection(second)
  })
})
