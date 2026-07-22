import { Buffer } from 'node:buffer'

import type { AuthStatus } from './types'

/** Claims read (never verified here — the server does that) from the access-token JWT. */
interface AccessTokenClaims {
  email?: string
  workspace_id?: string
  workspace_type?: string
  role?: string
}

/** Decode a JWT payload (the base64url middle segment). Null on any malformed input. */
function decodeJwtPayload(token: string): AccessTokenClaims | null {
  const payloadSegment = token.split('.')[1]
  if (!payloadSegment) return null
  try {
    const json = Buffer.from(payloadSegment, 'base64url').toString('utf-8')
    const parsed: unknown = JSON.parse(json)
    if (!parsed || typeof parsed !== 'object') return null
    return parsed as AccessTokenClaims
  } catch {
    return null
  }
}

/** Renderer-safe signed-in status from an access token's claims. A malformed
 *  token still counts as signed in — the identity fields just stay unset. */
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
