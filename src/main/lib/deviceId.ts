/**
 * Per-installation device identifier.
 *
 * `installation_id` is computed as `SHA-256(machine_id + ':' + salt)`. It is
 * deterministic per machine (same OS-user account, same hardware) and
 * survives a clean reinstall. Another Comfy product can emit the same value
 * for property-level analysis joins; this value is never a PostHog identity.
 *
 * On first boot post-upgrade, a legacy random `device-id.txt` is replaced by
 * the deterministic installation property. Desktop intentionally performs no
 * PostHog alias write; historical reconciliation is handled directly there.
 *
 * On Linux the SMBIOS product UUID is usually root-only, so a normal user
 * gets no hardware id. There the machine id falls back to `/etc/machine-id`
 * (world-readable, stable per OS install), hashed the same way. Cloned
 * images that share a machine-id share an installation id, as cloned VMs
 * sharing an SMBIOS UUID already do. When no
 * machine id is available at all, a previously persisted installation id is
 * reused rather than replaced, so the id stays stable across launches.
 *
 * Synchronous `getDeviceId()` is preserved for backward compatibility with
 * the existing IPC handler and main-process call sites. It must only be
 * called after `initDeviceId()` has resolved; if called earlier it falls back
 * to a random UUID flagged as `'random_fallback'` so dashboards can spot it.
 */
import { randomUUID, createHash } from 'crypto'
import path from 'path'
import fs from 'fs'
import si from 'systeminformation'
import { configDir } from './paths'

/**
 * Public namespacing salt for installation_id derivation. Two real jobs:
 *
 *   1. Rotation lever — bumping the version suffix (`-v1` → `-v2`)
 *      invalidates every previously-issued installation_id at once.
 *      Useful as a nuclear option for invalidating property-level joins
 *      after an incident; this does not change PostHog person identity.
 *      Exception: an install with no machine id keeps its persisted id
 *      (see `initDeviceId`), so a bump does not reach it. Such ids are
 *      random, so no other product can compute them to join against.
 *   2. Future namespace alignment — if another Comfy product later ships
 *      telemetry with this same constant, analytics can join their events by
 *      property without treating the machine hash as a person identity.
 *
 * Cryptographically this is friction, not privacy: the salt is in every
 * shipped binary, so an attacker with the binary can extract it. Real
 * privacy comes from consent gating, PII scrubbing, retention limits,
 * and the discipline of never sending `machine_id` off the device — only
 * the hash digest leaves.
 */
const INSTALLATION_ID_SALT = 'comfy-installation-id-v1'

export type IdClass = 'machine_derived' | 'random_fallback'

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

/**
 * Non-consuming check of the first-launch marker. Fails closed: treating a
 * fresh install as existing only loses website-ID attribution.
 */
export function hasCompletedFirstLaunch(): boolean {
  try {
    return fs.existsSync(firstLaunchGuardPath())
  } catch {
    return true
  }
}

/**
 * One-shot first-launch marker. Returns `true` exactly once per installation
 * (the first boot where the guard file does not yet exist) and writes the
 * guard so every later boot returns `false`. Best-effort: a failed write
 * leaves the marker absent, so a later boot would re-fire — over-counting
 * rather than losing the first-launch anchor of the acquisition funnel.
 */
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
  } catch {
    // best-effort persist
  }
  return true
}

/**
 * Path of a legacy alias retry marker some installs still carry. Nothing
 * writes it; boot unconditionally removes it.
 */
function legacyIdentityRetryPath(): string {
  return path.join(configDir(), 'pending-identity-alias.txt')
}

const LEGACY_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const INSTALLATION_ID_RE = /^[0-9a-f]{64}$/

function isLegacyUuid(value: string): boolean {
  return LEGACY_UUID_RE.test(value)
}

/**
 * Hard cap on how long we block boot waiting for `systeminformation`'s
 * platform-specific lookups (SMBIOS / WMI / `/sys/class/dmi/id/...`).
 * On VMs and certain firmwares this call can stall for several seconds;
 * past this budget we fall through to `random_fallback` so the splash
 * screen does not freeze on a slow `dmidecode` shell-out.
 */
const MACHINE_ID_TIMEOUT_MS = 2000

async function deriveMachineId(): Promise<{ machineId: string; idClass: IdClass }> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const sysPromise = si.system()
    const timeoutPromise = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), MACHINE_ID_TIMEOUT_MS)
    })
    const sys = await Promise.race([sysPromise, timeoutPromise])
    if (sys) {
      const uuid = (sys.uuid || '').trim()
      // Reject placeholder-style UUIDs that some firmware reports, plus
      // anything that isn't the full 36-char UUID shape (covers empty
      // strings on restricted Linux reads, OEM sentinels like "Default
      // string" / "To Be Filled By O.E.M.", etc.).
      if (uuid.length === 36 && uuid !== '-' && uuid !== '00000000-0000-0000-0000-000000000000') {
        return { machineId: uuid, idClass: 'machine_derived' }
      }
      // The lookup answered without a usable UUID, which is the steady state
      // for a non-root Linux user. A timeout or throw is not: it can be a
      // one-off, and switching sources for one launch would change the id.
      const linuxMachineId = readLinuxMachineId()
      if (linuxMachineId) return { machineId: linuxMachineId, idClass: 'machine_derived' }
    }
  } catch {
    // fall through to fallback
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
  // Fallback: random UUID, flagged so dashboards can quarantine.
  return { machineId: randomUUID(), idClass: 'random_fallback' }
}

