import path from 'path'
import fs from 'fs'
import { EventEmitter } from 'events'
import { app } from 'electron'
import { dataDir } from './lib/paths'
import { readFileSafeAsync, writeFileSafe, writeFileSafeAsync } from './lib/safe-file'
import type { ComfyVersion } from './lib/version'

/** Event bus for installation lifecycle changes. `'updated'`(record) fires on
 *  `update()` / `markLaunched()` (main/index.ts refreshes title bars since the
 *  title bar isn't on the renderer broadcast); `'changed'`() fires on any
 *  list-affecting mutation and is rebroadcast as `installations-changed`. */
export const installationEvents = new EventEmitter()

/** Source id of the always-seeded Comfy Cloud entry. */
export const CLOUD_SOURCE_ID = 'cloud'
/** Canonical, non-user-editable name of the Comfy Cloud entry (issue #922). */
export const CLOUD_INSTALL_NAME = 'Comfy Cloud'

export interface InstallationRecord {
  id: string
  name: string
  createdAt: string
  installPath: string
  sourceId: string
  status?: string
  seen?: boolean
  comfyVersion?: ComfyVersion
  /** Epoch ms of the most recent launch, regardless of source category. */
  lastLaunchedAt?: number
  /** Most-recent launch ms keyed by source category; written together with
   *  `lastLaunchedAt` via `markLaunched()` so the two stay consistent. */
  lastLaunchedAtByCategory?: Record<string, number>
  /** When true (default), the global `modelsDirs` are included in the
   *  `--extra-model-paths-config` YAML so this install sees the shared model
   *  library. Per-install `modelDirs` apply regardless of this flag. */
  useSharedModels?: boolean
  /** When true (default), launch injects `--input-directory` from the global
   *  settings; else uses the per-install `inputDir` below or ComfyUI's
   *  `<installPath>/input` default. */
  useSharedInput?: boolean
  /** When true (default), launch injects `--output-directory` from the global
   *  settings; else uses the per-install `outputDir` below or ComfyUI's
   *  `<installPath>/output` default. */
  useSharedOutput?: boolean
  /** Per-install extra (external) model directories, always applied in
   *  addition to the shared dirs (when those are enabled). Never includes the
   *  install's own models dir. Written to the per-install
   *  `--extra-model-paths-config` YAML at launch. */
  modelDirs?: string[]
  /** Effective dir promoted to primary (`is_default`); may point at a shared
   *  or per-install dir. Null/absent means the first shared dir when shared
   *  models is on, else the install's own models dir (ComfyUI's built-in
   *  default). */
  modelDirsPrimary?: string | null
  /** Per-install input dir, used only when `useSharedInput === false`. */
  inputDir?: string
  /** Per-install output dir, used only when `useSharedOutput === false`. */
  outputDir?: string
  /** POC: starter template id the user picked in the install wizard. Durable
   *  record of intent; survives relaunches. */
  bundledTemplateId?: string
  /** Coarse model-download estimate (bytes) for `bundledTemplateId`, frozen from
   *  the wizard's hydrated value so the background download's progress denominator
   *  matches the consent label without re-fetching the template index. */
  bundledTemplateSizeBytes?: number
  /** One-shot flag consumed by the first launch — when set, the comfy URL is
   *  decorated with `?template=<id>` so the frontend auto-opens it, then this is
   *  cleared so subsequent relaunches start blank. */
  pendingTemplateOpen?: string | null
  /** When true, the install's `template-models` phase pre-downloads the chosen
   *  template's required models into the shared models dir. Set from the wizard
   *  consent checkbox; only meaningful alongside `bundledTemplateId`. */
  downloadTemplateModels?: boolean
  [key: string]: unknown
}

/**
 * In-memory migrations of legacy shared-storage flags, applied on every
 * `load()`; disk is cleaned on the next write.
 *
 * 1. `useSharedPaths` -> `useSharedModels` + `useSharedInputOutput`.
 *    `useSharedModels` is forced true (users who isolated paths almost
 *    certainly meant input/output, not their model library).
 * 2. `useSharedInputOutput` -> `useSharedInput` + `useSharedOutput`
 *    (per-folder granularity); both copy the legacy value.
 *
 * The steps chain, so a `useSharedPaths`-era record lands directly on the
 * current per-folder schema.
 */
