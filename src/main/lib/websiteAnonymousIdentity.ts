import fs from 'fs'
import path from 'path'
import {
  getOrCreateAnonymousDistinctId,
  persistAnonymousDistinctId,
  readPersistedAnonymousDistinctId
} from './anonymousIdentity'
import { isIllegalPostHogDistinctId } from './opaqueIdentifier'
import { configDir } from './paths'

export const PENDING_WEBSITE_ANONYMOUS_ID_FILE = 'pending-website-anonymous-id.txt'
export const MAX_WEBSITE_ANONYMOUS_ID_BYTES = 160
const MIN_WEBSITE_ANONYMOUS_ID_PAYLOAD_LENGTH = 2
const MAX_WEBSITE_ANONYMOUS_ID_PAYLOAD_LENGTH = 214

export function pendingWebsiteAnonymousIdPath(): string {
  return path.join(configDir(), PENDING_WEBSITE_ANONYMOUS_ID_FILE)
}

/**
 * Decode the Router's exact filename carrier:
 * `phid1_<unpadded RFC 4648 base64url(UTF-8 website $device_id)>`.
 *
 * Node's base64 decoder is intentionally permissive, so every constraint is
 * checked explicitly and the payload must round-trip canonically. This keeps a
 * renamed or hand-crafted installer from injecting a different identity than
 * the filename actually encodes.
 */
export function decodeWebsiteAnonymousIdPayload(payload: unknown): string | null {
  if (typeof payload !== 'string') return null
  if (
    payload.length < MIN_WEBSITE_ANONYMOUS_ID_PAYLOAD_LENGTH ||
    payload.length > MAX_WEBSITE_ANONYMOUS_ID_PAYLOAD_LENGTH ||
    payload.length % 4 === 1 ||
    !/^[A-Za-z0-9_-]+$/.test(payload)
  ) {
    return null
  }

  try {
    const bytes = Buffer.from(payload, 'base64url')
    if (bytes.length === 0 || bytes.length > MAX_WEBSITE_ANONYMOUS_ID_BYTES) return null
    if (bytes.toString('base64url') !== payload) return null
    const websiteAnonymousId = new TextDecoder('utf-8', {
      fatal: true,
      ignoreBOM: true
    }).decode(bytes)
    if (Buffer.from(websiteAnonymousId, 'utf-8').toString('base64url') !== payload) return null
    if (isIllegalPostHogDistinctId(websiteAnonymousId)) return null
    return websiteAnonymousId
  } catch {
    return null
  }
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
    return decodeWebsiteAnonymousIdPayload(payload)
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
