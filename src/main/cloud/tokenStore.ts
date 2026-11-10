/**
 * OAuth token store (main process only). Tokens are encrypted at rest with
 * Electron `safeStorage` in `userData/comfy-cloud-auth.bin` and never reach the
 * renderer, logs, or disk in plaintext. When the OS secure-storage backend is
 * unavailable, tokens are kept in memory for the process lifetime only.
 */
import { createHash } from 'crypto'
import { app, safeStorage } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

import { canMintWorkspaceTokens, statusFromAccessToken, subjectOf, workspaceIdOf } from './claims'
import { CLOUD_CONFIG } from './config'
import type { AuthStatus, AuthTokens, Workspace } from './types'

const AUTH_FILENAME = 'comfy-cloud-auth.bin'
const REVOCATIONS_DIRNAME = 'comfy-cloud-revocations'
const VAULT_VERSION = 2

/** The Cloud and OAuth client a grant was issued by. */
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
  mintScopeWithheld?: true
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

/** A signed-out grant's refresh token, kept until the Cloud that issued it confirms revocation. */
export interface PendingRevocation extends GrantOrigin {
  refreshToken: string
}

let cachedVault: TokenVault | null = null
const unsavedRevocations = new Map<string, PendingRevocation>()
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
    (v.mintScopeWithheld === undefined || v.mintScopeWithheld === true) &&
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

/** Store the grant from a browser sign-in. A changed account replaces the vault. The old access
 *  token stays held for its old anchor; an active workspace with no held token moves to the new one. */
export function saveGrant(grant: AuthTokens, options: { mintScopeWithheld?: boolean } = {}): void {
  const withheld = options.mintScopeWithheld ? ({ mintScopeWithheld: true } as const) : {}
  const current = loadVault()
  const subject = subjectOf(grant.accessToken)
  if (!current || !subject || current.subject !== subject) {
    persistVault({ ...vaultFor(grant), ...configuredOrigin(), ...withheld })
    return
  }
  delete current.mintScopeWithheld
  Object.assign(current, withheld)
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
  persistVault(current)
}

/** A browser sign-in returned this grant without the mint scope, so another trip would not help. */
export function isMintScopeWithheld(): boolean {
  return loadVault()?.mintScopeWithheld === true
}

/** The OAuth grant bundle, the only one carrying a refresh token. */
export function loadGrant(): AuthTokens | null {
  return loadVault()?.grant ?? null
}

function configuredOrigin(): GrantOrigin {
  return { issuer: CLOUD_CONFIG.issuer, clientId: CLOUD_CONFIG.clientId }
}

/** Where the stored grant came from: its browser sign-in or its last refresh. Null when unknown,
 *  as for a vault written before this was recorded and not refreshed since. */
export function loadGrantOrigin(): GrantOrigin | null {
  const vault = loadVault()
  if (!vault?.issuer || !vault.clientId) return null
  return { issuer: vault.issuer, clientId: vault.clientId }
}

/** The workspace API calls act in, or null when signed out or the grant has no workspace claim. */
export function loadActiveWorkspaceId(): string | null {
  return loadVault()?.activeWorkspaceId ?? null
}

/** A token minted for `workspaceId`, without changing the active workspace. */
export function loadWorkspaceToken(workspaceId: string): AuthTokens | null {
  return loadVault()?.workspaceTokens[workspaceId] ?? null
}

/** Store a token minted for `workspaceId`, without changing the active workspace. */
export function saveWorkspaceToken(workspaceId: string, tokens: AuthTokens): void {
  const vault = loadVault()
  if (!vault) return
  vault.workspaceTokens[workspaceId] = tokens
  persistVault(vault)
}

/** Forget the minted token with this exact value. False when no minted token matches. */
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

/** Return a cached workspace name by durable id without changing the active workspace. */
export function getCachedWorkspaceName(workspaceId: string): string | null {
  return loadVault()?.workspaceNames?.[workspaceId] ?? null
}

/** Make `workspaceId` active. False, and no change, unless it is the anchor or a token is held for it. */
export function activateWorkspace(workspaceId: string): boolean {
  const vault = loadVault()
  if (!vault || !holdsToken(vault, workspaceId)) return false
  vault.activeWorkspaceId = workspaceId
  persistVault(vault)
  return true
}

/** Compare-and-swap the grant after refresh rotation. */
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
  if (canMintWorkspaceTokens(grant.accessToken)) delete vault.mintScopeWithheld
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

function revocationsDir(): string {
  return path.join(app.getPath('userData'), REVOCATIONS_DIRNAME)
}

function revocationPath(refreshToken: string): string {
  const name = createHash('sha256').update(refreshToken).digest('hex')
  return path.join(revocationsDir(), `${name}.bin`)
}

function isPendingRevocation(v: unknown): v is PendingRevocation {
  return (
    isRecord(v) &&
    typeof v.issuer === 'string' &&
    typeof v.clientId === 'string' &&
    typeof v.refreshToken === 'string'
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

/** The revocations still waiting for Cloud; `complete` is false when a saved one could not be read yet. */
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
      const parsed: unknown = JSON.parse(
        safeStorage.decryptString(fs.readFileSync(path.join(revocationsDir(), name)))
      )
      return isPendingRevocation(parsed) ? [parsed] : []
    } catch {
      return []
    }
  })
  return { pending, complete: pending.length === names.length }
}

/** One encrypted file per revocation, so no write can touch another. An entry that could not be
 *  saved stays in memory, and saving it is retried on every read. */
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

/** False when the saved entry could not be deleted. */
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
  } catch {
    // Retried with the entry's next removal.
  }
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

/** @internal reset module state between unit tests. */
export function _resetForTest(): void {
  cachedVault = null
  unsavedRevocations.clear()
  authFilePath = null
  secureStorageUnavailable = false
}
