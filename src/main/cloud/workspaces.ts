/**
 * Workspace client: list the workspaces a signed-in user belongs to.
 *
 * `GET {apiBase}/workspaces` (the ingest service) returns the caller's
 * workspaces. Switching the ACTIVE workspace is a re-auth, not a call here (a
 * PKCE cloud token is scoped at consent time and cannot be silently re-scoped);
 * `CloudSession.switchWorkspace` drives that. This module is read-only listing.
 */
import { net } from 'electron'

import { CLOUD_CONFIG } from './config'
import type { Workspace } from './types'

const DEFAULT_TIMEOUT_MS = 20_000

interface WorkspaceRow {
  id: string
  name: string
  type: string
  role: string
  subscription_tier?: string
  created_at?: string
  joined_at?: string
}

export interface ListWorkspacesOptions {
  /** Cloud API base. Defaults to the configured issuer's `/api`. */
  apiBase?: string
  timeoutMs?: number
}

/**
 * List the signed-in user's workspaces. Returns `[]` when the team-workspaces
 * feature is off (the endpoint 404s), since the token's own workspace is then
 * the only one and is already active.
 */
export async function listWorkspaces(
  accessToken: string,
  options: ListWorkspacesOptions = {}
): Promise<Workspace[]> {
  const base = (options.apiBase ?? CLOUD_CONFIG.apiBase).replace(/\/+$/, '')
  // net.fetch (Chromium's stack), not Node's undici: it resolves the OS proxy,
  // which is how enterprise users behind a corporate proxy reach the cloud API
  // at all. credentials 'omit' keeps the bearer the only credential sent.
  const res = await net.fetch(`${base}/workspaces`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    credentials: 'omit'
  })
  if (res.status === 404) return []
  if (res.status === 401 || res.status === 403) throw new Error('Not authorized to list workspaces')
  if (!res.ok) throw new Error(`List workspaces failed: HTTP ${res.status}`)
  const body: unknown = await res.json().catch(() => null)
  const rows =
    body && typeof body === 'object'
      ? (body as { workspaces?: WorkspaceRow[] }).workspaces
      : undefined
  return (rows ?? []).map((w) => ({
    id: w.id,
    name: w.name,
    type: w.type,
    role: w.role,
    ...(w.subscription_tier ? { subscriptionTier: w.subscription_tier } : {}),
    ...(w.created_at ? { createdAt: w.created_at } : {}),
    ...(w.joined_at ? { joinedAt: w.joined_at } : {})
  }))
}
