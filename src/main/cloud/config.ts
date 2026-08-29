/**
 * Cloud OAuth + API config. Defaults to prod; `COMFY_CLOUD_ISSUER` overrides the
 * issuer (e.g. `https://stagingcloud.comfy.org`) for staging or a mock. The
 * issuer serves both OAuth (`/oauth/*`) and the workspace API (`/api/workspaces`).
 */
const DEFAULT_ISSUER = 'https://cloud.comfy.org'
const DEFAULT_CLIENT_ID = 'comfy-desktop'

export const CLOUD_ISSUER = process.env.COMFY_CLOUD_ISSUER || DEFAULT_ISSUER

export const CLOUD_CONFIG = {
  issuer: CLOUD_ISSUER,
  authorizeUrl: `${CLOUD_ISSUER}/oauth/authorize`,
  tokenUrl: `${CLOUD_ISSUER}/oauth/token`,
  jwksUrl: `${CLOUD_ISSUER}/.well-known/jwks.json`,
  /** Workspace REST base (same host as the issuer). */
  apiBase: `${CLOUD_ISSUER}/api`,
  clientId: process.env.COMFY_CLOUD_CLIENT_ID || DEFAULT_CLIENT_ID,
  scope: 'comfy-cloud:user:read',
  resource: `${CLOUD_ISSUER}/api`,
  audience: 'comfy-cloud'
} as const
