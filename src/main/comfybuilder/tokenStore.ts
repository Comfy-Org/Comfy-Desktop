/**
 * ComfyBuilder OAuth token store — main process only.
 *
 * Tokens are encrypted at rest with Electron `safeStorage` and written to
 * `userData/comfybuilder-auth.bin`. They never reach the renderer, Pinia, logs,
 * or disk in plaintext: only `getAuthStatus()` is renderer-safe. When the OS
 * secure-storage backend is unavailable, tokens are kept in memory for the
 * lifetime of the process and are never written to disk.
 */
import { app, safeStorage } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

import { statusFromAccessToken } from './claims'
import type { AuthStatus, AuthTokens } from './types'

const AUTH_FILENAME = 'comfybuilder-auth.bin'

/** In-memory copy so reads skip disk, and the sole store when secure storage is off. */
let cachedTokens: AuthTokens | null = null
let authFilePath: string | null = null

/** True when the OS secure-storage backend can't encrypt; tokens then live in memory only. */
export let secureStorageUnavailable = false

function getAuthFilePath(): string {
  if (!authFilePath) {
    authFilePath = path.join(app.getPath('userData'), AUTH_FILENAME)
  }
  return authFilePath
}

/** Probe secure storage, recording the outcome in `secureStorageUnavailable`. */
function encryptionAvailable(): boolean {
  let available: boolean
  try {
    available = safeStorage.isEncryptionAvailable()
  } catch {
    available = false
  }
  secureStorageUnavailable = !available
  return available
}

/** Persist tokens encrypted at rest; falls back to in-memory-only when secure storage is off. */
export function saveTokens(tokens: AuthTokens): void {
  cachedTokens = tokens
  if (!encryptionAvailable()) {
    // No secure backend: never write plaintext to disk; keep in memory only.
    return
  }
  const encrypted = safeStorage.encryptString(JSON.stringify(tokens))
  try {
    fs.writeFileSync(getAuthFilePath(), encrypted)
  } catch {
    // The in-memory cache still holds the tokens — a failed disk write must
    // not fail the sign-in the user just completed, only its persistence.
  }
}

/** Return cached tokens, hydrating once from the encrypted file. Null when absent or unreadable. */
export function loadTokens(): AuthTokens | null {
  if (cachedTokens) return cachedTokens
  // No secure backend: nothing was ever written to disk, so there is nothing to hydrate.
  if (!encryptionAvailable()) return null
  try {
    const encrypted = fs.readFileSync(getAuthFilePath())
    const decrypted = safeStorage.decryptString(encrypted)
    cachedTokens = JSON.parse(decrypted) as AuthTokens
    return cachedTokens
  } catch {
    // Missing file or failed decrypt: treat as signed out.
    return null
  }
}

/** Forget tokens everywhere: in-memory cache and the on-disk file. */
export function clearTokens(): void {
  cachedTokens = null
  try {
    fs.rmSync(getAuthFilePath(), { force: true })
  } catch {
    // Nothing to remove.
  }
}

/** Renderer-safe auth status derived from the stored access-token claims. Never exposes tokens. */
export function getAuthStatus(): AuthStatus {
  const tokens = loadTokens()
  return tokens ? statusFromAccessToken(tokens.accessToken) : { signedIn: false }
}

/** @internal — reset module state between unit tests. */
export function _resetForTest(): void {
  cachedTokens = null
  authFilePath = null
  secureStorageUnavailable = false
}
