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
    try {
      fs.rmSync(filePath(), { force: true })
    } catch {}
    return
  }
  try {
    fs.writeFileSync(filePath(), safeStorage.encryptString(JSON.stringify(vault)))
  } catch {}
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
      const migrated = vaultFor(parsed)
      persistVault(migrated)
      return migrated
    }
    return null
  } catch {
    return null
  }
}

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

export function loadTokens(): AuthTokens | null {
  const vault = loadVault()
  return vault?.bundles[vault.activeKey] ?? null
}

export function loadWorkspaceTokens(workspaceId: string | null): AuthTokens | null {
  return loadVault()?.bundles[workspaceKey(workspaceId)] ?? null
}

export function saveWorkspaceNames(accessToken: string, workspaces: Workspace[]): void {
  const vault = loadVault()
  const subject = subjectOf(accessToken)
  if (!vault || !subject || vault.subject !== subject) return
  vault.workspaceNames = Object.fromEntries(
    workspaces.map((workspace) => [workspace.id, workspace.name])
  )
  persistVault(vault)
}

export function getCachedWorkspaceName(workspaceId: string): string | null {
  return loadVault()?.workspaceNames?.[workspaceId] ?? null
}

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
  } catch {}
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

export function _resetForTest(): void {
  cachedVault = null
  authFilePath = null
  secureStorageUnavailable = false
}