function migrateRecord(record: InstallationRecord): InstallationRecord {
  let rec = record
  if ('useSharedPaths' in rec) {
    const legacy = rec.useSharedPaths as boolean | undefined
    const { useSharedPaths: _drop, ...rest } = rec
    rec = {
      ...rest,
      useSharedModels: true,
      useSharedInputOutput: typeof legacy === 'boolean' ? legacy : true
    } as InstallationRecord
  }
  if ('useSharedInputOutput' in rec) {
    const legacy = rec.useSharedInputOutput as boolean | undefined
    const value = typeof legacy === 'boolean' ? legacy : true
    const { useSharedInputOutput: _drop, ...rest } = rec
    // A mixed-schema record (downgrade/upgrade cycle) may already carry the
    // per-folder flags; those are newer, so they win over the legacy value.
    rec = {
      ...rest,
      useSharedInput: typeof rest.useSharedInput === 'boolean' ? rest.useSharedInput : value,
      useSharedOutput: typeof rest.useSharedOutput === 'boolean' ? rest.useSharedOutput : value
    } as InstallationRecord
  }
  return rec
}

const dataPath = path.join(dataDir(), 'installations.json')

/**
 * Monotonic install-id generator. A naive `inst-${Date.now()}` collides when
 * two `add()` calls land in the same millisecond, aliasing records in
 * `getRecent()`. Keeps the `inst-${ms}` shape but appends an in-process counter
 * for repeat calls within the same millisecond; the counter resets each tick.
 */
let _lastIdMs = 0
let _idSeq = 0
function nextInstallId(): string {
  const now = Date.now()
  if (now === _lastIdMs) {
    _idSeq += 1
    return `inst-${now}-${_idSeq}`
  }
  _lastIdMs = now
  _idSeq = 0
  return `inst-${now}`
}

// Serialize all load/save operations to prevent concurrent read-modify-write races
let _queue: Promise<void> = Promise.resolve()
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const p = _queue.then(fn)
  _queue = p.then(
    () => {},
    () => {}
  )
  return p
}

/** E2E-only: write `E2E_INSTALLATIONS_SEED` to installations.json before the
 *  first read, so the harness needn't guess the platform-specific data dir
 *  (XDG on Linux, userData elsewhere). Seeding before the first `load()` also
 *  guarantees the boot-time cloud-entry `ensureExists` merges on top of the
 *  seed and the renderer's one-shot store hydration sees it — a post-launch
 *  file write raced both. Runs at most once per process. */
let e2eSeedApplied = false
function maybeSeedFromEnv(): void {
  if (e2eSeedApplied) return
  e2eSeedApplied = true
  // Hard guard: never run in production builds.
  if (app.isPackaged) return
  if (process.env['E2E'] !== '1') return
  const seed = process.env['E2E_INSTALLATIONS_SEED']
  if (!seed) return
  // Drop the env var so the payload doesn't leak into child processes.
  delete process.env['E2E_INSTALLATIONS_SEED']
  try {
    JSON.parse(seed) // validate before writing
    fs.mkdirSync(path.dirname(dataPath), { recursive: true })
    writeFileSafe(dataPath, seed, { backup: true })
  } catch (err) {
    console.warn('Installations: failed to apply E2E_INSTALLATIONS_SEED:', (err as Error).message)
  }
}

async function load(): Promise<InstallationRecord[]> {
  return (await loadOutcome()).records
}

async function loadOutcome(): Promise<{ records: InstallationRecord[]; unreadable: boolean }> {
  maybeSeedFromEnv()
  const read = await readFileSafeAsync(dataPath)
  if (read.kind === 'unreadable') return { records: [], unreadable: true }
  if (read.kind === 'data') {
    // Stale .bak content standing in for a locked primary is fine to READ,
    // but flags the outcome unreadable so mutations fail closed instead of
    // saving it over the newer primary.
    const unreadable = read.primaryUnreadable === true
    try {
      const parsed: unknown = JSON.parse(read.data)
      if (Array.isArray(parsed) && parsed.length > 0) {
        return { records: (parsed as InstallationRecord[]).map(migrateRecord), unreadable }
      }
      // Readable and parseable but not a populated array (e.g. `[]`): nothing
      // to lose, so a mutation may proceed.
    } catch (err) {
      // Readable but corrupt: the real records are unknown, so a mutation
      // must not replace them with a list built from nothing.
      console.warn('Installations: failed to parse installations JSON:', (err as Error).message)
      return { records: [], unreadable: true }
    }
    return { records: [], unreadable }
  }
  return { records: [], unreadable: false }
}

/** Load for a read-modify-write cycle. Throws when installations.json EXISTS
 *  but its records cannot be recovered right now - unreadable (e.g. an AV lock
 *  outlasting the retry budget), standing in as stale .bak content, or
 *  readable but corrupt: the follow-up save() would replace the intact records,
 *  so the mutation must fail closed instead. Read-only callers use `load()`,
 *  which degrades gracefully. */
async function loadForWrite(): Promise<InstallationRecord[]> {
  const { records, unreadable } = await loadOutcome()
  if (unreadable) {
    throw new Error(
      'installations.json exists but its records cannot be recovered right now; refusing to modify it'
    )
  }
  return records
}

async function save(installations: InstallationRecord[]): Promise<void> {
  await writeFileSafeAsync(dataPath, JSON.stringify(installations, null, 2), { backup: true })
}

