import { CLOUD_CONFIG } from './config'
import type { Workspace, WorkspaceMember } from './types'

const DEFAULT_TIMEOUT_MS = 20_000

interface WorkspaceRow {
  id: string
  name: string
  type: string
  role: string
  subscription_tier?: unknown
  created_at?: string
  joined_at?: string
}

export interface ListWorkspacesOptions {
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

function isPlanTier(value: unknown): value is string | null {
  return typeof value === 'string' || value === null
}

function isWorkspaceRow(value: unknown): value is WorkspaceRow {
  if (!value || typeof value !== 'object') return false
  const row = value as Partial<WorkspaceRow>
  return (
    typeof row.id === 'string' &&
    row.id.trim().length > 0 &&
    typeof row.name === 'string' &&
    typeof row.type === 'string' &&
    typeof row.role === 'string'
  )
}

export async function listWorkspaces(
  accessToken: string,
  options: ListWorkspacesOptions = {}
): Promise<Workspace[]> {
  const base = (options.apiBase ?? CLOUD_CONFIG.apiBase).replace(/\/+$/, '')
  const res = await fetch(`${base}/workspaces`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  })
  if (res.status === 401 || res.status === 403) throw new Error('Not authorized to list workspaces')
  if (!res.ok) throw new Error(`List workspaces failed: HTTP ${res.status}`)
  const body: unknown = await res.json().catch(() => null)
  const rows =
    body && typeof body === 'object' ? (body as { workspaces?: unknown }).workspaces : undefined
  if (!Array.isArray(rows) || !rows.every(isWorkspaceRow)) {
    throw new Error('List workspaces returned an invalid catalog')
  }
  return rows.map((w) => ({
    id: w.id,
    name: w.name,
    type: w.type,
    role: w.role,
    ...(isPlanTier(w.subscription_tier) ? { subscriptionTier: w.subscription_tier } : {}),
    ...(w.created_at ? { createdAt: w.created_at } : {}),
    ...(w.joined_at ? { joinedAt: w.joined_at } : {})
  }))
}

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
