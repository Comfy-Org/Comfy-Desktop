// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getUserIdentity } from './identity'

function respond(body: unknown, status = 200) {
  const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

afterEach(() => vi.unstubAllGlobals())

describe('authenticated person identity', () => {
  it('keeps linked Firebase identity separate from the canonical account', async () => {
    const fetch = respond({
      id: 'canonical-person',
      status: 'active',
      firebase_uid: 'firebase-person'
    })
    await expect(
      getUserIdentity('access-token', { apiBase: 'https://cloud.example/api/' })
    ).resolves.toEqual({ userId: 'canonical-person', firebaseUid: 'firebase-person' })
    expect(fetch).toHaveBeenCalledWith(
      'https://cloud.example/api/user',
      expect.objectContaining({
        headers: { Accept: 'application/json', Authorization: 'Bearer access-token' },
        redirect: 'error'
      })
    )
  })

  it('does not infer a Firebase UID for legacy grants', async () => {
    respond({ id: 'canonical-person', status: 'active' })
    await expect(getUserIdentity('legacy-token')).resolves.toEqual({ userId: 'canonical-person' })
  })

  it.each([401, 403])('returns no identity for HTTP %i', async (status) => {
    respond({ id: 'untrusted', firebase_uid: 'untrusted' }, status)
    await expect(getUserIdentity('rejected-token')).resolves.toBeNull()
  })

  it.each([
    null,
    {},
    { id: '' },
    { id: 'person', firebase_uid: null },
    { id: 'person', firebase_uid: ' ' },
    { id: 'person', firebase_uid: 'x'.repeat(129) }
  ])('rejects malformed identity data: %j', async (body) => {
    respond(body)
    await expect(getUserIdentity('token')).rejects.toThrow(/Invalid .*identity response/)
  })

  it('propagates cancellation without including credentials in errors', async () => {
    const abort = new AbortController()
    let requestSignal: AbortSignal | null | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn((_url, options: RequestInit) => {
        requestSignal = options.signal
        return new Promise((_resolve, reject) => {
          requestSignal!.addEventListener('abort', () => reject(requestSignal!.reason), {
            once: true
          })
        })
      })
    )
    const request = getUserIdentity('private-token', { signal: abort.signal })
    abort.abort()
    await expect(request).rejects.toThrow(/abort/i)
    expect(requestSignal?.aborted).toBe(true)
  })
})
