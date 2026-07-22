import { Buffer } from 'node:buffer'

import { shell } from 'electron'

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

/** Claims read (never verified here — the server does that) from the access-token JWT. */
interface AccessTokenClaims {
  email?: string
  workspace_id?: string
  workspace_type?: string
  role?: string
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

/**
 * Decode the JWT payload segment (base64url) into an {@link AuthStatus}. The
 * signature is verified server-side, so we only parse the claims for display.
 */
function decodeAuthStatus(accessToken: string): AuthStatus {
  const payloadSegment = accessToken.split('.')[1] ?? ''
  const claims = JSON.parse(Buffer.from(payloadSegment, 'base64url').toString()) as AccessTokenClaims
  return {
    signedIn: true,
    email: claims.email,
    workspaceId: claims.workspace_id,
    workspaceType: claims.workspace_type,
    role: claims.role,
  }
}

async function requestToken(tokenUrl: string, body: URLSearchParams): Promise<TokenResponse> {
  const resp = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
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

  return { tokens: toAuthTokens(response), status: decodeAuthStatus(response.access_token) }
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
