import { request } from 'node:http'

import { describe, expect, it } from 'vitest'

import { BRIDGE_PORT, startBridgeServer, startCloudLoginCallbackServer } from './server'

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

describe('startBridgeServer', () => {
  it('serves a 204 for /favicon.ico', async () => {
    const handle = await startBridgeServer({ env: 'prod', providerId: 'google.com', port: 0 })
    try {
      const res = await fetch(`${handle.url}favicon.ico`)
      expect(res.status).toBe(204)
    } finally {
      handle.close()
    }
  })

  it('serves a 404 for unknown paths', async () => {
    const handle = await startBridgeServer({ env: 'prod', providerId: 'google.com', port: 0 })
    try {
      const res = await fetch(`${handle.url}does-not-exist`)
      expect(res.status).toBe(404)
    } finally {
      handle.close()
    }
  })

  it('serves the error page when the IdP redirects with ?error=...', async () => {
    const handle = await startBridgeServer({ env: 'prod', providerId: 'google.com', port: 0 })
    // Attach the rejection handler before the error fetch: the ?error= branch
    // rejects signInPromise synchronously, which Vitest would otherwise flag
    // as an unhandled rejection.
    const rejected = expect(handle.signInPromise).rejects.toThrow(/IdP error/)
    try {
      const res = await fetch(
        `${handle.url}?error=access_denied&error_description=user+cancelled`,
        { redirect: 'manual' }
      )
      expect(res.status).toBe(200)
      const body = await res.text()
      expect(body).toContain('Sign-in failed')
      expect(body).toContain('user cancelled')
      await rejected
    } finally {
      handle.close()
    }
  })

  it('issues HTTP URL as http://localhost on a loopback port', async () => {
    const handle = await startBridgeServer({ env: 'prod', providerId: 'google.com', port: 0 })
    try {
      expect(handle.url).toMatch(/^http:\/\/localhost:\d+\/$/)
    } finally {
      handle.close()
    }
  })

  it('serves the popup-bridge HTML for github.com providers', async () => {
    const handle = await startBridgeServer({ env: 'prod', providerId: 'github.com', port: 0 })
    try {
      const res = await fetch(handle.url, { redirect: 'manual' })
      expect(res.status).toBe(200)
      const body = await res.text()
      expect(body).toContain('firebase-app.js')
      expect(body).toContain('Continue with')
      expect(body).toContain('"GitHub"')
    } finally {
      handle.close()
    }
  })

  it('302s the browser to Google OAuth for google.com providers (raw-OAuth flow)', async () => {
    const handle = await startBridgeServer({ env: 'prod', providerId: 'google.com', port: 0 })
    try {
      const res = await fetch(handle.url, { redirect: 'manual' })
      expect(res.status).toBe(302)
      const location = res.headers.get('location') || ''
      expect(location).toContain('accounts.google.com')
      expect(location).toContain('client_id=')
    } finally {
      handle.close()
    }
  })

  it('exports the fixed port (9876) used by the Google OAuth client allowlist', () => {
    // Assert the constant, not a live bind — the contract with the Google
    // OAuth client's redirect-URI allowlist is the constant itself.
    expect(BRIDGE_PORT).toBe(9876)
  })

  it('accepts a Cloud login callback with matching state', async () => {
    const handle = await startCloudLoginCallbackServer({ state: 'state-123', port: 0 })
    try {
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
    } finally {
      handle.close()
    }
  })

  it('rejects a Cloud login callback with mismatched state', async () => {
    const handle = await startCloudLoginCallbackServer({ state: 'state-123', port: 0 })
    const rejected = expect(handle.signInPromise).rejects.toThrow(/state mismatch/)
    try {
      const res = await fetch(new URL('callback', handle.url), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://cloud.comfy.org'
        },
        body: JSON.stringify({
          state: 'wrong',
          apiKey: 'api-key',
          user: { uid: 'user-123' }
        })
      })
      expect(res.status).toBe(403)
      await rejected
    } finally {
      handle.close()
    }
  })

  it('preflights Cloud login callbacks from allowed origins', async () => {
    const handle = await startCloudLoginCallbackServer({ state: 'state-123', port: 0 })
    try {
      const res = await requestRaw(new URL('callback', handle.url), {
        method: 'OPTIONS',
        origin: 'https://cloud.comfy.org',
        headers: {
          'Access-Control-Request-Method': 'POST'
        }
      })
      expect(res.status).toBe(204)
      expect(res.headers['access-control-allow-origin']).toBe('https://cloud.comfy.org')
      expect(res.headers['access-control-allow-methods']).toContain('POST')
    } finally {
      handle.close()
    }
  })
})
