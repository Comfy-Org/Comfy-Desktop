import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildPersistedUserFromCustomToken,
  lookupAccount,
  signInWithCustomToken
} from './customTokenSignIn'
import { hangingFetch, jsonResponse } from './testHelpers'
import { getFirebaseConfig } from '../firebaseBridge/config'

const IDP_BASE = 'https://identitytoolkit.googleapis.com/v1'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('custom-token sign-in', () => {
  it('chains sign-in and lookup into the exact persisted-user shape', async () => {
    const config = getFirebaseConfig('prod')
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      if (String(args[0]).includes('signInWithCustomToken')) {
        return jsonResponse(200, {
          idToken: 'id-token',
          refreshToken: 'refresh-token',
          expiresIn: '3600'
        })
      }
      return jsonResponse(200, {
        users: [
          {
            localId: 'uid-1',
            email: 'user@example.com',
            emailVerified: true,
            displayName: 'User One',
            photoUrl: 'https://example.com/p.png',
            providerUserInfo: [
              {
                providerId: 'google.com',
                rawId: 'google-raw-id',
                email: 'user@example.com',
                displayName: 'User One',
                photoUrl: 'https://example.com/p.png'
              }
            ],
            createdAt: '1700000000000',
            lastLoginAt: '1700000005000'
          }
        ]
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const signIn = await signInWithCustomToken(config.apiKey, 'custom-token-value')
    const account = await lookupAccount(config.apiKey, signIn.idToken)
    const user = buildPersistedUserFromCustomToken(config, signIn, account)

    expect(fetchMock.mock.calls[0]![0]).toBe(
      `${IDP_BASE}/accounts:signInWithCustomToken?key=${config.apiKey}`
    )
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))).toEqual({
      token: 'custom-token-value',
      returnSecureToken: true
    })
    expect(fetchMock.mock.calls[1]![0]).toBe(`${IDP_BASE}/accounts:lookup?key=${config.apiKey}`)
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1]?.body))).toEqual({ idToken: 'id-token' })

    expect(user).toEqual({
      uid: 'uid-1',
      email: 'user@example.com',
      emailVerified: true,
      displayName: 'User One',
      isAnonymous: false,
      photoURL: 'https://example.com/p.png',
      phoneNumber: null,
      tenantId: null,
      providerData: [
        {
          providerId: 'google.com',
          uid: 'google-raw-id',
          displayName: 'User One',
          email: 'user@example.com',
          phoneNumber: null,
          photoURL: 'https://example.com/p.png'
        }
      ],
      stsTokenManager: {
        refreshToken: 'refresh-token',
        accessToken: 'id-token',
        expirationTime: expect.any(Number)
      },
      createdAt: '1700000000000',
      lastLoginAt: '1700000005000',
      apiKey: config.apiKey,
      appName: '[DEFAULT]'
    })
    const sts = user.stsTokenManager as { expirationTime: number }
    expect(sts.expirationTime).toBeGreaterThan(Date.now())
    expect(sts.expirationTime).toBeLessThanOrEqual(Date.now() + 3600 * 1000)
  })

  it('defaults profile fields and malformed expiresIn values', () => {
    const config = getFirebaseConfig('prod')
    const before = Date.now()
    const user = buildPersistedUserFromCustomToken(
      config,
      { idToken: 'id-token', refreshToken: 'refresh-token', expiresIn: 'not-a-number' },
      { localId: 'uid-2' }
    )

    expect(user.uid).toBe('uid-2')
    expect(user.email).toBeNull()
    expect(user.emailVerified).toBe(false)
    expect(user.providerData).toEqual([])
    expect(user.createdAt).toEqual(expect.any(String))
    expect(user.lastLoginAt).toEqual(expect.any(String))
    const sts = user.stsTokenManager as { expirationTime: number }
    expect(sts.expirationTime).toBeGreaterThan(before)
    expect(sts.expirationTime).toBeLessThanOrEqual(Date.now() + 3600 * 1000)
  })

  it('aborts an in-flight call when a superseded flow cancels its signal', async () => {
    vi.stubGlobal('fetch', vi.fn(hangingFetch()))
    const controller = new AbortController()

    const pending = signInWithCustomToken('api-key', 'custom-token-value', {
      signal: controller.signal
    })
    controller.abort()

    const err = await pending.catch((e: unknown) => e)
    expect((err as Error).name).toBe('AbortError')
  })

  it('times out a hung identitytoolkit call instead of stalling the flow', async () => {
    vi.stubGlobal('fetch', vi.fn(hangingFetch()))

    await expect(lookupAccount('api-key', 'id-token', { timeoutMs: 5 })).rejects.toThrow(
      /timed out/
    )
  })

  it('surfaces the HTTP status when sign-in fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(400, { error: { message: 'INVALID_CUSTOM_TOKEN' } }))
    )

    await expect(signInWithCustomToken('api-key', 'bad-token')).rejects.toThrow(
      /signInWithCustomToken 400/
    )
  })

  it('surfaces the HTTP status when lookup fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(403, { error: { message: 'PERMISSION_DENIED' } }))
    )

    await expect(lookupAccount('api-key', 'id-token')).rejects.toThrow(/accounts:lookup 403/)
  })

  it('rejects when lookup returns no users', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, { users: [] }))
    )

    await expect(lookupAccount('api-key', 'id-token')).rejects.toThrow(/no user/)
  })
})
