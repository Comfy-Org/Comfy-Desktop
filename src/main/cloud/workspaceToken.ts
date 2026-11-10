import { lifetimeSecondsOf } from './claims'

import { CLOUD_CONFIG } from './config'

const DEFAULT_TIMEOUT_MS = 20_000

export type WorkspaceTokenMint =
  | { kind: 'minted'; token: string; expiresAt: number }
  | { kind: 'failed'; status: number | null; code?: string; retryAfterSeconds?: number }

export type ReauthorizeReason =
  | 'sso_required'
  | 'grant_ended'
  | 'mint_scope_missing'
  | 'mint_disabled'

const MINT_DISABLED_CODE = 'oauth_workspace_mint_disabled'
const GRANT_ENDED_CODE = 'oauth_grant_ended'

export type WorkspaceMintOutcome =
  | { kind: 'minted'; token: string; expiresAt: number }
  | { kind: 'unavailable' }
  | { kind: 'unauthorized' }
  | { kind: 'reauthorize'; reason: ReauthorizeReason }
  | { kind: 'refused' }
  | { kind: 'retryable'; retryAfterSeconds?: number }

export function classifyMint(mint: WorkspaceTokenMint): WorkspaceMintOutcome {
  if (mint.kind === 'minted') return mint
  const { status, code, retryAfterSeconds } = mint
  if (status === 503 && code === MINT_DISABLED_CODE)
    return { kind: 'reauthorize', reason: 'mint_disabled' }
  if (status === null || status === 429 || status >= 500 || status < 300) {
    return retryAfterSeconds === undefined
      ? { kind: 'retryable' }
      : { kind: 'retryable', retryAfterSeconds }
  }
  if (status === 401) {
    return code === GRANT_ENDED_CODE
      ? { kind: 'reauthorize', reason: 'grant_ended' }
      : { kind: 'unauthorized' }
  }
  if (status === 404) return { kind: 'unavailable' }
  if (status === 403 && code === 'sso_required')
    return { kind: 'reauthorize', reason: 'sso_required' }
  return { kind: 'refused' }
}

export interface MintWorkspaceTokenOptions {
  apiBase?: string
  timeoutMs?: number
}

function errorCodeOf(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined
  const { code } = body as { code?: unknown }
  return typeof code === 'string' ? code : undefined
}

function retryAfterSecondsOf(res: Response): number | undefined {
  const header = res.headers.get('Retry-After')
  const seconds = header === null || header.trim() === '' ? Number.NaN : Number(header)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined
}

function mintedFrom(body: unknown, requestedAt: number): WorkspaceTokenMint | null {
  if (!body || typeof body !== 'object') return null
  const { token, expires_at: expiresAt } = body as { token?: unknown; expires_at?: unknown }
  if (typeof token !== 'string' || token === '') return null
  const lifetimeSeconds = lifetimeSecondsOf(token)
  if (lifetimeSeconds !== null) {
    const deadline = requestedAt + lifetimeSeconds * 1000
    return lifetimeSeconds > 0 && deadline > Date.now()
      ? { kind: 'minted', token, expiresAt: deadline }
      : null
  }
  if (typeof expiresAt !== 'string') return null
  const expiresAtMs = Date.parse(expiresAt)
  return expiresAtMs > Date.now() ? { kind: 'minted', token, expiresAt: expiresAtMs } : null
}

export async function mintWorkspaceToken(
  accessToken: string,
  workspaceId: string,
  options: MintWorkspaceTokenOptions = {}
): Promise<WorkspaceTokenMint> {
  const base = (options.apiBase ?? CLOUD_CONFIG.apiBase).replace(/\/+$/, '')
  const requestedAt = Date.now()
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
  if (res.ok) return mintedFrom(body, requestedAt) ?? { kind: 'failed', status: res.status }
  const code = errorCodeOf(body)
  const retryAfterSeconds = retryAfterSecondsOf(res)
  return {
    kind: 'failed',
    status: res.status,
    ...(code === undefined ? {} : { code }),
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds })
  }
}
