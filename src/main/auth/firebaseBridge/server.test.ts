// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getFirebaseConfig } from './config'
import { BRIDGE_PORT, startBridgeServer } from './server'

const firebaseFetch = vi.hoisted(() => vi.fn<typeof fetch>())

// Keep real loopback HTTP coverage while stubbing the Firebase request made
// through Chromium's net.fetch. These tests must not depend on an external API.
vi.mock('electron', () => ({
  net: { fetch: firebaseFetch }
}))

describe('startBridgeServer', () => {
  beforeEach(() => {
    firebaseFetch.mockReset()
  })

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
    const authUri = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=test-client-id'
    firebaseFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ authUri, sessionId: 'test-session', providerId: 'google.com' }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    )
    const handle = await startBridgeServer({ env: 'prod', providerId: 'google.com', port: 0 })
    try {
      const res = await fetch(handle.url, { redirect: 'manual' })
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe(authUri)
      expect(firebaseFetch).toHaveBeenCalledTimes(1)
      expect(firebaseFetch).toHaveBeenCalledWith(
        `https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=${getFirebaseConfig('prod').apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            providerId: 'google.com',
            continueUri: handle.url,
            oauthScope: 'profile email'
          }),
          credentials: 'omit'
        }
      )
    } finally {
      handle.close()
    }
  })

  it('exports the fixed port (9876) used by the Google OAuth client allowlist', () => {
    // Assert the constant, not a live bind — the contract with the Google
    // OAuth client's redirect-URI allowlist is the constant itself.
    expect(BRIDGE_PORT).toBe(9876)
  })
})
