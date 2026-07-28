import { randomUUID } from 'node:crypto'
import fs from 'fs'
import path from 'path'
import { configDir } from './paths'
import { isIllegalPostHogDistinctId, normalizeOpaqueIdentifier } from './opaqueIdentifier'
import { writeFileSafe } from './safe-file'

const ANONYMOUS_DISTINCT_ID_FILE = 'posthog-anonymous-distinct-id.txt'
const UNMERGEABLE_EPOCH_FILE = 'posthog-anonymous-epoch-unmergeable'
const MAX_ANONYMOUS_DISTINCT_ID_LENGTH = 256
// Local persisted-file envelope (unpadded base64url of the exact UTF-8 ID).
// Deliberately NOT 'phid1_': that tag is the installer-filename carrier's
// version marker and carries a raw UUID, a different grammar.
const ENCODED_ANONYMOUS_DISTINCT_ID_PREFIX = 'b64id1_'

function decodePersistedAnonymousDistinctId(raw: string): string | null {
  if (!raw.startsWith(ENCODED_ANONYMOUS_DISTINCT_ID_PREFIX)) {
    // Plain opaque IDs remain valid; the envelope preserves exact Unicode.
    const normalized = normalizeOpaqueIdentifier(raw, MAX_ANONYMOUS_DISTINCT_ID_LENGTH)
    if (!normalized || isIllegalPostHogDistinctId(normalized)) return null
    return normalized
  }

  const payload = raw.slice(ENCODED_ANONYMOUS_DISTINCT_ID_PREFIX.length).trimEnd()
  if (!/^[A-Za-z0-9_-]+$/.test(payload) || payload.length % 4 === 1) return null
  try {
    const bytes = Buffer.from(payload, 'base64url')
    if (bytes.toString('base64url') !== payload) return null
    const value = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
    return normalizeAnonymousDistinctId(value)
  } catch {
    return null
  }
}

export function normalizeAnonymousDistinctId(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null
  if (value.length > MAX_ANONYMOUS_DISTINCT_ID_LENGTH) return null
  if (isIllegalPostHogDistinctId(value)) return null
  try {
    const bytes = Buffer.from(value, 'utf-8')
    if (new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) !== value) {
      return null
    }
    return value
  } catch {
    return null
  }
}

export function anonymousDistinctIdPath(): string {
  return path.join(configDir(), ANONYMOUS_DISTINCT_ID_FILE)
}

function unmergeableEpochPath(): string {
  return path.join(configDir(), UNMERGEABLE_EPOCH_FILE)
}

export function readPersistedAnonymousDistinctId(): string | null {
  try {
    return decodePersistedAnonymousDistinctId(fs.readFileSync(anonymousDistinctIdPath(), 'utf-8'))
  } catch {
    return null
  }
}

export function persistAnonymousDistinctId(anonymousDistinctId: string): boolean {
  const normalized = normalizeAnonymousDistinctId(anonymousDistinctId)
  if (!normalized) return false

  try {
    const payload = Buffer.from(normalized, 'utf-8').toString('base64url')
    writeFileSafe(anonymousDistinctIdPath(), `${ENCODED_ANONYMOUS_DISTINCT_ID_PREFIX}${payload}`)
    return true
  } catch {
    // Fail closed on any write error. Do not synchronously retry a Windows
    // rename lock here: this runs on Electron's main thread, where a sleep
    // would freeze the app. A later caller can retry safely.
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
