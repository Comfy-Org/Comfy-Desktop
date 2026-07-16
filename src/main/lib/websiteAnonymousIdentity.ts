import fs from 'fs'
import path from 'path'
import {
  getOrCreateAnonymousDistinctId,
  persistAnonymousDistinctId,
  readPersistedAnonymousDistinctId
} from './anonymousIdentity'
import { configDir } from './paths'

export const PENDING_WEBSITE_ANONYMOUS_ID_FILE = 'pending-website-anonymous-id.txt'

// posthog-js generates $device_id as a lowercase hyphenated UUID, and the
// Router only emits the filename carrier for cookie values of exactly that
// shape. The version and variant nibbles are deliberately not pinned:
// posthog-js has changed UUID versions before (v4 -> v7), and a pinned
// pattern would silently drop attribution on the next change.
const WEBSITE_ANONYMOUS_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function pendingWebsiteAnonymousIdPath(): string {
  return path.join(configDir(), PENDING_WEBSITE_ANONYMOUS_ID_FILE)
}

/**
 * Validate the Router's exact filename carrier:
 * `phid1_<website PostHog $device_id>`, where the ID is carried raw.
 *
 * The payload IS the identity — there is no decoding step — so a renamed or
 * hand-crafted installer can only ever inject a well-formed UUID, never an
 * arbitrary distinct ID (which also rules out PostHog's unmergeable illegal
 * IDs by shape).
 */
export function parseWebsiteAnonymousIdPayload(payload: unknown): string | null {
  if (typeof payload !== 'string') return null
  return WEBSITE_ANONYMOUS_ID_PATTERN.test(payload) ? payload : null
}

function clearPendingWebsiteAnonymousId(): void {
  try {
    fs.rmSync(pendingWebsiteAnonymousIdPath(), { force: true })
  } catch {
    // Best-effort cleanup. A valid value cannot replace an already-persisted
    // Desktop ID, so a retry on the next startup is harmless.
  }
}

function readPendingWebsiteAnonymousId(): string | null {
  try {
    const raw = fs.readFileSync(pendingWebsiteAnonymousIdPath(), 'utf-8')
    // The NSIS writer appends exactly CRLF. Do not broadly trim: the carrier
    // contract is exact, and accepting any other surrounding bytes would make
    // the on-disk grammar looser than the Router filename grammar.
    const payload = raw.endsWith('\r\n') ? raw.slice(0, -2) : raw
    return parseWebsiteAnonymousIdPayload(payload)
  } catch {
    return null
  }
}

/**
 * Resolve the pre-login PostHog distinct ID before the first capture. An
 * existing persisted ID always wins; a website carrier only seeds a fresh
 * install, and only once it has been durably persisted.
 */
export function getInitialAnonymousDistinctId(): string {
  const persisted = readPersistedAnonymousDistinctId()
  if (persisted) {
    clearPendingWebsiteAnonymousId()
    return persisted
  }

  const websiteAnonymousId = readPendingWebsiteAnonymousId()
  if (websiteAnonymousId && persistAnonymousDistinctId(websiteAnonymousId)) {
    clearPendingWebsiteAnonymousId()
    return websiteAnonymousId
  }

  if (!websiteAnonymousId) clearPendingWebsiteAnonymousId()
  return getOrCreateAnonymousDistinctId()
}
