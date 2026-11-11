import { app, safeStorage } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

import { statusFromAccessToken, subjectOf, workspaceIdOf } from './claims'
import type { AuthStatus, AuthTokens, Workspace } from './types'

const AUTH_FILENAME = 'comfy-cloud-auth.bin'
const VAULT_VERSION = 2

interface TokenVault {
  version: typeof VAULT_VERSION
  subject?: string
  grant: AuthTokens
  activeWorkspaceId: string | null
  workspaceTokens: Record<string, AuthTokens>
  workspaceNames?: Record<string, string>
}

interface LegacyVault {
  version: 1
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

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function isWorkspaceNames(v: unknown): boolean {
  return (
    v === undefined || (isRecord(v) && Object.values(v).every((name) => typeof name === 'string'))
  )
}

function isVault(v: unknown): v is TokenVault {
  if (!isRecord(v) || v.version !== VAULT_VERSION) return false
  return (
    isTokens(v.grant) &&
    (v.activeWorkspaceId === null || typeof v.activeWorkspaceId === 'string') &&
    (v.subject === undefined || typeof v.subject === 'string') &&
    isRecord(v.workspaceTokens) &&
    Object.values(v.workspaceTokens).every(isTokens) &&
    isWorkspaceNames(v.workspaceNames)
  )
}

function isLegacyVault(v: unknown): v is LegacyVault {
  if (!isRecord(v) || v.version !== 1 || typeof v.activeKey !== 'string') return false
  return (
    (v.subject === undefined || typeof v.subject === 'string') &&
    isRecord(v.bundles) &&
    Object.values(v.bundles).every(isTokens) &&
    isWorkspaceNames(v.workspaceNames)
  )
}

function vaultFor(grant: AuthTokens): TokenVault {
  const subject = subjectOf(grant.accessToken)
  return {
    version: VAULT_VERSION,
    ...(subject ? { subject } : {}),
    grant,
    activeWorkspaceId: workspaceIdOf(grant.accessToken),
    workspaceTokens: {}
  }
}

function migratedVault(legacy: LegacyVault): TokenVault | null {
  const active = legacy.bundles[legacy.activeKey]
  if (!active) return null
  return {
    ...vaultFor(active),
    ...(legacy.subject ? { subject: legacy.subject } : {}),
    ...(legacy.workspaceNames ? { workspaceNames: legacy.workspaceNames } : {})
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
    const migrated = isLegacyVault(parsed)
      ? migratedVault(parsed)
      : isTokens(parsed)
        ? vaultFor(parsed)
        : null
    if (migrated) persistVault(migrated)
    return migrated
  } catch {
    return null
  }
}

function holdsToken(vault: TokenVault, workspaceId: string | null): boolean {
  return (
    workspaceId === workspaceIdOf(vault.grant.accessToken) ||
    (workspaceId !== null && workspaceId in vault.workspaceTokens)
  )
}

export function saveGrant(grant: AuthTokens): void {
  const current = loadVault()
  const subject = subjectOf(grant.accessToken)
  if (!current || !subject || current.subject !== subject) {
    persistVault(vaultFor(grant))
    return
  }
  const previous = current.grant
  const previousAnchor = workspaceIdOf(previous.accessToken)
  if (
    previousAnchor &&
    previousAnchor !== workspaceIdOf(grant.accessToken) &&
    previous.expiresAt > Date.now()
  ) {
    current.workspaceTokens[previousAnchor] = {
      accessToken: previous.accessToken,
      expiresAt: previous.expiresAt
    }
  }
  current.grant = grant
  if (!holdsToken(current, current.activeWorkspaceId))
    current.activeWorkspaceId = workspaceIdOf(grant.accessToken)
  persistVault(current)
}

export function loadGrant(): AuthTokens | null {
  return loadVault()?.grant ?? null
}

export function loadActiveWorkspaceId(): string | null {
  return loadVault()?.activeWorkspaceId ?? null
}

export function loadWorkspaceToken(workspaceId: string): AuthTokens | null {
  return loadVault()?.workspaceTokens[workspaceId] ?? null
}

export function saveWorkspaceToken(workspaceId: string, tokens: AuthTokens): void {
  const vault = loadVault()
  if (!vault) return
  vault.workspaceTokens[workspaceId] = tokens
  persistVault(vault)
}

export function dropWorkspaceToken(accessToken: string): boolean {
  const vault = loadVault()
  if (!vault) return false
  const entry = Object.entries(vault.workspaceTokens).find(
    ([, tokens]) => tokens.accessToken === accessToken
  )
  if (!entry) return false
  delete vault.workspaceTokens[entry[0]]
  persistVault(vault)
  return true
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
  const names = loadVault()?.workspaceNames
  return names && Object.hasOwn(names, workspaceId) ? (names[workspaceId] ?? null) : null
}

export function activateWorkspace(workspaceId: string): boolean {
  const vault = loadVault()
  if (!vault || !holdsToken(vault, workspaceId)) return false
  vault.activeWorkspaceId = workspaceId
  persistVault(vault)
  return true
}

export function replaceGrant(
  expectedAccessToken: string,
  expectedRefreshToken: string,
  grant: AuthTokens
): boolean {
  const vault = loadVault()
  if (
    !vault ||
    vault.grant.accessToken !== expectedAccessToken ||
    vault.grant.refreshToken !== expectedRefreshToken ||
    workspaceIdOf(grant.accessToken) !== workspaceIdOf(expectedAccessToken) ||
    subjectOf(grant.accessToken) !== subjectOf(expectedAccessToken)
  ) {
    return false
  }
  vault.grant = grant
  persistVault(vault)
  return true
}

export function endGrant(expectedAccessToken: string): void {
  const vault = loadVault()
  if (!vault || vault.grant.accessToken !== expectedAccessToken) return
  const { refreshToken: _ended, ...grant } = vault.grant
  vault.grant = grant
  persistVault(vault)
}

export function clearTokens(): void {
  cachedVault = null
  try {
    fs.rmSync(filePath(), { force: true })
  } catch {}
}

function activeToken(vault: TokenVault): string | null {
  const active = vault.activeWorkspaceId
  if (active === workspaceIdOf(vault.grant.accessToken)) return vault.grant.accessToken
  return (active && vault.workspaceTokens[active]?.accessToken) || null
}

export function getAuthStatus(): AuthStatus {
  const vault = loadVault()
  if (!vault) return { signedIn: false }
  const token = activeToken(vault)
  const status: AuthStatus = token
    ? statusFromAccessToken(token)
    : {
        signedIn: true,
        email: statusFromAccessToken(vault.grant.accessToken).email,
        workspaceId: vault.activeWorkspaceId ?? undefined
      }
  const workspaceName = status.workspaceId ? vault.workspaceNames?.[status.workspaceId] : undefined
  return workspaceName ? { ...status, workspaceName } : status
}

export function _resetForTest(): void {
  cachedVault = null
  authFilePath = null
  secureStorageUnavailable = false
}
