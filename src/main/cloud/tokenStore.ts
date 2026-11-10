import { createHash } from 'crypto'
import { app, safeStorage } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

import { statusFromAccessToken, subjectOf, workspaceIdOf } from './claims'
import { CLOUD_CONFIG } from './config'
import type { AuthStatus, AuthTokens, Workspace } from './types'

const AUTH_FILENAME = 'comfy-cloud-auth.bin'
const REVOCATIONS_DIRNAME = 'comfy-cloud-revocations'
const VAULT_VERSION = 2

export interface GrantOrigin {
  issuer: string
  clientId: string
}

interface TokenVault {
  version: typeof VAULT_VERSION
  issuer?: string
  clientId?: string
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

export interface PendingRevocation extends GrantOrigin {
  refreshToken: string
  queuedAt: number
}

let cachedVault: TokenVault | null = null
const unsavedRevocations = new Map<string, PendingRevocation>()
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
    (v.issuer === undefined || typeof v.issuer === 'string') &&
    (v.clientId === undefined || typeof v.clientId === 'string') &&
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

function persistVault(vault: TokenVault): boolean {
  cachedVault = vault
  if (!encryptionAvailable()) {
    try {
      fs.rmSync(filePath(), { force: true })
      return true
    } catch {
      return false
    }
  }
  try {
    fs.writeFileSync(filePath(), safeStorage.encryptString(JSON.stringify(vault)))
    return true
  } catch {
    return false
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

export function saveGrant(grant: AuthTokens): boolean {
  const current = loadVault()
  const subject = subjectOf(grant.accessToken)
  if (!current || !subject || current.subject !== subject) {
    return persistVault({ ...vaultFor(grant), ...configuredOrigin() })
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
  Object.assign(current, configuredOrigin())
  if (!holdsToken(current, current.activeWorkspaceId))
    current.activeWorkspaceId = workspaceIdOf(grant.accessToken)
  return persistVault(current)
}

export function loadGrant(): AuthTokens | null {
  return loadVault()?.grant ?? null
}

function configuredOrigin(): GrantOrigin {
  return { issuer: CLOUD_CONFIG.issuer, clientId: CLOUD_CONFIG.clientId }
}

export function loadGrantOrigin(): GrantOrigin | null {
  const vault = loadVault()
  if (!vault) return null
  if (!vault.issuer || !vault.clientId) return configuredOrigin()
  return { issuer: vault.issuer, clientId: vault.clientId }
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
  return loadVault()?.workspaceNames?.[workspaceId] ?? null
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
  Object.assign(vault, configuredOrigin())
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

function revocationsDir(): string {
  return path.join(app.getPath('userData'), REVOCATIONS_DIRNAME)
}

function revocationPath(refreshToken: string): string {
  const name = createHash('sha256').update(refreshToken).digest('hex')
  return path.join(revocationsDir(), `${name}.bin`)
}

function isSavedRevocation(
  v: unknown
): v is Omit<PendingRevocation, 'queuedAt'> & { queuedAt?: number } {
  return (
    isRecord(v) &&
    typeof v.issuer === 'string' &&
    typeof v.clientId === 'string' &&
    typeof v.refreshToken === 'string' &&
    (v.queuedAt === undefined || typeof v.queuedAt === 'number')
  )
}

function writeRevocation(revocation: PendingRevocation): boolean {
  if (!encryptionAvailable()) return false
  const target = revocationPath(revocation.refreshToken)
  try {
    fs.mkdirSync(revocationsDir(), { recursive: true })
    fs.writeFileSync(`${target}.tmp`, safeStorage.encryptString(JSON.stringify(revocation)))
    fs.renameSync(`${target}.tmp`, target)
    return true
  } catch {
    removeQuietly(`${target}.tmp`)
    return false
  }
}

export interface PendingRevocations {
  pending: PendingRevocation[]
  complete: boolean
}

function readSavedRevocations(): PendingRevocations {
  let names: string[]
  try {
    names = fs.readdirSync(revocationsDir()).filter((name) => name.endsWith('.bin'))
  } catch (error) {
    return { pending: [], complete: (error as NodeJS.ErrnoException).code === 'ENOENT' }
  }
  if (names.length > 0 && !encryptionAvailable()) return { pending: [], complete: false }
  const pending = names.flatMap((name) => {
    try {
      const file = path.join(revocationsDir(), name)
      const parsed: unknown = JSON.parse(safeStorage.decryptString(fs.readFileSync(file)))
      if (!isSavedRevocation(parsed)) return []
      return [{ ...parsed, queuedAt: parsed.queuedAt ?? fs.statSync(file).mtimeMs }]
    } catch {
      return []
    }
  })
  return { pending, complete: pending.length === names.length }
}

export function loadPendingRevocations(): PendingRevocations {
  for (const [refreshToken, revocation] of unsavedRevocations) {
    if (writeRevocation(revocation)) unsavedRevocations.delete(refreshToken)
  }
  const saved = readSavedRevocations()
  const savedTokens = new Set(saved.pending.map((entry) => entry.refreshToken))
  const unsaved = [...unsavedRevocations.values()].filter(
    (entry) => !savedTokens.has(entry.refreshToken)
  )
  return { pending: [...saved.pending, ...unsaved], complete: saved.complete }
}

export function addPendingRevocation(revocation: PendingRevocation): void {
  if (!writeRevocation(revocation)) unsavedRevocations.set(revocation.refreshToken, revocation)
}

export function removePendingRevocation(refreshToken: string): boolean {
  unsavedRevocations.delete(refreshToken)
  removeQuietly(`${revocationPath(refreshToken)}.tmp`)
  try {
    fs.rmSync(revocationPath(refreshToken), { force: true })
    return true
  } catch {
    return false
  }
}

function removeQuietly(file: string): void {
  try {
    fs.rmSync(file, { force: true })
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
  unsavedRevocations.clear()
  authFilePath = null
  secureStorageUnavailable = false
}
