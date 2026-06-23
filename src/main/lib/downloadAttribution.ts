import fs from 'fs'
import path from 'path'
import { configDir } from './paths'

export const PENDING_DOWNLOAD_TOKEN_FILE = 'pending-download-token.txt'
const DOWNLOAD_TOKEN_ATTRIBUTED_FILE = 'download-token-attributed'

export type DownloadTokenSource = 'windows_installer_filename'

export interface PendingDownloadToken {
  token: string
  source: DownloadTokenSource
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

export function readPendingDownloadToken(): PendingDownloadToken | null {
  try {
    const token = normalizeDownloadToken(fs.readFileSync(pendingDownloadTokenPath(), 'utf-8'))
    if (!token || hasAttributedDownloadToken()) {
      clearPendingDownloadToken()
      return null
    }
    return { token, source: 'windows_installer_filename' }
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
