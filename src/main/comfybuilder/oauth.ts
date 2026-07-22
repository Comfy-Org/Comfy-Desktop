import { shell } from 'electron'

import { statusFromAccessToken } from './claims'
import { OAUTH_CONFIG } from './config'
import { startLoopbackListener } from './loopbackServer'
import {
  buildAuthorizeUrl,
  codeChallengeFromVerifier,
  generateCodeVerifier,
  generateState,
} from './pkce'
import type { AuthStatus, AuthTokens } from './types'

/** Default browser-callback wait: long enough for a real user to complete sign-in. */
const DEFAULT_SIGN_IN_TIMEOUT_MS = 120_000

/** Bound on the token-endpoint exchange so a stalled request can't hang sign-in forever. */
const TOKEN_REQUEST_TIMEOUT_MS = 15_000

/**
 * OAuth endpoint / parameter overrides. Production leaves these unset and
 * inherits {@link OAUTH_CONFIG}; tests point them at a mock issuer and shorten
 * the timeout.
 */
export interface OAuthOptions {
  authorizeUrl?: string
  tokenUrl?: string
  clientId?: string
  scope?: string
  resource?: string
  /** How long to wait for the loopback callback before failing. Defaults to 120s. */
  timeoutMs?: number
}

interface ResolvedOAuthConfig {
  authorizeUrl: string
  tokenUrl: string
  clientId: string
  scope: string
  resource: string
  timeoutMs: number
}

/** Successful OAuth token-endpoint response body. */
interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
}

function resolveConfig(options: OAuthOptions): ResolvedOAuthConfig {
  return {
    authorizeUrl: options.authorizeUrl ?? OAUTH_CONFIG.authorizeUrl,
    tokenUrl: options.tokenUrl ?? OAUTH_CONFIG.tokenUrl,
    clientId: options.clientId ?? OAUTH_CONFIG.clientId,
    scope: options.scope ?? OAUTH_CONFIG.scope,
    resource: options.resource ?? OAUTH_CONFIG.resource,
    timeoutMs: options.timeoutMs ?? DEFAULT_SIGN_IN_TIMEOUT_MS,
  }
}

function toAuthTokens(response: TokenResponse): AuthTokens {
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    expiresAt: Date.now() + response.expires_in * 1000,
  }
}

async function requestToken(tokenUrl: string, body: URLSearchParams): Promise<TokenResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TOKEN_REQUEST_TIMEOUT_MS)
  let resp: Response
  try {
    resp = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '')
    throw new Error(`OAuth token request failed: ${resp.status} ${detail || resp.statusText}`)
  }
  return (await resp.json()) as TokenResponse
}

/**
 * Run the PKCE authorization-code flow: bind a loopback redirect listener, open
 * the system browser at the authorize URL, wait for the callback code, then
 * exchange it for tokens. Returns the tokens plus the signed-in status decoded
 * from the access-token JWT.
 */
export async function signIn(
  options: OAuthOptions = {},
): Promise<{ tokens: AuthTokens; status: AuthStatus }> {
  const config = resolveConfig(options)

  const codeVerifier = generateCodeVerifier()
  const codeChallenge = codeChallengeFromVerifier(codeVerifier)
  const state = generateState()

  const listener = await startLoopbackListener({
    expectedState: state,
    timeoutMs: config.timeoutMs,
  })

  const authorizeUrl = buildAuthorizeUrl({
    authorizeUrl: config.authorizeUrl,
    clientId: config.clientId,
    redirectUri: listener.redirectUri,
    scope: config.scope,
    resource: config.resource,
    state,
    codeChallenge,
  })

  // System browser only (RFC 8252) — never an embedded BrowserWindow/webview.
  await shell.openExternal(authorizeUrl)

  const { code } = await listener.waitForCode()

  const response = await requestToken(
    config.tokenUrl,
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: listener.redirectUri,
      client_id: config.clientId,
      code_verifier: codeVerifier,
      // Selects the target resource server and the minted `aud`; required.
      resource: config.resource,
    }),
  )

  return { tokens: toAuthTokens(response), status: statusFromAccessToken(response.access_token) }
}

/** Exchange a refresh token for a fresh access token (and rotated refresh token). */
export async function refresh(
  refreshToken: string,
  options: OAuthOptions = {},
): Promise<AuthTokens> {
  const config = resolveConfig(options)
  const response = await requestToken(
    config.tokenUrl,
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: config.clientId,
      resource: config.resource,
    }),
  )
  return toAuthTokens(response)
}
