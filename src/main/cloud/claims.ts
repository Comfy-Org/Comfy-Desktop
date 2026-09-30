import { Buffer } from 'node:buffer'

import type { AuthStatus } from './types'

/** Claims read (never verified here; the server does that) from the access-token JWT. */
interface AccessTokenClaims {
  sub?: string
  email?: string
  email_verified?: boolean
  workspace_id?: string
  workspace_type?: string
  role?: string
}

function decodeJwtPayload(token: string): AccessTokenClaims | null {
  const segment = token.split('.')[1]
  if (!segment) return null
  try {
    const parsed: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf-8'))
    if (!parsed || typeof parsed !== 'object') return null
    return parsed as AccessTokenClaims
  } catch {
    return null
  }
}

/**
 * Signed-in status from an access token's claims. A malformed token still counts
 * as signed in; the identity fields just stay unset.
 *
 * SECURITY: these claims are NOT signature-verified here (the server verifies the
 * token on every request). Treat `role`/`workspaceId`/`workspaceType` as
 * DISPLAY-ONLY; never gate features or access on them client-side, or a forged
 * local token would grant them.
 */
export function statusFromAccessToken(accessToken: string): AuthStatus {
  const claims = decodeJwtPayload(accessToken)
  return {
    signedIn: true,
    email: claims?.email,
    workspaceId: claims?.workspace_id,
    workspaceType: claims?.workspace_type,
    role: claims?.role
  }
}

/** The workspace id a token is scoped to, or null. Used to detect a scope switch. */
export function workspaceIdOf(accessToken: string): string | null {
  return decodeJwtPayload(accessToken)?.workspace_id ?? null
}

/** The account subject a token belongs to, or null for malformed/legacy tokens. */
export function subjectOf(accessToken: string): string | null {
  return decodeJwtPayload(accessToken)?.sub ?? null
}

/** Who a token belongs to, for handing to the embedded view. Display/identity only, unverified. */
export interface TokenIdentity {
  userId: string
  email?: string
  emailVerified?: boolean
  workspaceId?: string
}

/** Null when the token has no `sub`: without a user id the view cannot key anything on it. */
export function identityOf(accessToken: string): TokenIdentity | null {
  const claims = decodeJwtPayload(accessToken)
  if (!claims?.sub) return null
  return {
    userId: claims.sub,
    ...(claims.email ? { email: claims.email } : {}),
    ...(typeof claims.email_verified === 'boolean' ? { emailVerified: claims.email_verified } : {}),
    ...(claims.workspace_id ? { workspaceId: claims.workspace_id } : {})
  }
}
