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
  try {
    ok = safeStorage.isEncryptionAvailable()
  } catch {
    ok = false
  }
  secureStorageUnavailable = !ok
  return ok
}

function isTokens(v: unknown): v is AuthTokens {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof (v as AuthTokens).accessToken === 'string' &&
    typeof (v as AuthTokens).expiresAt === 'number'
  )
}

export function saveTokens(tokens: AuthTokens): void {
  cachedTokens = tokens
  if (!encryptionAvailable()) {
    // No secure backend: never write plaintext, and drop any prior encrypted
    // file so a later run can't read stale tokens back as current.
    try {
      fs.rmSync(filePath(), { force: true })
    } catch {
      /* nothing to remove */
    }
    return
  }
  try {
    fs.writeFileSync(filePath(), safeStorage.encryptString(JSON.stringify(tokens)))
  } catch {
    // A failed persist must not fail the sign-in the user just completed; the
    // in-memory cache still holds the tokens for this session.
  }
}

export function loadTokens(): AuthTokens | null {
  if (cachedTokens) return cachedTokens
  if (!encryptionAvailable()) return null
  try {
    const parsed: unknown = JSON.parse(safeStorage.decryptString(fs.readFileSync(filePath())))
    if (!isTokens(parsed)) return null // corrupt/incompatible payload -> signed out
    cachedTokens = parsed
    return cachedTokens
  } catch {
    return null
  }
}

export function clearTokens(): void {
  cachedTokens = null
  try {
    fs.rmSync(filePath(), { force: true })
  } catch {
    /* nothing to remove */
  }
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
