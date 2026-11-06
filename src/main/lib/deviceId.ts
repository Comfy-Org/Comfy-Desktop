import { randomUUID, createHash } from 'crypto'
import path from 'path'
import fs from 'fs'
import si from 'systeminformation'
import { configDir } from './paths'

const INSTALLATION_ID_SALT = 'comfy-installation-id-v1'

export type IdClass = 'machine_derived' | 'random_fallback' | 'placeholder_fallback' | 'provisional'

interface CachedId {
  installationId: string
  idClass: IdClass
}

let cached: CachedId | null = null
let initPromise: Promise<{ legacyId: string | null }> | null = null

function deviceIdPath(): string {
  return path.join(configDir(), 'device-id.txt')
}

export function hasPersistedDeviceId(): boolean {
  try {
    return fs.existsSync(deviceIdPath())
  } catch {
    return false
  }
}

function migrationGuardPath(): string {
  return path.join(configDir(), 'identity-migration-completed')
}

function firstLaunchGuardPath(): string {
  return path.join(configDir(), 'first-launch-completed')
}

export function hasCompletedFirstLaunch(): boolean {
  try {
    return fs.existsSync(firstLaunchGuardPath())
  } catch {
    return true
  }
}

export function consumeFirstLaunch(): boolean {
  let isFirst: boolean
  try {
    isFirst = !fs.existsSync(firstLaunchGuardPath())
  } catch {
    isFirst = false
  }
  if (!isFirst) return false
  try {
    fs.mkdirSync(path.dirname(firstLaunchGuardPath()), { recursive: true })
    fs.writeFileSync(firstLaunchGuardPath(), new Date().toISOString())
  } catch {}
  return true
}

function legacyIdentityRetryPath(): string {
  return path.join(configDir(), 'pending-identity-alias.txt')
}

const LEGACY_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const INSTALLATION_ID_RE = /^[0-9a-f]{64}$/

function isLegacyUuid(value: string): boolean {
  return LEGACY_UUID_RE.test(value)
}

const MACHINE_ID_TIMEOUT_MS = 2000

const HUNG_LOOKUP_MS = 60_000

async function lookupHardwareUuid(): Promise<{ uuid?: string }> {
  if (process.platform === 'win32') return { uuid: (await si.uuid()).hardware }
  return si.system()
}

let lookup: Promise<{ uuid?: string }> | null = null

export function startMachineIdLookup(): Promise<{ uuid?: string }> {
  if (lookup) return lookup
  lookup = lookupHardwareUuid()
  lookup.catch(() => {})
  return lookup
}

const PLACEHOLDER_UUIDS = new Set([
  '03000200-0400-0500-0006-000700080009',
  '00020003-0004-0005-0006-000700080009',
  '12345678-1234-5678-90ab-cddeefaabbcc',
  '01234567-89ab-cdef-0123-456789abcdef'
])

export function isPlaceholderUuid(uuid: string): boolean {
  const normalized = uuid.toLowerCase()
  return PLACEHOLDER_UUIDS.has(normalized) || new Set(normalized.replace(/-/g, '')).size <= 2
}

let knownPlaceholderIds: Set<string> | null = null

function isKnownPlaceholderInstallationId(id: string): boolean {
  if (!knownPlaceholderIds) {
    const uuids = [...PLACEHOLDER_UUIDS, 'ffffffff-ffff-0000-0000-000000000000']
    for (const digit of '0123456789abcdef') {
      uuids.push([8, 4, 4, 4, 12].map((n) => digit.repeat(n)).join('-'))
    }
    knownPlaceholderIds = new Set(uuids.map(computeInstallationId))
  }
  return knownPlaceholderIds.has(id)
}

interface DerivedMachineId {
  machineId: string
  idClass: IdClass
  placeholderInstallationId?: string
  timedOut?: boolean
}

function answeredMachineId(sys: { uuid?: string }): DerivedMachineId {
  const uuid = (sys.uuid || '').trim()
  const wellFormed = uuid.length === 36
  const placeholder = wellFormed && isPlaceholderUuid(uuid)
  if (wellFormed && !placeholder) {
    return { machineId: uuid, idClass: 'machine_derived' }
  }
  const linuxMachineId = readLinuxMachineId()
  if (linuxMachineId) return { machineId: linuxMachineId, idClass: 'machine_derived' }
  if (placeholder) {
    return {
      machineId: randomUUID(),
      idClass: 'placeholder_fallback',
      placeholderInstallationId: computeInstallationId(uuid)
    }
  }
  return { machineId: randomUUID(), idClass: 'random_fallback' }
}

