const DEFAULT_COMFYBUILDER_BASE_URL = 'https://comfy-builder.fennec-typhon.ts.net'
const DEFAULT_OAUTH_ISSUER = 'https://cloud.comfy.org'
const DEFAULT_OAUTH_CLIENT_ID = 'comfy-desktop'

export const COMFYBUILDER_BASE_URL = process.env.COMFYBUILDER_BASE_URL || DEFAULT_COMFYBUILDER_BASE_URL
export const COMFYBUILDER_API_BASE = `${COMFYBUILDER_BASE_URL}/api/v1`

const OAUTH_ISSUER = DEFAULT_OAUTH_ISSUER
export const OAUTH_CONFIG = {
  issuer: OAUTH_ISSUER,
  authorizeUrl: `${OAUTH_ISSUER}/oauth/authorize`,
  tokenUrl: `${OAUTH_ISSUER}/oauth/token`,
  jwksUrl: `${OAUTH_ISSUER}/.well-known/jwks.json`,
  clientId: process.env.COMFYBUILDER_OAUTH_CLIENT_ID || DEFAULT_OAUTH_CLIENT_ID,
  scope: 'comfy-cloud:user:read',
  resource: `${OAUTH_ISSUER}/api`,
  audience: 'comfy-cloud',
} as const
