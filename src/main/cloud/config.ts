const DEFAULT_ISSUER = 'https://cloud.comfy.org'
const DEFAULT_CLIENT_ID = 'comfy-desktop'

export const CLOUD_REFRESH_TOKEN_LIFETIME_MS = 720 * 60 * 60_000

export const WORKSPACE_MINT_SCOPE = 'comfy-cloud:workspace-token:mint'

export const CLOUD_ISSUER = process.env.COMFY_CLOUD_ISSUER || DEFAULT_ISSUER

export function revokeUrlOf(issuer: string): string {
  return `${issuer}/oauth/revoke`
}

export const CLOUD_CONFIG = {
  issuer: CLOUD_ISSUER,
  authorizeUrl: `${CLOUD_ISSUER}/oauth/authorize`,
  tokenUrl: `${CLOUD_ISSUER}/oauth/token`,
  revokeUrl: revokeUrlOf(CLOUD_ISSUER),
  jwksUrl: `${CLOUD_ISSUER}/.well-known/jwks.json`,
  apiBase: `${CLOUD_ISSUER}/api`,
  clientId: process.env.COMFY_CLOUD_CLIENT_ID || DEFAULT_CLIENT_ID,
  scope: `comfy-cloud:user:read ${WORKSPACE_MINT_SCOPE}`,
  resource: `${CLOUD_ISSUER}/api`,
  audience: 'comfy-cloud'
} as const
