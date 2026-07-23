/**
 * OAuth token store (main process only). Tokens are encrypted at rest with
 * Electron `safeStorage` in `userData/comfy-cloud-auth.bin` and never reach the
 * renderer, logs, or disk in plaintext. When the OS secure-storage backend is
 * unavailable, tokens are kept in memory for the process lifetime only.
 */
import { app, safeStorage } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

import { statusFromAccessToken } from './claims'
import type { AuthStatus, AuthTokens } from './types'

const AUTH_FILENAME = 'comfy-cloud-auth.bin'

let cachedTokens: AuthTokens | null = null
let authFilePath: string | null = null
export let secureStorageUnavailable = false

function filePath(): string {
  if (!authFilePath) authFilePath = path.join(app.getPath('userData'), AUTH_FILENAME)
  return authFilePath
}

function encryptionAvailable(): boolean {
  let ok: boolean
  try { ok = safeStorage.isEncryptionAvailable() } catch { ok = false }
  secureStorageUnavailable = !ok
  return ok
}

export function saveTokens(tokens: AuthTokens): void {
  cachedTokens = tokens
  if (!encryptionAvailable()) return // never write plaintext; memory only
  try {
    fs.writeFileSync(filePath(), safeStorage.encryptString(JSON.stringify(tokens)))
  } catch {
    // A failed persist must not fail the sign-in the user just completed.
  }
}

export function loadTokens(): AuthTokens | null {
  if (cachedTokens) return cachedTokens
  if (!encryptionAvailable()) return null
  try {
    cachedTokens = JSON.parse(safeStorage.decryptString(fs.readFileSync(filePath()))) as AuthTokens
    return cachedTokens
  } catch {
    return null
  }
}

export function clearTokens(): void {
  cachedTokens = null
  try { fs.rmSync(filePath(), { force: true }) } catch { /* nothing to remove */ }
}

export function getAuthStatus(): AuthStatus {
  const t = loadTokens()
  return t ? statusFromAccessToken(t.accessToken) : { signedIn: false }
}

/** @internal reset module state between unit tests. */
export function _resetForTest(): void {
  cachedTokens = null
  authFilePath = null
  secureStorageUnavailable = false
}
