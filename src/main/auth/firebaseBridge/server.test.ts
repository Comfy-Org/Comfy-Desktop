import { request } from 'node:http'

import { describe, expect, it } from 'vitest'

import { BRIDGE_PORT, type BridgeHandle, startCloudLoginCallbackServer } from './server'

function requestRaw(
  url: URL,
  opts: {
    method: string
    origin?: string
    body?: string
    headers?: Record<string, string>
  }
): Promise<{
  status: number
  headers: Record<string, string | string[] | undefined>
  body: string
}> {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: opts.method,
        headers: {
          ...(opts.origin ? { Origin: opts.origin } : {}),
          ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
          ...opts.headers
        }
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8')
          })
        )
      }
    )
    req.on('error', reject)
    if (opts.body) req.write(opts.body)
    req.end()
  })
}

async function closeExpectingRejection(handle: BridgeHandle): Promise<void> {
  const rejected = expect(handle.signInPromise).rejects.toThrow(/cancelled before completion/)
  handle.close()
  await rejected
}

function closeBridge(handle: BridgeHandle): void {
  handle.close()
}

async function withCloudLoginCallbackServer(
  run: (handle: BridgeHandle) => Promise<void>,
  closeHandle: (handle: BridgeHandle) => Promise<void> | void = closeExpectingRejection
): Promise<void> {
  const handle = await startCloudLoginCallbackServer({ state: 'state-123', port: 0 })
  try {
    await run(handle)
  } finally {
    await closeHandle(handle)
  }
}

