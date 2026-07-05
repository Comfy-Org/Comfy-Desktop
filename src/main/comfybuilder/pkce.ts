import { createHash, randomBytes } from 'crypto'

const CODE_VERIFIER_BYTES = 32
const STATE_BYTES = 32

function base64url(bytes: Buffer): string {
  return bytes
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

export function generateCodeVerifier(): string {
  return base64url(randomBytes(CODE_VERIFIER_BYTES))
}

export function codeChallengeFromVerifier(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

export function generateState(): string {
  return base64url(randomBytes(STATE_BYTES))
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
