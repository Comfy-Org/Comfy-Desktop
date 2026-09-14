/**
 * OAuth token store (main process only). Tokens are encrypted at rest with
 * Electron `safeStorage` in `userData/comfy-cloud-auth.bin` and never reach the
 * renderer, logs, or disk in plaintext. When the OS secure-storage backend is
 * unavailable, tokens are kept in memory for the process lifetime only.
 */
import { app, safeStorage } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

import { statusFromAccessToken, subjectOf, workspaceIdOf } from './claims'
import type { AuthStatus, AuthTokens, Workspace } from './types'

const AUTH_FILENAME = 'comfy-cloud-auth.bin'
const VAULT_VERSION = 1
const DEFAULT_WORKSPACE_KEY = 'default'

interface TokenVault {
  version: typeof VAULT_VERSION
  activeKey: string
  subject?: string
  bundles: Record<string, AuthTokens>
  workspaceNames?: Record<string, string>
}

let cachedVault: TokenVault | null = null
let authFilePath: string | null = null
let secureStorageUnavailable = false

/** True when the last save/load found no OS secure-storage backend, so tokens
 *  live only in memory for this process. False before any check has run. A
 *  getter rather than an exported binding: a re-exported `let` can be captured
 *  stale after CJS transpilation. */
export function isSecureStorageUnavailable(): boolean {
  return secureStorageUnavailable
}

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

function isVault(v: unknown): v is TokenVault {
  const vault = v as TokenVault
  if (
    !v ||
    typeof v !== 'object' ||
    vault.version !== VAULT_VERSION ||
    typeof vault.activeKey !== 'string' ||
    (vault.subject !== undefined && typeof vault.subject !== 'string') ||
    !vault.bundles ||
    typeof vault.bundles !== 'object' ||
    Array.isArray(vault.bundles) ||
    (vault.workspaceNames !== undefined &&
      (!vault.workspaceNames ||
        typeof vault.workspaceNames !== 'object' ||
        Array.isArray(vault.workspaceNames) ||
        !Object.values(vault.workspaceNames).every((name) => typeof name === 'string')))
  ) {
    return false
  }
  return isTokens(vault.bundles[vault.activeKey]) && Object.values(vault.bundles).every(isTokens)
}

function workspaceKey(workspaceId: string | null): string {
  return workspaceId === null ? DEFAULT_WORKSPACE_KEY : `workspace:${workspaceId}`
}

function tokensKey(tokens: AuthTokens): string {
  return workspaceKey(workspaceIdOf(tokens.accessToken))
}

function vaultFor(tokens: AuthTokens): TokenVault {
  const key = tokensKey(tokens)
  const subject = subjectOf(tokens.accessToken)
  return {
    version: VAULT_VERSION,
    activeKey: key,
    ...(subject ? { subject } : {}),
    bundles: { [key]: tokens }
  }
}

function persistVault(vault: TokenVault): void {
  cachedVault = vault
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
    fs.writeFileSync(filePath(), safeStorage.encryptString(JSON.stringify(vault)))
  } catch {
    // A failed persist must not fail the sign-in the user just completed; the
    // in-memory cache still holds the tokens for this session.
  }
}

function loadVault(): TokenVault | null {
  if (cachedVault) return cachedVault
  if (!encryptionAvailable()) return null
  try {
    const parsed: unknown = JSON.parse(safeStorage.decryptString(fs.readFileSync(filePath())))
    if (isVault(parsed)) {
      cachedVault = parsed
      return cachedVault
    }
    if (isTokens(parsed)) {
      // Migrate the original single-token payload without signing the user out.
      const migrated = vaultFor(parsed)
      persistVault(migrated)
      return migrated
    }
    return null
  } catch {
    return null
  }
}

/** Save and activate a browser-auth token bundle. A changed account replaces the vault. */
export function saveTokens(tokens: AuthTokens): void {
  const current = loadVault()
  const nextSubject = subjectOf(tokens.accessToken)
  const accountChanged = current !== null && (!nextSubject || current.subject !== nextSubject)
  const vault = accountChanged || !current ? vaultFor(tokens) : current
  const key = tokensKey(tokens)
  vault.activeKey = key
  vault.bundles[key] = tokens
  if (nextSubject) vault.subject = nextSubject
  persistVault(vault)
}

/** The active workspace's token bundle. */
export function loadTokens(): AuthTokens | null {
  const vault = loadVault()
  return vault?.bundles[vault.activeKey] ?? null
}

/** A cached workspace token bundle, without changing the active workspace. */
export function loadWorkspaceTokens(workspaceId: string | null): AuthTokens | null {
  return loadVault()?.bundles[workspaceKey(workspaceId)] ?? null
}

/** Cache workspace names only when the response belongs to the current account. */
export function saveWorkspaceNames(accessToken: string, workspaces: Workspace[]): void {
  const vault = loadVault()
  const subject = subjectOf(accessToken)
  if (!vault || !subject || vault.subject !== subject) return
  vault.workspaceNames = Object.fromEntries(
    workspaces.map((workspace) => [workspace.id, workspace.name])
  )
  persistVault(vault)
}

/** Activate a cached workspace. Returns null when it has never been authorized. */
export function activateWorkspace(workspaceId: string): AuthTokens | null {
  const vault = loadVault()
  if (!vault) return null
  const key = workspaceKey(workspaceId)
  const tokens = vault.bundles[key]
  if (!tokens) return null
  vault.activeKey = key
  persistVault(vault)
  return tokens
}

/** Compare-and-swap one workspace's tokens after refresh rotation. */
export function replaceWorkspaceTokens(
  workspaceId: string | null,
  expectedAccessToken: string,
  expectedRefreshToken: string,
  tokens: AuthTokens
): boolean {
  const vault = loadVault()
  if (!vault) return false
  const key = workspaceKey(workspaceId)
  const current = vault.bundles[key]
  if (
    !current ||
    current.accessToken !== expectedAccessToken ||
    current.refreshToken !== expectedRefreshToken ||
    workspaceIdOf(tokens.accessToken) !== workspaceId ||
    subjectOf(tokens.accessToken) !== subjectOf(current.accessToken)
  ) {
    return false
  }
  vault.bundles[key] = tokens
  persistVault(vault)
  return true
}

export function clearTokens(): void {
  cachedVault = null
  try {
    fs.rmSync(filePath(), { force: true })
  } catch {
    /* nothing to remove */
  }
}

export function getAuthStatus(): AuthStatus {
  const t = loadTokens()
  if (!t) return { signedIn: false }
  const status = statusFromAccessToken(t.accessToken)
  const workspaceName = status.workspaceId
    ? loadVault()?.workspaceNames?.[status.workspaceId]
    : undefined
  return workspaceName ? { ...status, workspaceName } : status
}

/** @internal reset module state between unit tests. */
export function _resetForTest(): void {
  cachedVault = null
  authFilePath = null
  secureStorageUnavailable = false
}
