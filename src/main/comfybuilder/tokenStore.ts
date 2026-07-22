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
  fs.writeFileSync(getAuthFilePath(), encrypted)
}

/** Return cached tokens, hydrating once from the encrypted file. Null when absent or unreadable. */
export function loadTokens(): AuthTokens | null {
  if (cachedTokens) return cachedTokens
  if (!encryptionAvailable()) return cachedTokens
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

interface JwtClaims {
  email?: string
  workspace_id?: string
  workspace_type?: string
  role?: string
}

/** Decode a JWT payload (the base64url middle segment). Null on any malformed input. */
function decodeJwtPayload(token: string): JwtClaims | null {
  const payloadSegment = token.split('.')[1]
  if (!payloadSegment) return null
  try {
    const json = Buffer.from(payloadSegment, 'base64url').toString('utf-8')
    const parsed: unknown = JSON.parse(json)
    if (!parsed || typeof parsed !== 'object') return null
    return parsed as JwtClaims
  } catch {
    return null
  }
}

/** Renderer-safe auth status derived from the stored access-token claims. Never exposes tokens. */
export function getAuthStatus(): AuthStatus {
  const tokens = loadTokens()
  if (!tokens) return { signedIn: false }
  const claims = decodeJwtPayload(tokens.accessToken)
  return {
    signedIn: true,
    email: claims?.email,
    workspaceId: claims?.workspace_id,
    workspaceType: claims?.workspace_type,
    role: claims?.role,
  }
}

/** @internal — reset module state between unit tests. */
export function _resetForTest(): void {
  cachedTokens = null
  authFilePath = null
  secureStorageUnavailable = false
}
