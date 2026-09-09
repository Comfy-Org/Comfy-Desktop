/**
 * PKCE authorization-code flow (RFC 8252): bind a loopback redirect, open the
 * system browser at the authorize URL, wait for the callback code, exchange it
 * for tokens. `signIn` optionally pre-selects a workspace (the switch path).
 */
import { shell } from 'electron'

import { statusFromAccessToken } from './claims'
import { CLOUD_CONFIG } from './config'
import { startLoopbackListener } from './loopback'
import {
  buildAuthorizeUrl,
  codeChallengeFromVerifier,
  generateCodeVerifier,
  generateState
} from './pkce'
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
    timeoutMs: o.timeoutMs ?? DEFAULT_SIGN_IN_TIMEOUT_MS
  }
}

/** Build tokens, keeping the prior refresh token when the server omits one
 *  (RFC 6749 §6: refresh_token is optional on a refresh grant). */
function toTokens(r: TokenResponse, fallbackRefresh?: string): AuthTokens {
  return {
    accessToken: r.access_token,
    refreshToken: r.refresh_token ?? fallbackRefresh,
    expiresAt: Date.now() + r.expires_in * 1000
  }
}

async function requestToken(tokenUrl: string, body: URLSearchParams): Promise<TokenResponse> {
  const controller = new AbortController()
  // Keep the abort armed until the body is fully read, so a slow/unbounded body
  // can't hang the flow after the response headers arrive.
  const timer = setTimeout(() => controller.abort(), TOKEN_REQUEST_TIMEOUT_MS)
  try {
    const resp = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: controller.signal
    })
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '')
      throw new Error(`OAuth token request failed: ${resp.status} ${detail || resp.statusText}`)
    }
    const data = (await resp.json()) as Partial<TokenResponse>
    if (typeof data.access_token !== 'string' || data.access_token.length === 0) {
      throw new Error('OAuth token response missing access_token')
    }
    if (typeof data.expires_in !== 'number' || !Number.isFinite(data.expires_in)) {
      throw new Error('OAuth token response missing a valid expires_in')
    }
    return data as TokenResponse
  } finally {
    clearTimeout(timer)
  }
}

export async function signIn(
  options: OAuthOptions = {}
): Promise<{ tokens: AuthTokens; status: AuthStatus }> {
  const cfg = resolveConfig(options)
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = codeChallengeFromVerifier(codeVerifier)
  const state = generateState()

  const listener = await startLoopbackListener({ expectedState: state, timeoutMs: cfg.timeoutMs })
  try {
    const authorizeUrl = buildAuthorizeUrl({
      authorizeUrl: cfg.authorizeUrl,
      clientId: cfg.clientId,
      redirectUri: listener.redirectUri,
      scope: cfg.scope,
      resource: cfg.resource,
      state,
      codeChallenge,
      ...(options.workspaceId ? { workspaceId: options.workspaceId } : {})
    })
    // System browser only (RFC 8252): never an embedded window/webview.
    // Never gate the flow on openExternal settling: a wedged shell handler
    // (seen on Windows) can leave that promise pending forever, which would
    // strand the single-flight login and disable sign-in in every window.
    // The loopback callback timeout is the flow's deadline; a fast
    // openExternal rejection (no browser handler) still fails immediately.
    const { code } = await Promise.race([
      listener.waitForCode(),
      shell.openExternal(authorizeUrl).then(() => listener.waitForCode())
    ])

    const r = await requestToken(
      cfg.tokenUrl,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: listener.redirectUri,
        client_id: cfg.clientId,
        code_verifier: codeVerifier,
        resource: cfg.resource
      })
    )
    return { tokens: toTokens(r), status: statusFromAccessToken(r.access_token) }
  } finally {
    // Always tear the listener down, even if openExternal or waitForCode threw,
    // so a failed sign-in never leaks a listening socket until the timeout.
    listener.close()
  }
}

export async function refresh(
  refreshToken: string,
  options: OAuthOptions = {}
): Promise<AuthTokens> {
  const cfg = resolveConfig(options)
  const r = await requestToken(
    cfg.tokenUrl,
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: cfg.clientId,
      resource: cfg.resource
    })
  )
  return toTokens(r, refreshToken)
}
