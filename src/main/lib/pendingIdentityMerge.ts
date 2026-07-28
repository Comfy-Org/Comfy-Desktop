import { randomUUID } from 'node:crypto'
import fs from 'fs'
import path from 'path'
import { configDir } from './paths'
import { normalizeOpaqueIdentifier, normalizePostHogDistinctId } from './opaqueIdentifier'
import { writeFileSafe } from './safe-file'
import { normalizeAnonymousDistinctId, persistAnonymousDistinctId } from './anonymousIdentity'

const PENDING_IDENTITY_MERGES_FILE = 'posthog-pending-identity-merges.json'
const PENDING_PERSON_PROPERTIES_FILE = 'posthog-pending-person-properties.json'
const DISCARDED_PERSON_PROPERTIES_FILE = 'posthog-discarded-person-properties.txt'
const MAX_PENDING_IDENTITY_MERGES = 32

export interface PendingIdentityMerge {
  id: string
  anonymousId: string
  userId: string
  nextAnonymousId: string
  installationId: string
  personSet: PendingIdentityProperties
  personSetOnce?: PendingIdentityProperties
  personPropertiesBufferId?: string
}

export type PendingIdentityProperties = Record<string, boolean | number | string | null>

export interface PendingPersonProperties {
  id: string
  personSet?: PendingIdentityProperties
  personSetOnce?: PendingIdentityProperties
}

function pendingIdentityMergesPath(): string {
  return path.join(configDir(), PENDING_IDENTITY_MERGES_FILE)
}

function pendingPersonPropertiesPath(): string {
  return path.join(configDir(), PENDING_PERSON_PROPERTIES_FILE)
}

function discardedPersonPropertiesPath(): string {
  return path.join(configDir(), DISCARDED_PERSON_PROPERTIES_FILE)
}

function normalizeUserIdentity(value: unknown): string | null {
  return normalizePostHogDistinctId(value)
}

function normalizeEntry(value: unknown): PendingIdentityMerge | null {
  if (!value || typeof value !== 'object') return null
  const entry = value as Record<string, unknown>
  const id = normalizeOpaqueIdentifier(entry.id, 64)
  const anonymousId = normalizeAnonymousDistinctId(entry.anonymousId)
  const userId = normalizeUserIdentity(entry.userId)
  const nextAnonymousId = normalizeAnonymousDistinctId(entry.nextAnonymousId)
  const installationId = normalizeOpaqueIdentifier(entry.installationId, 256)
  const personPropertiesBufferId = normalizeOpaqueIdentifier(entry.personPropertiesBufferId, 64)
  if (!id || !anonymousId || !userId || !nextAnonymousId || !installationId) return null
  const personSet = normalizeProperties(entry.personSet) ?? {
    installation_id: installationId,
    is_authenticated: true
  }
  const personSetOnce = normalizeProperties(entry.personSetOnce)
  return {
    id,
    anonymousId,
    userId,
    nextAnonymousId,
    installationId,
    personSet,
    ...(personSetOnce && Object.keys(personSetOnce).length > 0 ? { personSetOnce } : {}),
    ...(personPropertiesBufferId ? { personPropertiesBufferId } : {})
  }
}

function normalizePendingPersonProperties(value: unknown): PendingPersonProperties | null {
  if (!value || typeof value !== 'object') return null
  const entry = value as Record<string, unknown>
  const id = normalizeOpaqueIdentifier(entry.id, 64)
  if (!id) return null
  const personSet = normalizeProperties(entry.personSet)
  const personSetOnce = normalizeProperties(entry.personSetOnce)
  if (
    (!personSet || Object.keys(personSet).length === 0) &&
    (!personSetOnce || Object.keys(personSetOnce).length === 0)
  ) {
    return null
  }
  return {
    id,
    ...(personSet && Object.keys(personSet).length > 0 ? { personSet } : {}),
    ...(personSetOnce && Object.keys(personSetOnce).length > 0 ? { personSetOnce } : {})
  }
}

function normalizeProperties(value: unknown): PendingIdentityProperties | null {
  if (value === undefined) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const properties: PendingIdentityProperties = {}
  for (const [key, candidate] of Object.entries(value)) {
    if (
      candidate === null ||
      typeof candidate === 'boolean' ||
      typeof candidate === 'number' ||
      typeof candidate === 'string'
    ) {
      properties[key] = candidate
    }
  }
  return properties
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

function readPendingPersonPropertiesFile(): PendingPersonProperties | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(pendingPersonPropertiesPath(), 'utf-8'))
    return normalizePendingPersonProperties(parsed)
  } catch {
    return null
  }
}

function readDiscardedPersonPropertiesId(): string | null {
  try {
    return normalizeOpaqueIdentifier(
      fs.readFileSync(discardedPersonPropertiesPath(), 'utf-8'),
      64
    )
  } catch {
    return null
  }
}

function clearDiscardedPersonPropertiesId(): void {
  try {
    fs.rmSync(discardedPersonPropertiesPath(), { force: true })
  } catch {
    // A stale marker is harmless and will be retried on the next read.
  }
}

export function readPendingPersonProperties(): PendingPersonProperties | null {
  const current = readPendingPersonPropertiesFile()
  const discardedId = readDiscardedPersonPropertiesId()
  if (!discardedId) return current
  if (!current) return null
  if (current.id !== discardedId) {
    clearDiscardedPersonPropertiesId()
    return current
  }
  try {
    fs.rmSync(pendingPersonPropertiesPath(), { force: true })
    clearDiscardedPersonPropertiesId()
  } catch {
    // The durable marker keeps the stale payload quarantined until deletion succeeds.
  }
  return null
}

export function persistPendingPersonProperties(
  properties: Omit<PendingPersonProperties, 'id'> & { id?: string }
): PendingPersonProperties | null {
  const normalized = normalizePendingPersonProperties({
    ...properties,
    id: properties.id ?? randomUUID()
  })
  if (!normalized) return null
  try {
    writeFileSafe(pendingPersonPropertiesPath(), JSON.stringify(normalized))
    return normalized
  } catch {
    return null
  }
}

export function clearPendingPersonProperties(expectedId?: string): boolean {
  const current = readPendingPersonPropertiesFile()
  if (expectedId && current && current.id !== expectedId) return true
  const discardedId = expectedId ?? current?.id
  if (!discardedId) {
    try {
      fs.rmSync(pendingPersonPropertiesPath(), { force: true })
      return true
    } catch {
      return false
    }
  }

  try {
    writeFileSafe(discardedPersonPropertiesPath(), discardedId)
  } catch {
    try {
      fs.rmSync(pendingPersonPropertiesPath(), { force: true })
      return true
    } catch {
      return false
    }
  }

  try {
    fs.rmSync(pendingPersonPropertiesPath(), { force: true })
  } catch {
    return true
  }
  clearDiscardedPersonPropertiesId()
  return true
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
