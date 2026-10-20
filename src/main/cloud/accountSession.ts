import { app, net } from 'electron'

import {
  createDesktopLoginCode,
  DesktopLoginCodeError,
  type DesktopLoginCodeGrant,
  postJson
} from '../auth/desktopLoginCode/client'
import { abortableSleep } from '../auth/firebaseBridge/flowControl'
import { CLOUD_CONFIG } from './config'
import { openAuthorizePage } from './oauth'
import { codeChallengeFromVerifier, generateCodeVerifier } from './pkce'
import { SignInFailure } from './signInFailure'
import type { AuthTokens } from './types'

export async function signInAccount(
  onAuthorizeUrl: (url: string) => void,
  signal: AbortSignal
): Promise<AuthTokens> {
  const verifier = generateCodeVerifier()
  const grant = await createDesktopLoginCode(
    CLOUD_CONFIG.issuer,
    {
      platform: process.platform,
      app_version: app.getVersion(),
      code_challenge: codeChallengeFromVerifier(verifier),
      session_type: 'account'
    },
    { signal }
  )
  if (!grant.code.startsWith('dls_')) {
    throw new SignInFailure('Account login is unavailable on this server', 'server_error')
  }
  const url = new URL('/cloud/login', CLOUD_CONFIG.issuer)
  url.searchParams.set('desktop_login_code', grant.code)
  onAuthorizeUrl(url.href)
  const expiry = AbortSignal.timeout(grant.expires_in * 1000)
  const deadline = AbortSignal.any([signal, expiry])
  const polling = new AbortController()
  try {
    const account = pollForAccountSession(
      grant,
      verifier,
      AbortSignal.any([deadline, polling.signal])
    )
    return await Promise.race([
      account,
      openAuthorizePage(url.href).then(
        () => account,
        () => {
          throw new SignInFailure('Could not open the browser', 'browser_unavailable')
        }
      )
    ])
  } catch (error) {
    if (expiry.aborted && !signal.aborted) {
      throw new SignInFailure('Sign-in timed out', 'timeout')
    }
    throw error
  } finally {
    polling.abort()
  }
}

async function pollForAccountSession(
  grant: DesktopLoginCodeGrant,
  verifier: string,
  deadline: AbortSignal
): Promise<AuthTokens> {
  while (!deadline.aborted) {
    await abortableSleep(grant.poll_interval * 1000, deadline)
    let response
    try {
      response = await postJson(
        `${CLOUD_CONFIG.apiBase}/auth/desktop-login-codes/exchange`,
        { code: grant.code, code_verifier: verifier },
        { signal: deadline }
      )
    } catch (error) {
      if (error instanceof DesktopLoginCodeError && error.retryable) continue
      throw error
    }
    if (response.status >= 500 || response.status === 429 || response.status === 408) continue
    if (!response.ok) {
      throw new SignInFailure('Restart sign-in to continue', 'server_error', {
        httpStatus: response.status
      })
    }
    const data = response.data
    if (data && typeof data === 'object' && 'status' in data && data.status === 'pending') continue
    if (
      !data ||
      typeof data !== 'object' ||
      !('status' in data) ||
      data.status !== 'complete' ||
      !('session_token' in data) ||
      typeof data.session_token !== 'string' ||
      !data.session_token.startsWith('comfy-session-')
    ) {
      throw new SignInFailure('Invalid account login response', 'server_error')
    }
    try {
      return await mintWorkspaceToken(data.session_token, undefined, deadline)
    } catch (error) {
      await revokeAccountSession(data.session_token).catch(() => {})
      throw error
    }
  }
  throw new SignInFailure('Sign-in timed out', 'timeout')
}

async function sessionRequest(
  sessionToken: string,
  path: string,
  method: string,
  body?: unknown,
  signal?: AbortSignal
): Promise<unknown> {
  const timeout = AbortSignal.timeout(15_000)
  try {
    const response = await net.fetch(`${CLOUD_CONFIG.apiBase}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        'Content-Type': 'application/json'
      },
      credentials: 'omit',
      redirect: 'error',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
    if (!response.ok) {
      throw new SignInFailure('Account session request failed', 'server_error', {
        httpStatus: response.status
      })
    }
    return response.status === 204 ? undefined : await response.json()
  } catch (error) {
    if (signal?.aborted || error instanceof SignInFailure) throw error
    throw new SignInFailure('Account session request failed', 'server_error')
  }
}

export async function mintWorkspaceToken(
  sessionToken: string,
  workspaceId?: string,
  signal?: AbortSignal
): Promise<AuthTokens> {
  const data = await sessionRequest(
    sessionToken,
    '/auth/token',
    'POST',
    { workspace_id: workspaceId },
    signal
  )
  return mintedTokens(data, sessionToken)
}

function mintedTokens(data: unknown, sessionToken: string): AuthTokens {
  if (
    !data ||
    typeof data !== 'object' ||
    !('token' in data) ||
    typeof data.token !== 'string' ||
    data.token.length === 0 ||
    !('expires_at' in data) ||
    typeof data.expires_at !== 'string' ||
    !Number.isFinite(Date.parse(data.expires_at)) ||
    Date.parse(data.expires_at) <= Date.now()
  ) {
    throw new SignInFailure('Invalid workspace token response', 'server_error')
  }
  return { accessToken: data.token, expiresAt: Date.parse(data.expires_at), sessionToken }
}

export async function mintPartnerNodeToken(
  sessionToken: string,
  workspaceId: string
): Promise<AuthTokens> {
  const data = await sessionRequest(sessionToken, '/auth/token', 'POST', {
    workspace_id: workspaceId,
    resource: 'partner-node'
  })
  return mintedTokens(data, sessionToken)
}

export async function revokeAccountSession(sessionToken: string): Promise<void> {
  try {
    await sessionRequest(sessionToken, '/auth/token/revoke', 'POST')
  } finally {
    await sessionRequest(sessionToken, '/auth/session', 'DELETE')
  }
}
