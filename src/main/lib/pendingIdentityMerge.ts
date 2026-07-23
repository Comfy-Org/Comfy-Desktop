import { randomUUID } from 'node:crypto'
import fs from 'fs'
import path from 'path'
import { configDir } from './paths'
import { isIllegalPostHogDistinctId, normalizeOpaqueIdentifier } from './opaqueIdentifier'
import { writeFileSafe } from './safe-file'
import { persistAnonymousDistinctId } from './anonymousIdentity'

const PENDING_IDENTITY_MERGES_FILE = 'posthog-pending-identity-merges.json'
const MAX_PENDING_IDENTITY_MERGES = 32

export interface PendingIdentityMerge {
  id: string
  anonymousId: string
  userId: string
  nextAnonymousId: string
  installationId: string
}

function pendingIdentityMergesPath(): string {
  return path.join(configDir(), PENDING_IDENTITY_MERGES_FILE)
}

function normalizeIdentity(value: unknown): string | null {
  const normalized = normalizeOpaqueIdentifier(value, 256)
  return normalized && !isIllegalPostHogDistinctId(normalized) ? normalized : null
}

function normalizeEntry(value: unknown): PendingIdentityMerge | null {
  if (!value || typeof value !== 'object') return null
  const entry = value as Record<string, unknown>
  const id = normalizeOpaqueIdentifier(entry.id, 64)
  const anonymousId = normalizeIdentity(entry.anonymousId)
  const userId = normalizeIdentity(entry.userId)
  const nextAnonymousId = normalizeIdentity(entry.nextAnonymousId)
  const installationId = normalizeOpaqueIdentifier(entry.installationId, 256)
  if (!id || !anonymousId || !userId || !nextAnonymousId || !installationId) return null
  return { id, anonymousId, userId, nextAnonymousId, installationId }
}

export function readPendingIdentityMerges(): PendingIdentityMerge[] {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(pendingIdentityMergesPath(), 'utf-8'))
    if (!Array.isArray(parsed)) return []
    return parsed
      .slice(-MAX_PENDING_IDENTITY_MERGES)
      .map(normalizeEntry)
      .filter((entry): entry is PendingIdentityMerge => entry !== null)
  } catch {
    return []
  }
}

export function enqueuePendingIdentityMerge(
  merge: Omit<PendingIdentityMerge, 'id'>
): PendingIdentityMerge | null {
  const normalized = normalizeEntry({ ...merge, id: randomUUID() })
  if (!normalized) return null
  const pending = [...readPendingIdentityMerges(), normalized].slice(-MAX_PENDING_IDENTITY_MERGES)
  try {
    writeFileSafe(pendingIdentityMergesPath(), JSON.stringify(pending))
    return normalized
  } catch {
    return null
  }
}

export function reservePendingIdentityMerge(
  merge: Omit<PendingIdentityMerge, 'id' | 'nextAnonymousId'>
): PendingIdentityMerge | null {
  const pending = enqueuePendingIdentityMerge({ ...merge, nextAnonymousId: randomUUID() })
  if (!pending) return null
  if (persistAnonymousDistinctId(pending.nextAnonymousId)) return pending
  clearPendingIdentityMerges(new Set([pending.id]))
  return null
}

/**
 * Complete a rotation if the process crashed after recording W/D -> F but
 * before replacing the reusable anonymous ID. This runs before first capture.
 */
export function recoverPendingIdentityRotation(currentAnonymousId: string): string {
  const interrupted = readPendingIdentityMerges()
    .reverse()
    .find((merge) => merge.anonymousId === currentAnonymousId)
  if (!interrupted) return currentAnonymousId
  return persistAnonymousDistinctId(interrupted.nextAnonymousId)
    ? interrupted.nextAnonymousId
    : currentAnonymousId
}

export function clearPendingIdentityMerges(ids: ReadonlySet<string>): boolean {
  if (ids.size === 0) return true
  const remaining = readPendingIdentityMerges().filter((entry) => !ids.has(entry.id))
  try {
    if (remaining.length === 0) {
      fs.rmSync(pendingIdentityMergesPath(), { force: true })
    } else {
      writeFileSafe(pendingIdentityMergesPath(), JSON.stringify(remaining))
    }
    return true
  } catch {
    return false
  }
}
