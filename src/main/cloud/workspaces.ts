/**
 * Workspace client: list the workspaces a signed-in user belongs to.
 *
 * `GET {apiBase}/workspaces` (the ingest service) returns the caller's
 * workspaces. Switching the ACTIVE workspace is a re-auth, not a call here (a
 * PKCE cloud token is scoped at consent time and cannot be silently re-scoped);
 * `CloudSession.switchWorkspace` drives that. This module is read-only listing.
 */
import { CLOUD_CONFIG } from './config'
import type { Workspace, WorkspaceMember } from './types'

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

interface WorkspaceMemberRow {
  id: string
  name?: string
  email?: string
  role?: string
  joined_at?: string
  is_original_owner?: boolean
}

interface WorkspaceMembersResponse {
  members?: WorkspaceMemberRow[]
  pagination?: { has_more?: boolean }
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
  const res = await fetch(`${base}/workspaces`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  })
  if (res.status === 404) return []
  if (res.status === 401 || res.status === 403) throw new Error('Not authorized to list workspaces')
  if (!res.ok) throw new Error(`List workspaces failed: HTTP ${res.status}`)
  const body: unknown = await res.json().catch(() => null)
  const rows =
    body && typeof body === 'object'
      ? (body as { workspaces?: WorkspaceRow[] }).workspaces
      : undefined
  // A malformed payload (workspaces as an object/string) must not throw.
  return (Array.isArray(rows) ? rows : []).map((w) => ({
    id: w.id,
    name: w.name,
    type: w.type,
    role: w.role,
    ...(w.subscription_tier ? { subscriptionTier: w.subscription_tier } : {}),
    ...(w.created_at ? { createdAt: w.created_at } : {}),
    ...(w.joined_at ? { joinedAt: w.joined_at } : {})
  }))
}

/** List every member of the active workspace for creator-name resolution. */
export async function listWorkspaceMembers(
  accessToken: string,
  options: ListWorkspacesOptions = {}
): Promise<WorkspaceMember[]> {
  const base = (options.apiBase ?? CLOUD_CONFIG.apiBase).replace(/\/+$/, '')
  const members: WorkspaceMember[] = []
  let offset = 0
  let hasMore = true
  while (hasMore) {
    const query = new URLSearchParams({ offset: String(offset), limit: '100' })
    const res = await fetch(`${base}/workspace/members?${query}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    })
    if (res.status === 401 || res.status === 403) {
      throw new Error('Not authorized to list workspace members')
    }
    if (!res.ok) throw new Error(`List workspace members failed: HTTP ${res.status}`)
    const body: unknown = await res.json().catch(() => null)
    const page = body && typeof body === 'object' ? (body as WorkspaceMembersResponse) : {}
    const rows = Array.isArray(page.members) ? page.members : []
    members.push(
      ...rows.map((member) => ({
        id: member.id,
        ...(member.name ? { name: member.name } : {}),
        ...(member.email ? { email: member.email } : {}),
        ...(member.role ? { role: member.role } : {}),
        ...(member.joined_at ? { joinedAt: member.joined_at } : {}),
        ...(typeof member.is_original_owner === 'boolean'
          ? { isOriginalOwner: member.is_original_owner }
          : {})
      }))
    )
    hasMore = page.pagination?.has_more === true && rows.length > 0
    offset += rows.length
  }
  return members
}
