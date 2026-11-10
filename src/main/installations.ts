import path from 'path'
import fs from 'fs'
import { EventEmitter } from 'events'
import { app } from 'electron'
import { dataDir } from './lib/paths'
import { readFileSafeAsync, writeFileSafe, writeFileSafeAsync } from './lib/safe-file'
import type { ComfyVersion } from './lib/version'

export const installationEvents = new EventEmitter()

export const CLOUD_SOURCE_ID = 'cloud'
export const CLOUD_INSTALL_NAME = 'Comfy Cloud'

export interface InstallationRecord {
  id: string
  name: string
  createdAt: string
  installPath: string
  sourceId: string
  workspaceId?: string
  status?: string
  seen?: boolean
  comfyVersion?: ComfyVersion
  lastLaunchedAt?: number
  lastLaunchedAtByCategory?: Record<string, number>
  useSharedModels?: boolean
  useSharedInput?: boolean
  useSharedOutput?: boolean
  modelDirs?: string[]
  modelDirsPrimary?: string | null
  inputDir?: string
  outputDir?: string
  bundledTemplateId?: string
  bundledTemplateSizeBytes?: number
  pendingTemplateOpen?: string | null
  downloadTemplateModels?: boolean
  [key: string]: unknown
}

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
    rec = {
      ...rest,
      useSharedInput: typeof rest.useSharedInput === 'boolean' ? rest.useSharedInput : value,
      useSharedOutput: typeof rest.useSharedOutput === 'boolean' ? rest.useSharedOutput : value
    } as InstallationRecord
  }
  if (
    rec.status === 'installing' &&
    rec.sourceId === 'comfybuilder' &&
    rec.comfybuilderRollback !== null &&
    typeof rec.comfybuilderRollback === 'object' &&
    !Array.isArray(rec.comfybuilderRollback)
  ) {
    rec = { ...rec, status: 'updating' }
  }
  return rec
}

const dataPath = path.join(dataDir(), 'installations.json')

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

let _queue: Promise<void> = Promise.resolve()
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const p = _queue.then(fn)
  _queue = p.then(
    () => {},
    () => {}
  )
  return p
}

let e2eSeedApplied = false
function maybeSeedFromEnv(): void {
  if (e2eSeedApplied) return
  e2eSeedApplied = true
  if (app.isPackaged) return
  if (process.env['E2E'] !== '1') return
  const seed = process.env['E2E_INSTALLATIONS_SEED']
  if (!seed) return
  delete process.env['E2E_INSTALLATIONS_SEED']
  try {
    JSON.parse(seed)
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
    const unreadable = read.primaryUnreadable === true
    try {
      const parsed: unknown = JSON.parse(read.data)
      if (Array.isArray(parsed) && parsed.length > 0) {
        return { records: (parsed as InstallationRecord[]).map(migrateRecord), unreadable }
      }
    } catch (err) {
      console.warn('Installations: failed to parse installations JSON:', (err as Error).message)
      return { records: [], unreadable: true }
    }
    return { records: [], unreadable }
  }
  return { records: [], unreadable: false }
}

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

export async function reassignWorkspace(
  fromWorkspaceId: string,
  toWorkspaceId: string
): Promise<InstallationRecord[]> {
  if (!fromWorkspaceId || !toWorkspaceId || fromWorkspaceId === toWorkspaceId) return []

  const updated = await enqueue(async () => {
    const list = await loadForWrite()
    const changed: InstallationRecord[] = []
    for (let index = 0; index < list.length; index++) {
      const existing = list[index]!
      if (existing.workspaceId !== fromWorkspaceId) continue
      const next = { ...existing, workspaceId: toWorkspaceId }
      list[index] = next
      changed.push(next)
    }
    if (changed.length > 0) await save(list)
    return changed
  })

  for (const record of updated) installationEvents.emit('updated', record)
  if (updated.length > 0) installationEvents.emit('changed')
  return updated
}

export async function associateUnownedBuildInstalls(
  workspaceId: string,
  visibleBuildIds: ReadonlySet<string>
): Promise<InstallationRecord[]> {
  if (!workspaceId || visibleBuildIds.size === 0) return []

  const updated = await enqueue(async () => {
    const list = await loadForWrite()
    const matched: InstallationRecord[] = []

    for (let index = 0; index < list.length; index++) {
      const existing = list[index]!
      const distributionId = existing.distributionId
      if (
        existing.sourceId !== 'comfybuilder' ||
        existing.workspaceId !== undefined ||
        typeof distributionId !== 'string' ||
        distributionId.length === 0 ||
        !visibleBuildIds.has(distributionId)
      ) {
        continue
      }

      const next = { ...existing, workspaceId }
      list[index] = next
      matched.push(next)
    }

    if (matched.length > 0) await save(list)
    return matched
  })

  for (const record of updated) installationEvents.emit('updated', record)
  if (updated.length > 0) installationEvents.emit('changed')
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
