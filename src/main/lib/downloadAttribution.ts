import fs from 'fs'
import path from 'path'
import { normalizeAnonymousDistinctId } from './anonymousIdentity'
import { configDir } from './paths'
import { writeFileSafe } from './safe-file'

export const PENDING_DOWNLOAD_TOKEN_FILE = 'pending-download-token.txt'
const DOWNLOAD_TOKEN_ATTRIBUTED_FILE = 'download-token-attributed'

export type DownloadTokenSource = 'windows_installer_filename'

export interface PendingDownloadToken {
  token: string
  source: DownloadTokenSource
  anonymousId: string
}

const DOWNLOAD_TOKEN_PATTERN = /^[0-9A-Za-z]{12}$/

export function normalizeDownloadToken(raw: string | null | undefined): string | null {
  const token = raw?.trim()
  if (!token || !DOWNLOAD_TOKEN_PATTERN.test(token)) return null
  return token
}

export function pendingDownloadTokenPath(): string {
  return path.join(configDir(), PENDING_DOWNLOAD_TOKEN_FILE)
}

function downloadTokenAttributedPath(): string {
  return path.join(configDir(), DOWNLOAD_TOKEN_ATTRIBUTED_FILE)
}

function hasAttributedDownloadToken(): boolean {
  try {
    return fs.existsSync(downloadTokenAttributedPath())
  } catch {
    return false
  }
}

function normalizePinnedDownloadToken(value: unknown): PendingDownloadToken | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  const token = normalizeDownloadToken(
    typeof candidate.token === 'string' ? candidate.token : undefined
  )
  const anonymousId = normalizeAnonymousDistinctId(candidate.anonymousId)
  if (
    candidate.version !== 1 ||
    candidate.source !== 'windows_installer_filename' ||
    !token ||
    !anonymousId
  ) {
    return null
  }
  return { token, source: candidate.source, anonymousId }
}

export function readPendingDownloadToken(
  currentAnonymousId: string
): PendingDownloadToken | null {
  try {
    const raw = fs.readFileSync(pendingDownloadTokenPath(), 'utf-8')
    if (hasAttributedDownloadToken()) {
      clearPendingDownloadToken()
      return null
    }

    if (raw.trimStart().startsWith('{')) {
      try {
        const pinned = normalizePinnedDownloadToken(JSON.parse(raw))
        if (!pinned) clearPendingDownloadToken()
        return pinned
      } catch {
        clearPendingDownloadToken()
        return null
      }
    }

    const token = normalizeDownloadToken(raw)
    const anonymousId = normalizeAnonymousDistinctId(currentAnonymousId)
    if (!token || !anonymousId) {
      clearPendingDownloadToken()
      return null
    }
    const pinned: PendingDownloadToken = {
      token,
      source: 'windows_installer_filename',
      anonymousId
    }
    try {
      writeFileSafe(pendingDownloadTokenPath(), JSON.stringify({ version: 1, ...pinned }))
      return pinned
    } catch {
      clearPendingDownloadToken()
      return null
    }
  } catch {
    return null
  }
}

export function clearPendingDownloadToken(): void {
  try {
    fs.rmSync(pendingDownloadTokenPath(), { force: true })
  } catch {
    // best-effort cleanup; a failure leaves the token to retry next boot
  }
}

export function markDownloadTokenAttributed(): void {
  try {
    fs.mkdirSync(path.dirname(downloadTokenAttributedPath()), { recursive: true })
    fs.writeFileSync(downloadTokenAttributedPath(), new Date().toISOString())
  } catch {
    // best-effort guard; a failure only risks duplicate attribution on reinstall
  }
}
