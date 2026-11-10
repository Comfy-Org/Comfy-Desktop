import type { IpcMainInvokeEvent, WebContents } from 'electron'
import { promises as fsp } from 'fs'
import os from 'os'
import path from 'path'

import { getEntryByInstallationId } from '../host/registry'
import * as installations from '../installations'
import type { InstallationRecord } from '../installations'
import { detectGPUCached } from '../lib/gpu'
import { addInstallation, installInstance } from '../lib/ipc/registerInstallationHandlers'
import { dispatchSessionAction } from '../lib/ipc/sessionActions'
import {
  _onLaunch,
  _operationAborts,
  _pendingPorts,
  _runningSessions,
  MARKER_FILE,
  sourceMap
} from '../lib/ipc/shared'
import { installModelsDir } from '../lib/models'
import { dataDir, defaultDataRoot, defaultInstallDir } from '../lib/paths'
import { findAvailablePort } from '../lib/process'
import * as settings from '../settings'
import { buildPinnedVariant } from '../sources/standalone'
import { DEFAULT_LAUNCH_ARGS, variantMatchesHost } from '../sources/standalone/envPaths'
import { fetchR2Latest, fetchR2VendorReleases } from '../sources/standalone/r2Catalog'
import type { FieldOption } from '../types/sources'
import {
  APPS_BUILD_FIRST_PORT,
  APPS_BUILD_LAST_PORT,
  APPS_BUILD_NAME,
  APPS_BUILD_RELEASE,
  appsLaunchArgs,
  appsModelDirs,
  appsOutputDir,
  downloadBytes,
  findAppsBuild,
  localOff,
  pickVariant,
  type SetupEvent,
  setupEnd,
  setupEvent
} from './appsBuildRules'

export function categoryOf(inst: InstallationRecord): string | undefined {
  return sourceMap[inst.sourceId]?.category
}

export function launchInstall(
  install: InstallationRecord,
  actionData?: Record<string, unknown>
): Promise<{ ok: boolean; message?: string }> {
  const sender = { isDestroyed: () => false, send: () => {} } as unknown as WebContents
  const event = { sender } as unknown as IpcMainInvokeEvent
  const ctx = { event, installationId: install.id, inst: install, actionData }
  return dispatchSessionAction(ctx, 'launch').catch((err: unknown) => ({
    ok: false,
    message: (err as Error)?.message
  }))
}

let supported: Promise<string | null> | null = null

export function appsLocalOff(): Promise<string | null> {
  const check = (supported ??= detectGPUCached().then((gpu) => localOff(process.platform, gpu?.id)))
  return check.then((off) => {
    if (off) supported = null
    return off
  })
}

interface Setup {
  id: string | null
  cancelled: boolean
  promise: Promise<InstallationRecord>
}

let setup: Setup | null = null

export function appsSetupRunning(): boolean {
  return setup !== null
}

let appsId: string | null = null

export function appsBuildId(): string | null {
  return appsId
}

export async function findApps(): Promise<InstallationRecord | null> {
  const inst = findAppsBuild(await installations.list())
  if (inst) appsId = inst.id
  else if (!setup) appsId = null
  return inst
}

interface Plan {
  data: Record<string, unknown>
  bytes: number
}

let plan: Promise<Plan> | null = null

export function planAppsBuild(): Promise<Plan> {
  plan ??= makePlan().catch((err: unknown) => {
    plan = null
    throw err
  })
  return plan
}

async function makePlan(): Promise<Plan> {
  const source = sourceMap['standalone']
  if (!source?.getFieldOptions) throw new Error('Comfy Desktop cannot set up ComfyUI here.')
  const gpu = (await detectGPUCached())?.id
  const latest = await fetchR2Latest()
  const ids = Object.keys(latest).filter((id) => variantMatchesHost(id))
  const vendorReleases = Object.fromEntries(
    await Promise.all(ids.map(async (id) => [id, await fetchR2VendorReleases(id)] as const))
  )
  const release: FieldOption = {
    value: APPS_BUILD_RELEASE,
    label: APPS_BUILD_RELEASE,
    data: { tag: APPS_BUILD_RELEASE, vendorReleases }
  }
  const picked = pickVariant(await source.getFieldOptions('variant', { release }, { gpu }))
  const variantId = picked?.data?.['variantId']
  const pinned =
    typeof variantId === 'string'
      ? buildPinnedVariant(release, variantId, APPS_BUILD_RELEASE, gpu)
      : null
  if (!pinned) {
    throw new Error(`Comfy Desktop has no ComfyUI ${APPS_BUILD_RELEASE} for this computer.`)
  }
  const data = {
    sourceId: source.id,
    sourceLabel: source.label,
    ...source.buildInstallation({ release, variant: pinned })
  }
  return { data, bytes: downloadBytes((data as Record<string, unknown>)['downloadFiles']) }
}

