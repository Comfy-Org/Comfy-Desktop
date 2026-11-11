import { app, shell } from 'electron'

import { recordShellOpenExternal } from '../lib/e2eOverrides'
import { statusFromAccessToken } from './claims'
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

const DEFAULT_SIGN_IN_TIMEOUT_MS = 600_000
const TOKEN_REQUEST_TIMEOUT_MS = 15_000

export interface OAuthOptions {
  authorizeUrl?: string
  tokenUrl?: string
  clientId?: string
  scope?: string
  resource?: string
  timeoutMs?: number
  workspaceId?: string
  onAuthorizeUrl?: (url: string) => void
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
}

function resolveConfig(
  o: OAuthOptions
): Required<Omit<OAuthOptions, 'workspaceId' | 'onAuthorizeUrl'>> {
  return {
    authorizeUrl: o.authorizeUrl ?? CLOUD_CONFIG.authorizeUrl,
    tokenUrl: o.tokenUrl ?? CLOUD_CONFIG.tokenUrl,
    clientId: o.clientId ?? CLOUD_CONFIG.clientId,
    scope: o.scope ?? CLOUD_CONFIG.scope,
    resource: o.resource ?? CLOUD_CONFIG.resource,
    timeoutMs: o.timeoutMs ?? DEFAULT_SIGN_IN_TIMEOUT_MS
  }
}

function toTokens(r: TokenResponse, fallbackRefresh?: string): AuthTokens {
  return {
    accessToken: r.access_token,
    refreshToken: r.refresh_token ?? fallbackRefresh,
    expiresAt: Date.now() + r.expires_in * 1000
  }
}

function oauthErrorOf(body: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(body)
    const error =
      parsed && typeof parsed === 'object' ? (parsed as { error?: unknown }).error : null
    return typeof error === 'string' ? error : undefined
  } catch {
    return undefined
  }
}

async function requestToken(tokenUrl: string, body: URLSearchParams): Promise<TokenResponse> {
  const controller = new AbortController()
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
        { httpStatus: resp.status, oauthError: oauthErrorOf(detail) }
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
    return data as TokenResponse
  } finally {
    clearTimeout(timer)
  }
}

export function openAuthorizePage(authorizeUrl: string): Promise<void> {
  if (process.env['E2E'] === '1' && !app.isPackaged) {
    recordShellOpenExternal(authorizeUrl)
    return Promise.resolve()
  }
  return shell.openExternal(authorizeUrl)
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
    options.onAuthorizeUrl?.(authorizeUrl)
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
        resource: cfg.resource
      })
    )
    return { tokens: toTokens(r), status: statusFromAccessToken(r.access_token) }
  } finally {
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
