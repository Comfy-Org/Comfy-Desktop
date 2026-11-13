import { lifetimeSecondsOf, subjectOf, workspaceIdOf } from './claims'

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
  | 'mint_refused'
  | 'view_requested'

const MINT_DISABLED_CODE = 'oauth_workspace_mint_disabled'
const GRANT_ENDED_CODE = 'oauth_grant_ended'
const MINT_REFUSED_CODE = 'oauth_token_mint_refused'

export type WorkspaceMintOutcome =
  | { kind: 'minted'; token: string; expiresAt: number }
  | { kind: 'unavailable' }
  | { kind: 'unauthorized' }
  | { kind: 'reauthorize'; reason: ReauthorizeReason }
  | { kind: 'refused' }
  | { kind: 'retryable'; retryAfterSeconds?: number }

const REPORTABLE_ERROR_CODES: ReadonlySet<string> = new Set([
  'account_outside_organization',
  'auth_type_not_allowed',
  'insufficient_scope',
  'internal_error',
  'invalid_token',
  'not_found',
  'oauth_derived_mint_refused',
  'oauth_grant_ended',
  'oauth_token_mint_refused',
  'oauth_workspace_mint_disabled',
  'partner_node_job_ended',
  'partner_node_renew_disabled',
  'partner_node_requires_sign_in',
  'partner_node_session_ended',
  'partner_node_session_expired',
  'partner_node_session_revoked',
  'partner_node_token_disabled',
  'personal_workspace_disabled',
  'rate_limited',
  'resource_invalid',
  'session_expired',
  'sso_required',
  'token_revoked',
  'unauthorized'
])
const UNLISTED_ERROR_CODE = 'other'

function reportableErrorCode(code: string): string {
  const known = code.toLowerCase()
  return REPORTABLE_ERROR_CODES.has(known) ? known : UNLISTED_ERROR_CODE
}

export type MintFailureReport =
  | { reason: 'network' }
  | { reason: 'http'; http_status: number; error_code?: string }

export function mintFailureReport(
  failure: Extract<WorkspaceTokenMint, { kind: 'failed' }>
): MintFailureReport {
  if (failure.status === null) return { reason: 'network' }
  const { status, code } = failure
  return code
    ? { reason: 'http', http_status: status, error_code: reportableErrorCode(code) }
    : { reason: 'http', http_status: status }
}

export type MintedTokenProblem = 'workspace_mismatch' | 'subject_mismatch'

export function mintedTokenProblem(
  token: string,
  workspaceId: string,
  subject: string | null
): MintedTokenProblem | null {
  if (workspaceIdOf(token) !== workspaceId) return 'workspace_mismatch'
  return subjectOf(token) === subject ? null : 'subject_mismatch'
}

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
  if (status === 403 && code === MINT_REFUSED_CODE)
    return { kind: 'reauthorize', reason: 'mint_refused' }
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

export function mintWorkspaceToken(
  accessToken: string,
  workspaceId: string,
  options: MintWorkspaceTokenOptions = {}
): Promise<WorkspaceTokenMint> {
  return postForToken('/auth/token', accessToken, { workspace_id: workspaceId }, options)
}

export function mintPartnerNodeToken(
  accessToken: string,
  workspaceId: string,
  options: MintWorkspaceTokenOptions = {}
): Promise<WorkspaceTokenMint> {
  return postForToken(
    '/auth/token',
    accessToken,
    { workspace_id: workspaceId, resource: 'partner-node' },
    options
  )
}

export function renewPartnerNodeToken(
  partnerNodeToken: string,
  options: MintWorkspaceTokenOptions = {}
): Promise<WorkspaceTokenMint> {
  return postForToken('/auth/partner-node/renew', partnerNodeToken, undefined, options)
}

async function postForToken(
  route: string,
  bearer: string,
  body: Record<string, string> | undefined,
  options: MintWorkspaceTokenOptions
): Promise<WorkspaceTokenMint> {
  const base = (options.apiBase ?? CLOUD_CONFIG.apiBase).replace(/\/+$/, '')
  const requestedAt = Date.now()
  let res: Response
  try {
    res = await fetch(`${base}${route}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${bearer}`
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    })
  } catch {
    return { kind: 'failed', status: null }
  }
  const reply: unknown = await res.json().catch(() => null)
  if (res.ok) return mintedFrom(reply, requestedAt) ?? { kind: 'failed', status: res.status }
  const code = errorCodeOf(reply)
  const retryAfterSeconds = retryAfterSecondsOf(res)
  return {
    kind: 'failed',
    status: res.status,
    ...(code === undefined ? {} : { code }),
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds })
  }
}
