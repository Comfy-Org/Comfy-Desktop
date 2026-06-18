import fs from 'fs'
import path from 'path'
import { configDir } from './paths'

export const PENDING_DOWNLOAD_TOKEN_FILE = 'pending-download-token.txt'

export type DownloadTokenSource = 'windows_installer_filename'

export interface PendingDownloadToken {
  token: string
  source: DownloadTokenSource
}

const DOWNLOAD_TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,128}$/

export function normalizeDownloadToken(raw: string | null | undefined): string | null {
  const token = raw?.trim()
  if (!token || !DOWNLOAD_TOKEN_PATTERN.test(token)) return null
  return token
}

export function pendingDownloadTokenPath(): string {
  return path.join(configDir(), PENDING_DOWNLOAD_TOKEN_FILE)
}

export function readPendingDownloadToken(): PendingDownloadToken | null {
  try {
    const token = normalizeDownloadToken(fs.readFileSync(pendingDownloadTokenPath(), 'utf-8'))
    if (!token) return null
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
