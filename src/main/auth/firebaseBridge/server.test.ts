import { describe, expect, it } from 'vitest'

import { request as httpRequest } from 'node:http'

import { BRIDGE_PORT, startBridgeServer } from './server'

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
        { redirect: 'manual' },
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

  describe('POST /callback origin enforcement', () => {
    const USER = { uid: 'uid-1', email: 'a@b.c', stsTokenManager: { refreshToken: 'r' } }

    /** Raw request so headers arrive exactly as sent (undici strips Origin). */
    function rawPost(
      url: string,
      headers: Record<string, string>
    ): Promise<{ status: number }> {
      const target = new URL('callback', url)
      const body = JSON.stringify({ user: USER })
      return new Promise((resolve, reject) => {
        const req = httpRequest(
          {
            hostname: target.hostname,
            port: target.port,
            path: target.pathname,
            method: 'POST',
            headers: { 'Content-Length': Buffer.byteLength(body), ...headers }
          },
          (res) => {
            res.resume()
            res.on('end', () => resolve({ status: res.statusCode ?? 0 }))
          }
        )
        req.on('error', reject)
        req.end(body)
      })
    }

    /** Did the flow complete? Must be false for every rejected request. */
    async function signedIn(handle: { signInPromise: Promise<unknown> }): Promise<boolean> {
      return await Promise.race([
        handle.signInPromise.then(() => true),
        new Promise<boolean>((r) => setTimeout(() => r(false), 50))
      ])
    }

    // The one shape that reaches a loopback server cross-site with no CORS
    // preflight: a form POST, whose content-type is CORS-"simple".
    it('rejects a cross-site form POST and signs nobody in', async () => {
      const handle = await startBridgeServer({ env: 'prod', providerId: 'github.com', port: 0 })
      try {
        const res = await rawPost(handle.url, {
          'Content-Type': 'text/plain;charset=UTF-8',
          Origin: 'https://evil.example.com',
          'Sec-Fetch-Site': 'cross-site'
        })
        expect(res.status).toBe(403)
        expect(await signedIn(handle)).toBe(false)
      } finally {
        handle.close()
      }
    })

    it('rejects a JSON POST from a foreign origin', async () => {
      const handle = await startBridgeServer({ env: 'prod', providerId: 'github.com', port: 0 })
      try {
        const res = await rawPost(handle.url, {
          'Content-Type': 'application/json',
          Origin: 'https://evil.example.com'
        })
        expect(res.status).toBe(403)
        expect(await signedIn(handle)).toBe(false)
      } finally {
        handle.close()
      }
    })

    it('rejects a POST with neither Origin nor Sec-Fetch-Site (fails closed)', async () => {
      const handle = await startBridgeServer({ env: 'prod', providerId: 'github.com', port: 0 })
      try {
        const res = await rawPost(handle.url, { 'Content-Type': 'application/json' })
        expect(res.status).toBe(403)
        expect(await signedIn(handle)).toBe(false)
      } finally {
        handle.close()
      }
    })

    it('accepts the genuine same-origin JSON call from the bridge page', async () => {
      const handle = await startBridgeServer({ env: 'prod', providerId: 'github.com', port: 0 })
      try {
        const res = await rawPost(handle.url, {
          'Content-Type': 'application/json',
          Origin: new URL(handle.url).origin,
          'Sec-Fetch-Site': 'same-origin'
        })
        expect(res.status).toBe(204)
        await expect(handle.signInPromise).resolves.toMatchObject({ user: USER })
      } finally {
        handle.close()
      }
    })
  })
})