describe('startCloudLoginCallbackServer', () => {
  it('exports the fixed port (9876) allowlisted by Cloud callbacks', () => {
    expect(BRIDGE_PORT).toBe(9876)
  })

  it('serves a 204 for /favicon.ico', async () => {
    await withCloudLoginCallbackServer(async (handle) => {
      const res = await fetch(`${handle.url}favicon.ico`)
      expect(res.status).toBe(204)
    })
  })

  it('serves a 404 for unknown paths', async () => {
    await withCloudLoginCallbackServer(async (handle) => {
      const res = await fetch(`${handle.url}does-not-exist`)
      expect(res.status).toBe(404)
    })
  })

  it('accepts a Cloud login callback with matching state', async () => {
    await withCloudLoginCallbackServer(async (handle) => {
      const res = await requestRaw(new URL('callback', handle.url), {
        method: 'POST',
        origin: 'https://cloud.comfy.org',
        body: JSON.stringify({
          state: 'state-123',
          apiKey: 'api-key',
          user: { uid: 'user-123' }
        })
      })
      expect(res.status).toBe(204)
      expect(res.headers['access-control-allow-origin']).toBe('https://cloud.comfy.org')
      await expect(handle.signInPromise).resolves.toEqual({
        apiKey: 'api-key',
        user: { uid: 'user-123' }
      })
    }, closeBridge)
  })

  it('ignores a stale Cloud login callback with mismatched state', async () => {
    await withCloudLoginCallbackServer(async (handle) => {
      const staleRes = await requestRaw(new URL('callback', handle.url), {
        method: 'POST',
        origin: 'https://cloud.comfy.org',
        body: JSON.stringify({
          state: 'wrong',
          apiKey: 'api-key',
          user: { uid: 'user-123' }
        })
      })
      expect(staleRes.status).toBe(403)
      expect(staleRes.body).toBe('Invalid state')

      const validRes = await requestRaw(new URL('callback', handle.url), {
        method: 'POST',
        origin: 'https://cloud.comfy.org',
        body: JSON.stringify({
          state: 'state-123',
          apiKey: 'api-key',
          user: { uid: 'user-123' }
        })
      })
      expect(validRes.status).toBe(204)
      await expect(handle.signInPromise).resolves.toEqual({
        apiKey: 'api-key',
        user: { uid: 'user-123' }
      })
    }, closeBridge)
  })

  it('preflights Cloud login callbacks from allowed origins', async () => {
    await withCloudLoginCallbackServer(async (handle) => {
      const res = await requestRaw(new URL('callback', handle.url), {
        method: 'OPTIONS',
        origin: 'https://cloud.comfy.org',
        headers: {
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Private-Network': 'true'
        }
      })
      expect(res.status).toBe(204)
      expect(res.headers['access-control-allow-origin']).toBe('https://cloud.comfy.org')
      expect(res.headers['access-control-allow-methods']).toContain('POST')
      expect(res.headers['access-control-allow-private-network']).toBe('true')
    })
  })

  it('rejects Cloud login POSTs from disallowed origins', async () => {
    await withCloudLoginCallbackServer(async (handle) => {
      const res = await requestRaw(new URL('callback', handle.url), {
        method: 'POST',
        origin: 'https://untrusted.example.com',
        body: JSON.stringify({
          state: 'state-123',
          apiKey: 'api-key',
          user: { uid: 'user-123' }
        })
      })
      expect(res.status).toBe(403)
      expect(res.headers['access-control-allow-origin']).toBeUndefined()
    })
  })

  it('rejects Cloud login preflights from disallowed origins', async () => {
    await withCloudLoginCallbackServer(async (handle) => {
      const res = await requestRaw(new URL('callback', handle.url), {
        method: 'OPTIONS',
        origin: 'https://untrusted.example.com',
        headers: {
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Private-Network': 'true'
        }
      })
      expect(res.status).toBe(403)
      expect(res.headers['access-control-allow-origin']).toBeUndefined()
      expect(res.headers['access-control-allow-private-network']).toBeUndefined()
    })
  })

  it('rejects non-POST callback methods', async () => {
    await withCloudLoginCallbackServer(async (handle) => {
      const res = await requestRaw(new URL('callback', handle.url), {
        method: 'PUT',
        origin: 'https://cloud.comfy.org'
      })
      expect(res.status).toBe(405)
    })
  })

  it('rejects matching-state callbacks without a user payload', async () => {
    await withCloudLoginCallbackServer(async (handle) => {
      const res = await requestRaw(new URL('callback', handle.url), {
        method: 'POST',
        origin: 'https://cloud.comfy.org',
        body: JSON.stringify({
          state: 'state-123',
          apiKey: 'api-key'
        })
      })
      expect(res.status).toBe(400)
      expect(res.body).toBe('Missing user payload')
    })
  })

  it('rejects matching-state callbacks without a string apiKey', async () => {
    await withCloudLoginCallbackServer(async (handle) => {
      const res = await requestRaw(new URL('callback', handle.url), {
        method: 'POST',
        origin: 'https://cloud.comfy.org',
        body: JSON.stringify({
          state: 'state-123',
          apiKey: 123,
          user: { uid: 'user-123' }
        })
      })
      expect(res.status).toBe(400)
      expect(res.body).toBe('Missing user payload')
    })
  })

  it('returns 413 for oversized callback bodies', async () => {
    await withCloudLoginCallbackServer(async (handle) => {
      const rejected = expect(handle.signInPromise).rejects.toThrow(/Body too large/)
      const res = await requestRaw(new URL('callback', handle.url), {
        method: 'POST',
        origin: 'https://cloud.comfy.org',
        body: JSON.stringify({
          state: 'state-123',
          apiKey: 'api-key',
          user: { payload: 'x'.repeat(65 * 1024) }
        })
      })
      expect(res.status).toBe(413)
      expect(res.body).toBe('Payload too large')
      await rejected
    }, closeBridge)
  })

  it('returns a generic 500 body for malformed callback JSON', async () => {
    await withCloudLoginCallbackServer(async (handle) => {
      const rejected = expect(handle.signInPromise).rejects.toThrow()
      const res = await requestRaw(new URL('callback', handle.url), {
        method: 'POST',
        origin: 'https://cloud.comfy.org',
        body: '{'
      })
      expect(res.status).toBe(500)
      expect(res.body).toBe('Login callback failed')
      await rejected
    }, closeBridge)
  })

  it('rejects pending Cloud login sign-ins when closed', async () => {
    const handle = await startCloudLoginCallbackServer({ state: 'state-123', port: 0 })
    await closeExpectingRejection(handle)
  })
})