async function storageFor(inst: InstallationRecord): Promise<Record<string, unknown>> {
  const sharedOutput = settings.get('outputDir') || settings.defaults.outputDir
  return {
    useSharedModels: true,
    useSharedInput: true,
    useSharedOutput: false,
    outputDir: appsOutputDir({
      dataRoot: defaultDataRoot(),
      appData: dataDir(),
      sharedOutput,
      installPath: inst.installPath
    }),
    modelDirs: appsModelDirs(await installations.list(), categoryOf, installModelsDir),
    launchArgs: appsLaunchArgs(
      inst.launchArgs,
      DEFAULT_LAUNCH_ARGS,
      process.platform,
      os.totalmem()
    )
  }
}

class SetupCancelled extends Error {
  constructor() {
    super('You cancelled setting up ComfyUI for apps.')
  }
}

function progressSender(totalBytes: number, onEvent: (e: SetupEvent) => void): WebContents {
  let lastAt = 0
  let lastStep = ''
  const send = (channel: string, payload: unknown) => {
    if (channel !== 'install-progress' || !payload || typeof payload !== 'object') return
    const { phase, ...detail } = payload as Record<string, unknown>
    const event = setupEvent(String(phase), detail, totalBytes)
    if (!event) return
    const now = Date.now()
    if (event.step === lastStep && now - lastAt < 250) return
    lastAt = now
    lastStep = event.step
    onEvent(event)
  }
  return { isDestroyed: () => false, send } as unknown as WebContents
}

async function dropStale(inst: InstallationRecord): Promise<void> {
  if (_operationAborts.has(inst.id) || (inst.status !== 'failed' && inst.status !== 'installing')) {
    throw new Error('The Apps build is busy in Comfy Desktop. Try again in a minute.')
  }
  const marker = await fsp
    .readFile(path.join(inst.installPath, MARKER_FILE), 'utf8')
    .catch(() => null)
  if (marker?.trim() === inst.id) {
    await fsp.rm(inst.installPath, { recursive: true, force: true }).catch(() => {})
  }
  await installations.remove(inst.id)
}

async function runSetup(
  s: Setup,
  found: InstallationRecord | null,
  onEvent: (e: SetupEvent) => void
): Promise<InstallationRecord> {
  try {
    if (found) await dropStale(found)
    const { data, bytes } = await planAppsBuild()
    if (s.cancelled) throw new SetupCancelled()
    onEvent(setupEvent('download', { percent: 0 }, bytes)!)
    const added = await addInstallation({
      ...data,
      name: APPS_BUILD_NAME,
      installPath: defaultInstallDir(),
      appsBuild: true,
      status: 'installing'
    })
    if (!('entry' in added)) throw new Error(added.message)
    const id = added.entry.id
    s.id = id
    appsId = id
    await installations.update(id, await storageFor(added.entry))
    if (s.cancelled) {
      await installations.remove(id)
      throw new SetupCancelled()
    }
    const result = (await installInstance(progressSender(bytes, onEvent), id)) as {
      message?: string
    }
    const inst = await installations.get(id)
    if (inst?.status === 'installed') {
      onEvent(setupEnd('done'))
      return inst
    }
    if (!inst || s.cancelled) throw new SetupCancelled()
    throw new Error(result.message || 'ComfyUI for apps did not install.')
  } catch (err) {
    const cancelled = err instanceof SetupCancelled
    onEvent(setupEnd(cancelled ? 'cancelled' : 'failed', (err as Error)?.message))
    throw err
  }
}

export async function ensureAppsBuild(
  onEvent: (e: SetupEvent) => void
): Promise<InstallationRecord> {
  const found = await findApps()
  if (found?.status === 'installed') return found
  if (!setup) {
    const s = { id: null, cancelled: false } as unknown as Setup
    s.promise = runSetup(s, found, onEvent).finally(() => {
      if (setup === s) setup = null
    })
    setup = s
  }
  return setup.promise
}

export function cancelAppsSetup(): { cancelled: boolean } {
  if (!setup) return { cancelled: false }
  setup.cancelled = true
  if (setup.id) _operationAborts.get(setup.id)?.abort()
  return { cancelled: true }
}

export async function launchAppsBuild(
  inst: InstallationRecord,
  withWindow = false
): Promise<{ ok: boolean; message?: string }> {
  const fresh = (await installations.update(inst.id, await storageFor(inst))) ?? inst
  const taken = new Set<number>([
    ..._pendingPorts.keys(),
    ...[..._runningSessions.values()].map((s) => s.port)
  ])
  const port = await findAvailablePort(
    '127.0.0.1',
    APPS_BUILD_FIRST_PORT,
    APPS_BUILD_LAST_PORT,
    taken
  ).catch(() => null)
  if (!port) return { ok: false, message: 'No free port for ComfyUI for apps.' }
  return launchInstall(fresh, {
    portOverride: port,
    ...(withWindow ? {} : { launchModeOverride: 'console' })
  })
}

export function showAppsBuildWindow(inst: InstallationRecord): boolean {
  const session = _runningSessions.get(inst.id)
  if (!session || !_onLaunch) return false
  const entry = getEntryByInstallationId(inst.id)
  if (entry && !entry.window.isDestroyed()) return true
  _onLaunch({ port: session.port, process: session.proc, installation: inst, mode: 'window' })
  return true
}