export async function list(): Promise<InstallationRecord[]> {
  return load()
}

/** True when `name` is taken by an install other than `id`. The single source
 *  of the rename uniqueness rule, shared across both write paths. */
export async function hasNameConflict(id: string, name: string): Promise<boolean> {
  const all = await load()
  return all.some((i) => i.id !== id && i.name === name)
}

export function uniqueName(
  baseName: string,
  existing: InstallationRecord[],
  excludeId?: string
): string {
  const names = new Set(existing.filter((i) => i.id !== excludeId).map((i) => i.name))
  if (!names.has(baseName)) return baseName
  // On conflict, strip a trailing " (N)" so an already-suffixed name renumbers
  // cleanly ("ComfyUI (1)" → "ComfyUI (2)") instead of compounding into
  // "ComfyUI (1) (1)". A name with no conflict is returned untouched above, so
  // an intentional " (N)" name is preserved when it's actually free.
  const stem = baseName.replace(/ \(\d+\)$/, '')
  let suffix = 1
  while (names.has(`${stem} (${suffix})`)) suffix++
  return `${stem} (${suffix})`
}

export async function add(installation: Record<string, unknown>): Promise<InstallationRecord> {
  const entry = await enqueue(async () => {
    const installations = await loadForWrite()
    installation.name = uniqueName(installation.name as string, installations)
    const entry = {
      id: nextInstallId(),
      createdAt: new Date().toISOString(),
      ...installation
    } as InstallationRecord
    installations.unshift(entry)
    await save(installations)
    return entry
  })
  installationEvents.emit('changed')
  return entry
}

export async function remove(id: string): Promise<void> {
  await enqueue(async () => {
    const installations = (await loadForWrite()).filter((i) => i.id !== id)
    await save(installations)
  })
  installationEvents.emit('changed')
}

export async function update(
  id: string,
  data: Record<string, unknown>
): Promise<InstallationRecord | null> {
  const updated = await enqueue(async () => {
    const installations = await loadForWrite()
    const index = installations.findIndex((i) => i.id === id)
    if (index === -1) return null
    const existing = installations[index]!
    installations[index] = { ...existing, ...data } as InstallationRecord
    await save(installations)
    return installations[index]!
  })
  if (updated) {
    installationEvents.emit('updated', updated)
    installationEvents.emit('changed')
  }
  return updated
}

export async function get(id: string): Promise<InstallationRecord | null> {
  return (await load()).find((i) => i.id === id) ?? null
}

export async function reorder(orderedIds: string[]): Promise<void> {
  await enqueue(async () => {
    const installations = await loadForWrite()
    const byId: Record<string, InstallationRecord> = Object.fromEntries(
      installations.map((i) => [i.id, i])
    )
    const reordered: InstallationRecord[] = orderedIds
      .map((id) => byId[id])
      .filter((inst): inst is InstallationRecord => inst != null)
    // Append any installations not in the provided list (safety net)
    for (const inst of installations) {
      if (!orderedIds.includes(inst.id)) reordered.push(inst)
    }
    await save(reordered)
  })
  installationEvents.emit('changed')
}

export async function ensureExists(sourceId: string, data: Record<string, unknown>): Promise<void> {
  const added = await enqueue(async () => {
    const existing = await loadForWrite()
    if (existing.some((i) => i.sourceId === sourceId)) return false
    existing.push({
      id: nextInstallId(),
      createdAt: new Date().toISOString(),
      ...data
    } as InstallationRecord)
    await save(existing)
    return true
  })
  if (added) installationEvents.emit('changed')
}

/** Force the seeded Cloud entry back to its canonical name. The Cloud install
 *  is not user-renamable (issue #922); this self-heals any entry that a prior
 *  build let the user rename. No-op when the name already matches or no Cloud
 *  entry exists. */
export async function enforceCloudName(): Promise<void> {
  const updated = await enqueue(async () => {
    const all = await loadForWrite()
    const index = all.findIndex((i) => i.sourceId === CLOUD_SOURCE_ID)
    if (index === -1) return null
    const existing = all[index]!
    if (existing.name === CLOUD_INSTALL_NAME) return null
    all[index] = { ...existing, name: CLOUD_INSTALL_NAME } as InstallationRecord
    await save(all)
    return all[index]!
  })
  if (updated) {
    installationEvents.emit('updated', updated)
    installationEvents.emit('changed')
  }
}

/**
 * Stamp `lastLaunchedAt` and (when `resolveCategory` returns a value)
 * `lastLaunchedAtByCategory[category]` in one atomic write, firing the same
 * 'updated' event as `update()`. `resolveCategory` is passed in (rather than
 * imported) so this module stays free of the source-plugin layer; omit it to
 * touch only the global timestamp.
 */
