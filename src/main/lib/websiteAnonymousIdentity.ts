import fs from 'fs'
import path from 'path'
import {
  anonymousDistinctIdPath,
  getOrCreateAnonymousDistinctId,
  persistAnonymousDistinctId,
  readPersistedAnonymousDistinctId
} from './anonymousIdentity'
import { configDir } from './paths'

export const PENDING_WEBSITE_ANONYMOUS_ID_FILE = 'pending-website-anonymous-id.txt'
const PENDING_WEBSITE_ANONYMOUS_ID_RETRY_FILE = 'pending-website-anonymous-id-retry.txt'
const LEGACY_DOWNLOAD_ATTRIBUTION_FILES = [
  'pending-download-token.txt',
  'download-token-attributed'
] as const

// Version/variant nibbles deliberately unpinned: posthog-js has switched UUID
// versions before (v4 -> v7); a pinned pattern would silently drop attribution.
const WEBSITE_ANONYMOUS_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function pendingWebsiteAnonymousIdPath(): string {
  return path.join(configDir(), PENDING_WEBSITE_ANONYMOUS_ID_FILE)
}

export function pendingWebsiteAnonymousIdRetryPath(): string {
  return path.join(configDir(), PENDING_WEBSITE_ANONYMOUS_ID_RETRY_FILE)
}

/**
 * The payload IS the identity — no decoding — so a hand-crafted installer can
 * only inject a well-formed UUID, never an arbitrary distinct ID (this also
 * rules out PostHog's unmergeable illegal IDs by shape).
 */
export function parseWebsiteAnonymousIdPayload(payload: unknown): string | null {
  if (typeof payload !== 'string') return null
  return WEBSITE_ANONYMOUS_ID_PATTERN.test(payload) ? payload : null
}

function clearPendingWebsiteAnonymousId(): void {
  for (const filePath of [pendingWebsiteAnonymousIdPath(), pendingWebsiteAnonymousIdRetryPath()]) {
    try {
      fs.rmSync(filePath, { force: true })
    } catch {
      // A persisted Desktop ID always wins, so stale carriers are harmless.
    }
  }
}

function readWebsiteAnonymousId(filePath: string): string | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    // NSIS writes exactly CRLF; don't trim() — the on-disk grammar must stay
    // as strict as the Router's filename grammar.
    const payload = raw.endsWith('\r\n') ? raw.slice(0, -2) : raw
    return parseWebsiteAnonymousIdPayload(payload)
  } catch {
    return null
  }
}

function preserveWebsiteAnonymousIdRetry(): boolean {
  try {
    fs.renameSync(pendingWebsiteAnonymousIdPath(), pendingWebsiteAnonymousIdRetryPath())
    return true
  } catch {
    return false
  }
}

function clearLegacyDownloadAttribution(): void {
  for (const filename of LEGACY_DOWNLOAD_ATTRIBUTION_FILES) {
    try {
      fs.rmSync(path.join(configDir(), filename), { force: true })
    } catch {
      // Best-effort privacy cleanup.
    }
  }
}

/**
 * Resolve the pre-login PostHog distinct ID before the first capture. An
 * existing persisted ID always wins; a website carrier only seeds a fresh
 * install.
 */
export function getInitialAnonymousDistinctId(existingInstallation = false): string {
  clearLegacyDownloadAttribution()
  const persisted = readPersistedAnonymousDistinctId()
  if (persisted) {
    clearPendingWebsiteAnonymousId()
    return persisted
  }

  // A present-but-undecodable identity file still proves a prior install:
  // fail closed, drop the carrier, regenerate.
  if (fs.existsSync(anonymousDistinctIdPath())) {
    clearPendingWebsiteAnonymousId()
    return getOrCreateAnonymousDistinctId()
  }

  // An app-owned retry proves this process already adopted W before its
  // anonymous-ID write failed, so preserve that identity across restarts.
  const retryWebsiteAnonymousId = readWebsiteAnonymousId(pendingWebsiteAnonymousIdRetryPath())
  if (retryWebsiteAnonymousId) {
    if (persistAnonymousDistinctId(retryWebsiteAnonymousId)) {
      clearPendingWebsiteAnonymousId()
    }
    return retryWebsiteAnonymousId
  }

  // Existing local app state makes a carrier installer an upgrade, not a
  // fresh acquisition.
  if (existingInstallation) {
    clearPendingWebsiteAnonymousId()
    return getOrCreateAnonymousDistinctId()
  }

  const websiteAnonymousId = readWebsiteAnonymousId(pendingWebsiteAnonymousIdPath())
  if (websiteAnonymousId) {
    if (persistAnonymousDistinctId(websiteAnonymousId)) {
      clearPendingWebsiteAnonymousId()
      return websiteAnonymousId
    }
    // Return W only after recording that the app adopted it. A raw installer
    // carrier is insufficient because the next boot may correctly be an upgrade.
    if (preserveWebsiteAnonymousIdRetry()) return websiteAnonymousId
  }

  clearPendingWebsiteAnonymousId()
  return getOrCreateAnonymousDistinctId()
}
