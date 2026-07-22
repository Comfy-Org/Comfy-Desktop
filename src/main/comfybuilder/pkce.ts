import { createHash, randomBytes } from 'crypto'

const CODE_VERIFIER_BYTES = 32
const STATE_BYTES = 32

export function generateCodeVerifier(): string {
  return randomBytes(CODE_VERIFIER_BYTES).toString('base64url')
}

export function codeChallengeFromVerifier(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

export function generateState(): string {
  return randomBytes(STATE_BYTES).toString('base64url')
}

export interface BuildAuthorizeUrlParams {
  authorizeUrl: string
  clientId: string
  redirectUri: string
  scope: string
  resource?: string
  state: string
  codeChallenge: string
}

export function buildAuthorizeUrl({
  authorizeUrl,
  clientId,
  redirectUri,
  scope,
  resource,
  state,
  codeChallenge,
}: BuildAuthorizeUrlParams): string {
  const url = new URL(authorizeUrl)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('scope', scope)
  if (resource) {
    url.searchParams.set('resource', resource)
  }
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}
