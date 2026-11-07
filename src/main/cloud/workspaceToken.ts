/**
 * Workspace token mint: `POST {apiBase}/auth/token` with Desktop's OAuth access
 * token as the Bearer. The minted Cloud JWT is what a local ComfyUI view may
 * hold; the OAuth access token stays in main.
 */
import { CLOUD_CONFIG } from './config'

const DEFAULT_TIMEOUT_MS = 20_000
const OAUTH_MINT_REFUSED = 'oauth_token_mint_refused'

/** `refused`: Cloud does not let this grant mint a workspace token at all. */
export type WorkspaceTokenMint =
  | { kind: 'minted'; token: string; expiresAt: number }
  | { kind: 'refused' }
  | { kind: 'failed'; status: number | null }

export interface MintWorkspaceTokenOptions {
  apiBase?: string
  timeoutMs?: number
}

function mintedFrom(body: unknown): WorkspaceTokenMint | null {
  if (!body || typeof body !== 'object') return null
  const { token, expires_at: expiresAt } = body as { token?: unknown; expires_at?: unknown }
  if (typeof token !== 'string' || token === '' || typeof expiresAt !== 'string') return null
  const expiresAtMs = Date.parse(expiresAt)
  return Number.isFinite(expiresAtMs) ? { kind: 'minted', token, expiresAt: expiresAtMs } : null
}

function errorCodeOf(body: unknown): unknown {
  return body && typeof body === 'object' ? (body as { code?: unknown }).code : undefined
}

export async function mintWorkspaceToken(
  accessToken: string,
  workspaceId: string,
  options: MintWorkspaceTokenOptions = {}
): Promise<WorkspaceTokenMint> {
  const base = (options.apiBase ?? CLOUD_CONFIG.apiBase).replace(/\/+$/, '')
  let res: Response
  try {
    res = await fetch(`${base}/auth/token`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({ workspace_id: workspaceId }),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    })
  } catch {
    return { kind: 'failed', status: null }
  }
  const body: unknown = await res.json().catch(() => null)
  if (res.status === 403 && errorCodeOf(body) === OAUTH_MINT_REFUSED) return { kind: 'refused' }
  if (!res.ok) return { kind: 'failed', status: res.status }
  return mintedFrom(body) ?? { kind: 'failed', status: res.status }
}
