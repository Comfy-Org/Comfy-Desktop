import { randomUUID } from 'node:crypto'
import fs from 'fs'
import path from 'path'
import { configDir } from './paths'
import { writeFileSafe } from './safe-file'

const ANONYMOUS_DISTINCT_ID_FILE = 'posthog-anonymous-distinct-id.txt'
const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/

export function normalizeAnonymousDistinctId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return UUID_PATTERN.test(normalized) ? normalized : null
}

export function anonymousDistinctIdPath(): string {
  return path.join(configDir(), ANONYMOUS_DISTINCT_ID_FILE)
}

export function readPersistedAnonymousDistinctId(): string | null {
  try {
    return normalizeAnonymousDistinctId(fs.readFileSync(anonymousDistinctIdPath(), 'utf-8'))
  } catch {
    return null
  }
}

export function persistAnonymousDistinctId(anonymousDistinctId: string): boolean {
  const normalized = normalizeAnonymousDistinctId(anonymousDistinctId)
  if (!normalized) return false

  try {
    writeFileSafe(anonymousDistinctIdPath(), normalized)
    return true
  } catch {
    return false
  }
}

export function getOrCreateAnonymousDistinctId(): string {
  const persisted = readPersistedAnonymousDistinctId()
  if (persisted) return persisted
  const created = randomUUID()
  // A failed first write must not prevent telemetry for this process.
  persistAnonymousDistinctId(created)
  return created
}

export function rotatePersistedAnonymousDistinctId(): string | null {
  const anonymousDistinctId = randomUUID()
  return persistAnonymousDistinctId(anonymousDistinctId) ? anonymousDistinctId : null
}
