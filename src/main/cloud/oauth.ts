/**
 * PKCE authorization-code flow (RFC 8252): bind a loopback redirect, open the
 * system browser at the authorize URL, wait for the callback code, exchange it
 * for tokens. `signIn` optionally pre-selects a workspace (the switch path).
 */
import { shell } from 'electron'

import { statusFromAccessToken } from './claims'
import { CLOUD_CONFIG } from './config'
import { startLoopbackListener } from './loopback'
import { buildAuthorizeUrl, codeChallengeFromVerifier, generateCodeVerifier, generateState } from './pkce'
import type { AuthStatus, AuthTokens } from './types'

const DEFAULT_SIGN_IN_TIMEOUT_MS = 120_000
const TOKEN_REQUEST_TIMEOUT_MS = 15_000

export interface OAuthOptions {
  authorizeUrl?: string
  tokenUrl?: string
  clientId?: string
  scope?: string
  resource?: string
  timeoutMs?: number
  /** Pre-select this workspace at consent time. */
  workspaceId?: string
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
}

function resolveConfig(o: OAuthOptions): Required<Omit<OAuthOptions, 'workspaceId'>> {
  return {
    authorizeUrl: o.authorizeUrl ?? CLOUD_CONFIG.authorizeUrl,
    tokenUrl: o.tokenUrl ?? CLOUD_CONFIG.tokenUrl,
    clientId: o.clientId ?? CLOUD_CONFIG.clientId,
    scope: o.scope ?? CLOUD_CONFIG.scope,
    resource: o.resource ?? CLOUD_CONFIG.resource,
    timeoutMs: o.timeoutMs ?? DEFAULT_SIGN_IN_TIMEOUT_MS,
  }
}

function toTokens(r: TokenResponse): AuthTokens {
  return { accessToken: r.access_token, refreshToken: r.refresh_token, expiresAt: Date.now() + r.expires_in * 1000 }
}

async function requestToken(tokenUrl: string, body: URLSearchParams): Promise<TokenResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TOKEN_REQUEST_TIMEOUT_MS)
  let resp: Response
  try {
    resp = await fetch(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(), signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '')
    throw new Error(`OAuth token request failed: ${resp.status} ${detail || resp.statusText}`)
  }
  return (await resp.json()) as TokenResponse
}

export async function signIn(options: OAuthOptions = {}): Promise<{ tokens: AuthTokens; status: AuthStatus }> {
  const cfg = resolveConfig(options)
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = codeChallengeFromVerifier(codeVerifier)
  const state = generateState()

  const listener = await startLoopbackListener({ expectedState: state, timeoutMs: cfg.timeoutMs })
  const authorizeUrl = buildAuthorizeUrl({
    authorizeUrl: cfg.authorizeUrl, clientId: cfg.clientId, redirectUri: listener.redirectUri,
    scope: cfg.scope, resource: cfg.resource, state, codeChallenge,
    ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
  })
  // System browser only (RFC 8252): never an embedded window/webview.
  await shell.openExternal(authorizeUrl)
  const { code } = await listener.waitForCode()

  const r = await requestToken(cfg.tokenUrl, new URLSearchParams({
    grant_type: 'authorization_code', code, redirect_uri: listener.redirectUri,
    client_id: cfg.clientId, code_verifier: codeVerifier, resource: cfg.resource,
  }))
  return { tokens: toTokens(r), status: statusFromAccessToken(r.access_token) }
}

export async function refresh(refreshToken: string, options: OAuthOptions = {}): Promise<AuthTokens> {
  const cfg = resolveConfig(options)
  const r = await requestToken(cfg.tokenUrl, new URLSearchParams({
    grant_type: 'refresh_token', refresh_token: refreshToken, client_id: cfg.clientId, resource: cfg.resource,
  }))
  return toTokens(r)
}