async function deriveMachineId(): Promise<DerivedMachineId> {
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const started = startMachineIdLookup()
    const timeoutPromise = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        timedOut = true
        resolve(null)
      }, MACHINE_ID_TIMEOUT_MS)
    })
    const sys = await Promise.race([started, timeoutPromise])
    if (sys) return answeredMachineId(sys)
  } catch {
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
  return { machineId: randomUUID(), idClass: 'random_fallback', timedOut }
}

const LINUX_MACHINE_ID_PATHS = ['/etc/machine-id', '/var/lib/dbus/machine-id']

const MACHINE_ID_RE = /^[0-9a-f]{32}$/

function readLinuxMachineId(): string | null {
  if (process.platform !== 'linux') return null
  for (const filePath of LINUX_MACHINE_ID_PATHS) {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8').trim().toLowerCase()
      if (MACHINE_ID_RE.test(raw) && raw !== '0'.repeat(32)) return raw
    } catch {}
  }
  return null
}

function computeInstallationId(machineId: string): string {
  return createHash('sha256').update(`${machineId}:${INSTALLATION_ID_SALT}`).digest('hex')
}

function isMigrationCompleted(): boolean {
  try {
    return fs.existsSync(migrationGuardPath())
  } catch {
    return false
  }
}

function writeIdFile(installationId: string): void {
  const filePath = deviceIdPath()
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, installationId)
  } catch {}
}

function readLegacyIdentityRetryMarker(): string | null {
  try {
    const raw = fs.readFileSync(legacyIdentityRetryPath(), 'utf-8').trim()
    return raw.length > 0 ? raw : null
  } catch {
    return null
  }
}

export function clearLegacyIdentityRetryMarker(): void {
  try {
    fs.unlinkSync(legacyIdentityRetryPath())
  } catch {}
}

export function initDeviceId(): Promise<{ legacyId: string | null }> {
  if (initPromise) return initPromise
  initPromise = (async () => {
    const filePath = deviceIdPath()
    const { machineId, idClass, placeholderInstallationId, timedOut } = await deriveMachineId()

    let existing: string | null = null
    try {
      const raw = fs.readFileSync(filePath, 'utf-8').trim()
      if (raw.length > 0) existing = raw
    } catch {}

    const newId =
      idClass !== 'machine_derived' &&
      existing != null &&
      INSTALLATION_ID_RE.test(existing) &&
      existing !== placeholderInstallationId &&
      !isKnownPlaceholderInstallationId(existing)
        ? existing
        : computeInstallationId(machineId)

    if (timedOut && newId !== existing) {
      cached = { installationId: newId, idClass: 'provisional' }
      const hung = setTimeout(() => writeIdFile(newId), HUNG_LOOKUP_MS)
      hung.unref()
      void startMachineIdLookup().then(
        (sys) => {
          clearTimeout(hung)
          const late = answeredMachineId(sys)
          writeIdFile(
            late.idClass === 'machine_derived' ? computeInstallationId(late.machineId) : newId
          )
        },
        () => {
          clearTimeout(hung)
          writeIdFile(newId)
        }
      )
      return { legacyId: null }
    }

    cached = { installationId: newId, idClass }

    const persistedLegacy = !isMigrationCompleted() ? readLegacyIdentityRetryMarker() : null
    if (persistedLegacy) {
      if (existing !== newId) writeIdFile(newId)
      return { legacyId: persistedLegacy }
    }

    if (existing === newId) {
      return { legacyId: null }
    }

    const isLegacy = existing != null && isLegacyUuid(existing) && !isMigrationCompleted()

    writeIdFile(newId)
    return { legacyId: isLegacy ? existing : null }
  })()
  return initPromise
}

export function getDeviceId(): string {
  if (cached) return cached.installationId

  try {
    const raw = fs.readFileSync(deviceIdPath(), 'utf-8').trim()
    if (raw.length > 0) {
      cached = { installationId: raw, idClass: 'random_fallback' }
      return raw
    }
  } catch {}
  const id = randomUUID()
  cached = { installationId: id, idClass: 'random_fallback' }
  return id
}

export function getIdClass(): IdClass {
  return cached?.idClass ?? 'random_fallback'
}

export function markIdentityMigrationCompleted(): void {
  try {
    fs.mkdirSync(path.dirname(migrationGuardPath()), { recursive: true })
    fs.writeFileSync(migrationGuardPath(), new Date().toISOString())
  } catch {}
}

export function _resetForTest(): void {
  cached = null
  initPromise = null
  lookup = null
}
