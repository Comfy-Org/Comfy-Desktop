import { Buffer } from 'node:buffer'

import type { AuthStatus } from './types'

/** Claims read (never verified here; the server does that) from the access-token JWT. */
interface AccessTokenClaims {
  email?: string
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

/** Signed-in status from an access token's claims. A malformed token still counts
 *  as signed in; the identity fields just stay unset. */
export function statusFromAccessToken(accessToken: string): AuthStatus {
  const claims = decodeJwtPayload(accessToken)
  return {
    signedIn: true,
    email: claims?.email,
    workspaceId: claims?.workspace_id,
    workspaceType: claims?.workspace_type,
    role: claims?.role,
  }
}

/** The workspace id a token is scoped to, or null. Used to detect a scope switch. */
export function workspaceIdOf(accessToken: string): string | null {
  return decodeJwtPayload(accessToken)?.workspace_id ?? null
}