export async function markLaunched(
  installationId: string,
  resolveCategory?: (inst: InstallationRecord) => string | undefined
): Promise<InstallationRecord | null> {
  const updated = await enqueue(async () => {
    const list = await loadForWrite()
    const index = list.findIndex((i) => i.id === installationId)
    if (index === -1) return null
    const existing = list[index]!
    const now = Date.now()
    const category = resolveCategory?.(existing)
    const existingByCategory =
      (existing.lastLaunchedAtByCategory as Record<string, number> | undefined) ?? {}
    const merged: InstallationRecord = {
      ...existing,
      lastLaunchedAt: now,
      ...(category ? { lastLaunchedAtByCategory: { ...existingByCategory, [category]: now } } : {})
    }
    list[index] = merged
    await save(list)
    return merged
  })
  if (updated) {
    installationEvents.emit('updated', updated)
    installationEvents.emit('changed')
  }
  return updated
}

/**
 * POC: consume the one-shot starter-template flag. Clears `pendingTemplateOpen`
 * so the template only auto-opens on the first launch, not on relaunches.
 * No-op (returns false) when the install is gone or the flag was already clear,
 * so the caller can fire-and-forget. Skips the `'updated'` event to avoid a
 * title-bar refresh churn on every first launch — nothing observes this field.
 */
export async function clearPendingTemplateOpen(installationId: string): Promise<boolean> {
  return enqueue(async () => {
    const list = await loadForWrite()
    const index = list.findIndex((i) => i.id === installationId)
    if (index === -1) return false
    const existing = list[index]!
    if (existing.pendingTemplateOpen == null) return false
    list[index] = { ...existing, pendingTemplateOpen: null } as InstallationRecord
    await save(list)
    return true
  })
}

/** Most-recently-launched install (by global `lastLaunchedAt`), or null
 *  when no install has ever been launched. Installs without a timestamp
 *  are ignored. */
export async function getRecent(): Promise<InstallationRecord | null> {
  const list = await load()
  let best: InstallationRecord | null = null
  let bestTs = -Infinity
  for (const inst of list) {
    const ts = typeof inst.lastLaunchedAt === 'number' ? inst.lastLaunchedAt : -Infinity
    if (ts > bestTs) {
      bestTs = ts
      best = inst
    }
  }
  return best && bestTs > -Infinity ? best : null
}

/**
 * Most-recently-launched install matching `category`, ranked by
 * `lastLaunchedAtByCategory[category] ?? lastLaunchedAt` (so pre-per-category
 * installs still participate). `resolveCategory` is passed in so this module
 * stays free of the source-plugin layer.
 */
export async function getRecentByCategory(
  category: string,
  resolveCategory: (inst: InstallationRecord) => string | undefined
): Promise<InstallationRecord | null> {
  const list = await load()
  let best: InstallationRecord | null = null
  let bestTs = -Infinity
  for (const inst of list) {
    if (resolveCategory(inst) !== category) continue
    const byCat = inst.lastLaunchedAtByCategory as Record<string, number> | undefined
    const perCategoryTs = byCat?.[category]
    const ts =
      typeof perCategoryTs === 'number'
        ? perCategoryTs
        : typeof inst.lastLaunchedAt === 'number'
          ? inst.lastLaunchedAt
          : -Infinity
    if (ts > bestTs) {
      bestTs = ts
      best = inst
    }
  }
  return best && bestTs > -Infinity ? best : null
}

/** Sentinels for the global auto-launch setting. Duplicated from
 *  `settings.ts` to keep this module free of a settings dependency (which
 *  would cycle: settings depends on paths, paths depends on this module's
 *  `dataDir`). Callers pass the raw setting value through.
 *
 *  - `'none'` / empty / undefined → return null (no auto-launch).
 *  - `'last'` → resolve via `getRecent()`; null when nothing has ever launched.
 *  - any other string → look up by id; null when the id is gone (caller
 *    treats that as "stale selection, fall back to dashboard silently"). */
export async function resolveAutoLaunchInstall(
  autoLaunchValue: string | undefined | null
): Promise<InstallationRecord | null> {
  if (autoLaunchValue == null || autoLaunchValue === '' || autoLaunchValue === 'none') {
    return null
  }
  if (autoLaunchValue === 'last') {
    return getRecent()
  }
  return get(autoLaunchValue)
}

export async function seedDefaults(defaults: Record<string, unknown>[]): Promise<void> {
  const seeded = await enqueue(async () => {
    const installations = await loadForWrite()
    if (installations.length > 0) return false
    for (const entry of defaults) {
      installations.push({
        id: nextInstallId(),
        createdAt: new Date().toISOString(),
        status: 'installed',
        ...entry
      } as InstallationRecord)
    }
    if (installations.length > 0) {
      await save(installations)
      return true
    }
    return false
  })
  if (seeded) installationEvents.emit('changed')
}
