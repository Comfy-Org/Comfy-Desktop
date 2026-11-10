import { Buffer } from 'node:buffer'

import { WORKSPACE_MINT_SCOPE } from './config'
import type { AuthStatus } from './types'

interface AccessTokenClaims {
  sub?: string
  email?: string
  workspace_id?: string
  workspace_type?: string
  role?: string
  scope?: string
  iat?: unknown
  exp?: unknown
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

export function workspaceIdOf(accessToken: string): string | null {
  return decodeJwtPayload(accessToken)?.workspace_id ?? null
}

export function canMintWorkspaceTokens(accessToken: string): boolean {
  const scope = decodeJwtPayload(accessToken)?.scope
  return typeof scope === 'string' && scope.split(' ').includes(WORKSPACE_MINT_SCOPE)
}

export function lifetimeSecondsOf(accessToken: string): number | null {
  const { iat, exp } = decodeJwtPayload(accessToken) ?? {}
  if (typeof iat !== 'number' || typeof exp !== 'number') return null
  const lifetime = exp - iat
  return Number.isFinite(lifetime) ? lifetime : null
}

export function subjectOf(accessToken: string): string | null {
  return decodeJwtPayload(accessToken)?.sub ?? null
}

export interface TokenIdentity {
  userId: string
  email?: string
  workspaceId?: string
}

export function identityOf(accessToken: string): TokenIdentity | null {
  const claims = decodeJwtPayload(accessToken)
  if (!claims?.sub) return null
  return {
    userId: claims.sub,
    ...(claims.email ? { email: claims.email } : {}),
    ...(claims.workspace_id ? { workspaceId: claims.workspace_id } : {})
  }
}
