import { randomBytes } from 'node:crypto'

export {
  codeChallengeS256 as codeChallengeFromVerifier,
  createCodeVerifier as generateCodeVerifier
} from '../lib/pkce'

export function generateState(): string {
  return randomBytes(32).toString('base64url')
}

export interface BuildAuthorizeUrlParams {
  authorizeUrl: string
  clientId: string
  redirectUri: string
  scope: string
  resource?: string
  state: string
  codeChallenge: string
  /** Pre-select a workspace at consent time (the switch-workspace path). */
  workspaceId?: string
}

export function buildAuthorizeUrl(p: BuildAuthorizeUrlParams): string {
  const url = new URL(p.authorizeUrl)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', p.clientId)
  url.searchParams.set('redirect_uri', p.redirectUri)
  url.searchParams.set('scope', p.scope)
  if (p.resource) url.searchParams.set('resource', p.resource)
  url.searchParams.set('state', p.state)
  url.searchParams.set('code_challenge', p.codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  if (p.workspaceId) url.searchParams.set('workspace_id', p.workspaceId)
  return url.toString()
}