/**
 * systemd's machine id, with the pre-systemd D-Bus location as a second
 * source. Both are world-readable, unlike `/sys/class/dmi/id/product_uuid`.
 * Only ever used as hash input: systemd documents the raw value as
 * confidential, so it must not leave the device.
 */
const LINUX_MACHINE_ID_PATHS = ['/etc/machine-id', '/var/lib/dbus/machine-id']

const MACHINE_ID_RE = /^[0-9a-f]{32}$/

function readLinuxMachineId(): string | null {
  if (process.platform !== 'linux') return null
  for (const filePath of LINUX_MACHINE_ID_PATHS) {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8').trim().toLowerCase()
      // Rejects empty files (image builds) and systemd's "uninitialized".
      if (MACHINE_ID_RE.test(raw) && raw !== '0'.repeat(32)) return raw
    } catch {
      // try the next location
    }
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
  } catch {
    // best-effort persist; in-memory cache serves the rest of the session
  }
}

function readLegacyIdentityRetryMarker(): string | null {
  try {
    const raw = fs.readFileSync(legacyIdentityRetryPath(), 'utf-8').trim()
    return raw.length > 0 ? raw : null
  } catch {
    return null
  }
}

/**
 * Remove an obsolete alias retry marker written by earlier versions.
 */
export function clearLegacyIdentityRetryMarker(): void {
  try {
    fs.unlinkSync(legacyIdentityRetryPath())
  } catch {
    // best effort — already gone is fine.
  }
}

/**
 * Initialize the device identity. Idempotent within a process — repeated
 * calls return the same promise.
 *
 * Returns a legacy id only so boot can retire obsolete local migration state.
 * The value is never sent to PostHog by Desktop.
 *
 * Must be called once at app startup, before any synchronous
 * `getDeviceId()` consumer runs.
 */
export function initDeviceId(): Promise<{ legacyId: string | null }> {
  if (initPromise) return initPromise
  initPromise = (async () => {
    const filePath = deviceIdPath()
    const { machineId, idClass } = await deriveMachineId()

    let existing: string | null = null
    try {
      const raw = fs.readFileSync(filePath, 'utf-8').trim()
      if (raw.length > 0) existing = raw
    } catch {
      // file does not exist yet
    }

    // Without a machine id, keep a persisted installation id instead of
    // replacing it with a fresh random one on every launch. Legacy UUIDs and
    // unreadable content still get a new id. The class stays
    // `random_fallback`: this launch cannot vouch for where the id came from.
    const newId =
      idClass === 'random_fallback' && existing != null && INSTALLATION_ID_RE.test(existing)
        ? existing
        : computeInstallationId(machineId)

    cached = { installationId: newId, idClass }

    // If an older build recorded a legacy-id retry marker, surface it once so
    // boot can remove that obsolete state. Takes precedence because by
    // the time we get here the `device-id.txt` was already rewritten
    // on that earlier boot, so `existing` no longer reveals it.
    const persistedLegacy = !isMigrationCompleted() ? readLegacyIdentityRetryMarker() : null
    if (persistedLegacy) {
      // Keep the on-disk hash in sync with the freshly-computed value
      // (no-op when they already match) but do NOT clear the pending
      // marker — boot removes it after this migration step.
      if (existing !== newId) writeIdFile(newId)
      return { legacyId: persistedLegacy }
    }

    if (existing === newId) {
      return { legacyId: null }
    }

    // Existing differs from what we'd compute. Three cases:
    //   (a) existing is a legacy UUID -> first local migration.
    //   (b) existing is a 64-char hex (different hash) -> a random id
    //       persisted by an earlier launch without a machine id (the common
    //       Linux case), salt rotated, or cross-machine copy. Update
    //       silently. Only reachable with a machine id; without one, a
    //       64-char hex was reused above.
    //   (c) existing is garbage -> overwrite.
    const isLegacy = existing != null && isLegacyUuid(existing) && !isMigrationCompleted()

    writeIdFile(newId)
    return { legacyId: isLegacy ? existing : null }
  })()
  return initPromise
}

/**
 * Synchronous accessor for the bound installation id.
 *
 * Must only be called after `initDeviceId()` has resolved. If called earlier,
 * falls back to a random UUID flagged as `'random_fallback'` so a misordered
 * call never throws and the data is still distinguishable from machine-derived
 * ids in PostHog.
 */
export function getDeviceId(): string {
  if (cached) return cached.installationId

  // Degraded path — getDeviceId() was called before initDeviceId() resolved.
  // Try the on-disk value first; if it's a previously-computed id, use it.
  // Otherwise produce a random UUID (flagged) and persist it best-effort.
  try {
    const raw = fs.readFileSync(deviceIdPath(), 'utf-8').trim()
    if (raw.length > 0) {
      cached = { installationId: raw, idClass: 'random_fallback' }
      return raw
    }
  } catch {
    // fall through
  }
  const id = randomUUID()
  cached = { installationId: id, idClass: 'random_fallback' }
  writeIdFile(id)
  return id
}

export function getIdClass(): IdClass {
  return cached?.idClass ?? 'random_fallback'
}

/**
 * Record completion of the local UUID-to-installation-property migration.
 */
export function markIdentityMigrationCompleted(): void {
  try {
    fs.mkdirSync(path.dirname(migrationGuardPath()), { recursive: true })
    fs.writeFileSync(migrationGuardPath(), new Date().toISOString())
  } catch {
    // best effort
  }
}

/** @internal — exposed for tests. */
export function _resetForTest(): void {
  cached = null
  initPromise = null
}
