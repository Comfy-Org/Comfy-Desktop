import { randomUUID } from 'node:crypto'
import fs from 'fs'
import path from 'path'
import { configDir } from './paths'
import { writeFileSafe } from './safe-file'

const ANONYMOUS_DISTINCT_ID_FILE = 'posthog-anonymous-distinct-id.txt'
const UNMERGEABLE_EPOCH_FILE = 'posthog-anonymous-epoch-unmergeable'
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

function unmergeableEpochPath(): string {
  return path.join(configDir(), UNMERGEABLE_EPOCH_FILE)
}

export function hasPersistedUnmergeableAnonymousEpoch(): boolean {
  try {
    return fs.readFileSync(unmergeableEpochPath(), 'utf-8') === '1'
  } catch {
    return false
  }
}

/** Persist taint, or delete the reusable identity as a fail-safe fallback. */
export function persistUnmergeableAnonymousEpoch(): boolean {
  try {
    writeFileSafe(unmergeableEpochPath(), '1')
    return true
  } catch {
    try {
      fs.rmSync(anonymousDistinctIdPath(), { force: true })
      return !fs.existsSync(anonymousDistinctIdPath())
    } catch {
      return false
    }
  }
}

export function clearPersistedUnmergeableAnonymousEpoch(): boolean {
  try {
    fs.rmSync(unmergeableEpochPath(), { force: true })
    return true
  } catch {
    return false
  }
}
