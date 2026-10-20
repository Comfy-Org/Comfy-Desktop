/**
 * PKCE authorization-code flow (RFC 8252): bind a loopback redirect, open the
 * system browser at the authorize URL, wait for the callback code, exchange it
 * for tokens. `signIn` optionally pre-selects a workspace (the switch path).
 */
import { shell } from 'electron'

import { statusFromAccessToken, subjectOf, workspaceIdOf } from './claims'
import { CLOUD_CONFIG } from './config'
import { startLoopbackListener } from './loopback'
import {
  buildAuthorizeUrl,
  codeChallengeFromVerifier,
  generateCodeVerifier,
  generateState
} from './pkce'
import { SignInFailure } from './signInFailure'
import type { AuthStatus, AuthTokens } from './types'

/** Matches ingest's OAuth request TTL; a first SSO sign-in runs well past 2 min. */
const DEFAULT_SIGN_IN_TIMEOUT_MS = 600_000
const TOKEN_REQUEST_TIMEOUT_MS = 15_000

export interface OAuthOptions {
  grantMode?: 'account'
  authorizeUrl?: string
  tokenUrl?: string
  clientId?: string
  scope?: string
  resource?: string
  timeoutMs?: number
  /** Pre-select this workspace at consent time. */
  workspaceId?: string
  /** Receives the authorize URL, so a retry can reopen the same pending flow. */
  onAuthorizeUrl?: (url: string) => void
}

interface TokenResponse {
  grant_mode?: 'workspace' | 'account'
  access_token: string
  refresh_token?: string
  expires_in: number
}

function resolveConfig(
  o: OAuthOptions
): Required<Omit<OAuthOptions, 'workspaceId' | 'onAuthorizeUrl' | 'grantMode'>> {
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
function toTokens(
  r: TokenResponse,
  account: boolean,
  workspaceId?: string,
  fallbackRefresh?: string
): AuthTokens {
  if ((r.grant_mode === 'account') !== account) {
    throw new SignInFailure(
      'OAuth response does not match the requested grant mode',
      'server_error'
    )
  }
  if (
    account &&
    (!r.refresh_token ||
      !subjectOf(r.access_token) ||
      !workspaceIdOf(r.access_token) ||
      (workspaceId !== undefined && workspaceIdOf(r.access_token) !== workspaceId))
  ) {
    throw new SignInFailure(
      'OAuth account response has invalid credentials or workspace',
      'server_error'
    )
  }
  return {
    ...(account ? { grantMode: 'account' as const } : {}),
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
    }).catch((cause: unknown) => {
      throw new SignInFailure(
        `OAuth token request failed: ${String(cause)}`,
        controller.signal.aborted ? 'timeout' : 'network',
        { cause }
      )
    })
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '')
      throw new SignInFailure(
        `OAuth token request failed: ${resp.status} ${detail || resp.statusText}`,
        'server_error',
        { httpStatus: resp.status }
      )
    }
    const data = (await resp.json().catch((cause: unknown) => {
      throw new SignInFailure(
        'OAuth token response was not valid JSON',
        controller.signal.aborted ? 'timeout' : 'server_error',
        { cause }
      )
    })) as Partial<TokenResponse> | null
    if (typeof data !== 'object' || data === null) {
      throw new SignInFailure('OAuth token response was not an object', 'server_error')
    }
    if (typeof data.access_token !== 'string' || data.access_token.length === 0) {
      throw new SignInFailure('OAuth token response missing access_token', 'server_error')
    }
    if (typeof data.expires_in !== 'number' || !Number.isFinite(data.expires_in)) {
      throw new SignInFailure('OAuth token response missing a valid expires_in', 'server_error')
    }
    if (
      (data.grant_mode !== undefined &&
        data.grant_mode !== 'workspace' &&
        data.grant_mode !== 'account') ||
      (data.refresh_token !== undefined &&
        (typeof data.refresh_token !== 'string' || !data.refresh_token))
    ) {
      throw new SignInFailure(
        'OAuth token response has an invalid grant or refresh token',
        'server_error'
      )
    }
    return data as TokenResponse
  } finally {
    clearTimeout(timer)
  }
}

async function accountGrantsSupported(authorizeUrl: string, clientId: string): Promise<boolean> {
  if (clientId !== 'comfy-desktop') return false
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TOKEN_REQUEST_TIMEOUT_MS)
  try {
    const url = new URL('/.well-known/oauth-authorization-server', authorizeUrl)
    const response = await fetch(url.toString(), { signal: controller.signal })
    if (response.status === 404) return false
    if (!response.ok) {
      throw new SignInFailure('OAuth capability request failed', 'server_error', {
        httpStatus: response.status
      })
    }
    const data: unknown = await response.json().catch((cause: unknown) => {
      throw new SignInFailure(
        'OAuth capability response was not valid JSON',
        controller.signal.aborted ? 'timeout' : 'server_error',
        { cause }
      )
    })
    if (
      typeof data !== 'object' ||
      data === null ||
      Array.isArray(data) ||
      ('desktop_account_grants_supported' in data &&
        typeof data.desktop_account_grants_supported !== 'boolean')
    ) {
      throw new SignInFailure('OAuth capability response was invalid', 'server_error')
    }
    return (
      'desktop_account_grants_supported' in data && data.desktop_account_grants_supported === true
    )
  } catch (cause) {
    if (cause instanceof SignInFailure) throw cause
    throw new SignInFailure(
      'OAuth capability request failed',
      controller.signal.aborted ? 'timeout' : 'network',
      { cause }
    )
  } finally {
    clearTimeout(timer)
  }
}

/** System browser only (RFC 8252): never an embedded window/webview. */
export function openAuthorizePage(authorizeUrl: string): Promise<void> {
  return shell.openExternal(authorizeUrl)
}

export async function signIn(
  options: OAuthOptions = {}
): Promise<{ tokens: AuthTokens; status: AuthStatus }> {
  const cfg = resolveConfig(options)
  const account = await accountGrantsSupported(cfg.authorizeUrl, cfg.clientId)
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
      ...(account
        ? { grantMode: 'account' as const }
        : options.workspaceId
          ? { workspaceId: options.workspaceId }
          : {})
    })
    options.onAuthorizeUrl?.(authorizeUrl)
    // Never gate the flow on openExternal settling: a wedged shell handler
    // (seen on Windows) can leave that promise pending forever, which would
    // strand the single-flight login and disable sign-in in every window.
    // The loopback callback timeout is the flow's deadline; a fast
    // openExternal rejection (no browser handler) still fails immediately.
    const { code } = await Promise.race([
      listener.waitForCode(),
      openAuthorizePage(authorizeUrl).then(
        () => listener.waitForCode(),
        (cause: unknown) => {
          throw new SignInFailure(
            cause instanceof Error ? cause.message : String(cause),
            'browser_unavailable',
            { cause }
          )
        }
      )
    ])

    const r = await requestToken(
      cfg.tokenUrl,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: listener.redirectUri,
        client_id: cfg.clientId,
        code_verifier: codeVerifier,
        resource: cfg.resource,
        ...(account && options.workspaceId ? { workspace_id: options.workspaceId } : {})
      })
    )
    return {
      tokens: toTokens(r, account, options.workspaceId),
      status: statusFromAccessToken(r.access_token)
    }
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
      resource: cfg.resource,
      ...(options.workspaceId ? { workspace_id: options.workspaceId } : {})
    })
  )
  return toTokens(r, options.grantMode === 'account', options.workspaceId, refreshToken)
}
