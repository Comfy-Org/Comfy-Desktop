// @vitest-environment node
import { Buffer } from 'node:buffer'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { list as tarList } from 'tar'

import { parseArtifact, parseDeployments, parsePipelines } from '../../main/comfybuilder/dto'
import {
  buildAuthorizeUrl,
  codeChallengeFromVerifier,
  generateCodeVerifier,
  generateState,
} from '../../main/comfybuilder/pkce'
import { startMockBuilderApi, startMockOAuthIssuer } from './mockServers'
import type { MockServer } from './mockServers'

const CLIENT_ID = 'comfy-desktop'
const REDIRECT_URI = 'http://127.0.0.1:53682/callback'

function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split('.')[1] ?? ''
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
}

describe('comfybuilder mock servers', () => {
  let issuer: MockServer
  let api: MockServer
  const tempDirs: string[] = []

  beforeAll(async () => {
    issuer = await startMockOAuthIssuer()
    api = await startMockBuilderApi()
  })

  afterAll(async () => {
    await issuer.stop()
    await api.stop()
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
  })

  /** Drive a full PKCE authorize -> token exchange and return the raw token JSON. */
  async function exchangeCode(verifier: string): Promise<{ access_token: string; expires_in: number }> {
    const authorizeUrl = buildAuthorizeUrl({
      authorizeUrl: `${issuer.baseUrl}/oauth/authorize`,
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
      scope: 'comfy-cloud:user:read',
      resource: `${issuer.baseUrl}/api`,
      state: generateState(),
      codeChallenge: codeChallengeFromVerifier(verifier),
    })
    const authRes = await fetch(authorizeUrl, { redirect: 'manual' })
    const location = authRes.headers.get('location')
    if (!location) throw new Error('authorize did not redirect')
    const code = new URL(location).searchParams.get('code')
    if (!code) throw new Error('authorize did not return a code')
    const tokenRes = await fetch(`${issuer.baseUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
      }).toString(),
    })
    expect(tokenRes.status).toBe(200)
    return (await tokenRes.json()) as { access_token: string; expires_in: number }
  }

  async function accessToken(): Promise<string> {
    return (await exchangeCode(generateCodeVerifier())).access_token
  }

  it('echoes state and returns a mock code from /oauth/authorize', async () => {
    const state = generateState()
    const authorizeUrl = buildAuthorizeUrl({
      authorizeUrl: `${issuer.baseUrl}/oauth/authorize`,
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
      scope: 'comfy-cloud:user:read',
      state,
      codeChallenge: codeChallengeFromVerifier(generateCodeVerifier()),
    })
    const res = await fetch(authorizeUrl, { redirect: 'manual' })
    expect(res.status).toBe(302)
    const location = res.headers.get('location')
    expect(location).toBeTruthy()
    const callback = new URL(location as string)
    expect(callback.searchParams.get('code')).toMatch(/^mock-code-/)
    expect(callback.searchParams.get('state')).toBe(state)
  })

  it('completes a PKCE exchange with workspace_id in the access token', async () => {
    const token = await exchangeCode(generateCodeVerifier())
    expect(token.access_token).toBeTruthy()
    expect(token.expires_in).toBe(3600)

    const claims = decodeJwtPayload(token.access_token)
    expect(claims.workspace_id).toBe('ws-test')
    expect(claims.email).toBe('test@example.com')
    expect(claims.workspace_type).toBe('personal')
    expect(claims.role).toBe('owner')
    expect(claims.aud).toBe('comfy-cloud')
    expect(typeof claims.exp).toBe('number')
  })

  it('rejects a token exchange with a wrong code_verifier (invalid_grant)', async () => {
    const authorizeUrl = buildAuthorizeUrl({
      authorizeUrl: `${issuer.baseUrl}/oauth/authorize`,
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
      scope: 'comfy-cloud:user:read',
      state: generateState(),
      codeChallenge: codeChallengeFromVerifier(generateCodeVerifier()),
    })
    const authRes = await fetch(authorizeUrl, { redirect: 'manual' })
    const code = new URL(authRes.headers.get('location') as string).searchParams.get('code') as string

    const tokenRes = await fetch(`${issuer.baseUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        code_verifier: 'not-the-right-verifier',
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
      }).toString(),
    })
    expect(tokenRes.status).toBe(400)
    expect((await tokenRes.json()) as { error: string }).toMatchObject({ error: 'invalid_grant' })
  })

  it('serves a JWKS document with an RSA signing key', async () => {
    const res = await fetch(`${issuer.baseUrl}/.well-known/jwks.json`)
    expect(res.status).toBe(200)
    const jwks = (await res.json()) as { keys: Array<Record<string, unknown>> }
    expect(jwks.keys.length).toBeGreaterThanOrEqual(1)
    expect(jwks.keys[0]?.kty).toBe('RSA')
    expect(jwks.keys[0]?.use).toBe('sig')
  })

  it('returns 401 for the builder API without a bearer token', async () => {
    const res = await fetch(`${api.baseUrl}/api/v1/pipelines`)
    expect(res.status).toBe(401)
    expect((await res.json()) as unknown).toEqual({
      code: 'unauthorized',
      message: 'authentication required',
    })
  })

  it('lists pipelines and deployments that pass the real DTO parsers', async () => {
    const token = await accessToken()
    const headers = { authorization: `Bearer ${token}` }

    const pipelinesRes = await fetch(`${api.baseUrl}/api/v1/pipelines`, { headers })
    expect(pipelinesRes.status).toBe(200)
    const pipelines = parsePipelines(await pipelinesRes.json())
    expect(pipelines.length).toBeGreaterThanOrEqual(2)

    const successRes = await fetch(`${api.baseUrl}/api/v1/pipelines/pipe-success/deployments`, { headers })
    const successDeployments = parseDeployments(await successRes.json())
    const succeeded = successDeployments.find((d) => d.status === 'succeeded')
    expect(succeeded).toBeDefined()
    expect(succeeded?.artifact).toBeTruthy()
    // Round-trips through the strict artifact parser.
    expect(() => parseArtifact(succeeded?.artifact)).not.toThrow()

    const failedRes = await fetch(`${api.baseUrl}/api/v1/pipelines/pipe-failed/deployments`, { headers })
    const failedDeployments = parseDeployments(await failedRes.json())
    expect(failedDeployments.length).toBeGreaterThanOrEqual(1)
    expect(failedDeployments.every((d) => d.status === 'failed')).toBe(true)
  })

  it('issues a download token and streams a fixture tarball listing the expected entries', async () => {
    const token = await accessToken()
    const headers = { authorization: `Bearer ${token}` }
    const base = `${api.baseUrl}/api/v1/pipelines/pipe-success/deployments/dep-success-1/artifact`

    // Direct (bearer) artifact stream.
    const directRes = await fetch(base, { headers })
    expect(directRes.status).toBe(200)
    expect(Buffer.from(await directRes.arrayBuffer()).byteLength).toBeGreaterThan(0)

    // Download-token flow.
    const tokenRes = await fetch(`${base}/download-token`, { method: 'POST', headers })
    expect(tokenRes.status).toBe(200)
    const downloadToken = (await tokenRes.json()) as { token: string; expires_at: string }
    expect(downloadToken.token).toBe('mock-token-123')
    expect(Number.isNaN(Date.parse(downloadToken.expires_at))).toBe(false)

    const downloadRes = await fetch(`${base}/download?token=${downloadToken.token}`)
    expect(downloadRes.status).toBe(200)

    const dir = mkdtempSync(join(tmpdir(), 'mock-artifact-dl-'))
    tempDirs.push(dir)
    const tarPath = join(dir, 'artifact.tar.gz')
    writeFileSync(tarPath, Buffer.from(await downloadRes.arrayBuffer()))

    // Equivalent of `tar tzf`: enumerate archive entry paths.
    const entries: string[] = []
    await tarList({ file: tarPath, onReadEntry: (entry) => entries.push(entry.path) })
    const listing = entries.join('\n')
    expect(listing).toContain('standalone-env/')
    expect(listing).toContain('ComfyUI/')
    expect(listing).toContain('manifest.json')
  })

  it('rejects a download with an invalid token', async () => {
    const base = `${api.baseUrl}/api/v1/pipelines/pipe-success/deployments/dep-success-1/artifact`
    const res = await fetch(`${base}/download?token=bogus-token`)
    expect(res.status).toBe(401)
  })
})
