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

const WEBSITE_ANONYMOUS_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function pendingWebsiteAnonymousIdPath(): string {
  return path.join(configDir(), PENDING_WEBSITE_ANONYMOUS_ID_FILE)
}

export function pendingWebsiteAnonymousIdRetryPath(): string {
  return path.join(configDir(), PENDING_WEBSITE_ANONYMOUS_ID_RETRY_FILE)
}

export function parseWebsiteAnonymousIdPayload(payload: unknown): string | null {
  if (typeof payload !== 'string') return null
  return WEBSITE_ANONYMOUS_ID_PATTERN.test(payload) ? payload : null
}

function clearPendingWebsiteAnonymousId(): void {
  for (const filePath of [pendingWebsiteAnonymousIdPath(), pendingWebsiteAnonymousIdRetryPath()]) {
    try {
      fs.rmSync(filePath, { force: true })
    } catch {}
  }
}

function readWebsiteAnonymousId(filePath: string): string | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
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
    } catch {}
  }
}

export function getInitialAnonymousDistinctId(existingInstallation = false): string {
  clearLegacyDownloadAttribution()
  const persisted = readPersistedAnonymousDistinctId()
  if (persisted) {
    clearPendingWebsiteAnonymousId()
    return persisted
  }

  if (fs.existsSync(anonymousDistinctIdPath())) {
    clearPendingWebsiteAnonymousId()
    return getOrCreateAnonymousDistinctId()
  }

  const retryWebsiteAnonymousId = readWebsiteAnonymousId(pendingWebsiteAnonymousIdRetryPath())
  if (retryWebsiteAnonymousId) {
    if (persistAnonymousDistinctId(retryWebsiteAnonymousId)) {
      clearPendingWebsiteAnonymousId()
    }
    return retryWebsiteAnonymousId
  }

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
    if (preserveWebsiteAnonymousIdRetry()) return websiteAnonymousId
  }

  clearPendingWebsiteAnonymousId()
  return getOrCreateAnonymousDistinctId()
}
