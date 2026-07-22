// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// oauth.ts imports `shell` from electron at module load; mock before importing it.
vi.mock('electron', () => ({
  shell: { openExternal: vi.fn() },
}))

import { shell } from 'electron'

import { startMockOAuthIssuer } from '../../test/comfybuilder/mockServers'
import type { MockServer } from '../../test/comfybuilder/mockServers'
import { refresh, signIn } from './oauth'

describe('comfybuilder oauth', () => {
  let issuer: MockServer

  beforeAll(async () => {
    issuer = await startMockOAuthIssuer()
  })

  afterAll(async () => {
    await issuer.stop()
  })

  beforeEach(() => {
    vi.mocked(shell.openExternal).mockReset()
  })

  it('signs in via PKCE and populates status from the JWT (happy path)', async () => {
    // A real system browser would follow the issuer's 302 into the loopback
    // callback; the stub GETs the authorize URL and lets fetch follow the
    // redirect (code+state) into the listener.
    vi.mocked(shell.openExternal).mockImplementation(async (url: string) => {
      await fetch(url)
    })

    const { tokens, status } = await signIn({
      authorizeUrl: `${issuer.baseUrl}/oauth/authorize`,
      tokenUrl: `${issuer.baseUrl}/oauth/token`,
      resource: `${issuer.baseUrl}/api`,
    })

    expect(tokens.accessToken).toBeTruthy()
    expect(tokens.refreshToken).toMatch(/^mock-refresh-/)
    expect(tokens.expiresAt).toBeGreaterThan(Date.now())

    expect(status.signedIn).toBe(true)
    expect(status.workspaceId).toBe('ws-test')
    expect(status.email).toBe('test@example.com')
    expect(status.workspaceType).toBe('personal')
    expect(status.role).toBe('owner')

    expect(shell.openExternal).toHaveBeenCalledTimes(1)
  })

  it('refreshes an access token and returns an updated expiry', async () => {
    const tokens = await refresh('mock-refresh-token', {
      tokenUrl: `${issuer.baseUrl}/oauth/token`,
      resource: `${issuer.baseUrl}/api`,
    })

    expect(tokens.accessToken).toBeTruthy()
    expect(tokens.refreshToken).toMatch(/^mock-refresh-/)
    // expires_in is 3600s, so a fresh expiry is ~1h out — proves it was applied.
    expect(tokens.expiresAt).toBeGreaterThan(Date.now() + 3_000_000)
    // The system browser is never involved in a refresh.
    expect(shell.openExternal).not.toHaveBeenCalled()
  })

  it('rejects on timeout and closes the loopback listener (cancel)', async () => {
    let authorizeUrl = ''
    // Simulate the user never completing the flow: capture the URL, hit nothing.
    vi.mocked(shell.openExternal).mockImplementation(async (url: string) => {
      authorizeUrl = url
    })

    await expect(
      signIn({
        authorizeUrl: `${issuer.baseUrl}/oauth/authorize`,
        tokenUrl: `${issuer.baseUrl}/oauth/token`,
        resource: `${issuer.baseUrl}/api`,
        timeoutMs: 100,
      }),
    ).rejects.toThrow(/timed out/i)

    // The single-shot loopback listener must have shut down on timeout, so its
    // redirect target now refuses connections.
    const redirectUri = new URL(authorizeUrl).searchParams.get('redirect_uri')
    expect(redirectUri).toBeTruthy()
    await expect(fetch(redirectUri as string)).rejects.toThrow()
  })
})
