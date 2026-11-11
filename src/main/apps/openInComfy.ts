import { setActivePanel } from '../host/panelView'
import { getEntryByInstallationId } from '../host/registry'
import type { ComfyWindowEntry } from '../host/registry'
import * as installations from '../installations'
import { _runningSessions } from '../lib/ipc/shared'
import { categoryOf, findApps, launchAppsBuild, launchInstall, showComfyWindow } from './appsBuild'
import { pickOpenTarget } from './appsBuildRules'
import {
  COMFY_READY_SCRIPT,
  isComfyPage,
  localInstalls,
  type OpenRequest,
  openRequest,
  openWorkflowScript
} from './guards'
import { ownInUse } from './localComfy'

export type OpenResult = { opened: true } | { opened: false; error: string }

const WINDOW_TIMEOUT_MS = 20_000
const READY_TIMEOUT_MS = 180_000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export type LocalBuild = { id: string; name: string }

async function ownBuilds(): Promise<installations.InstallationRecord[]> {
  return localInstalls(await installations.list(), categoryOf)
}

export async function localBuilds(): Promise<LocalBuild[]> {
  return (await ownBuilds()).map((inst) => ({ id: inst.id, name: inst.name }))
}

function startedAt(): Map<string, number> {
  const at = new Map<string, number>()
  for (const [id, s] of _runningSessions) {
    if (!s.url && (s.sourceInstallationId ?? id) === id) at.set(id, s.startedAt)
  }
  return at
}

async function running(inst: installations.InstallationRecord): Promise<string | null> {
  if (_runningSessions.has(inst.id)) return showComfyWindow(inst) ? inst.id : null
  const result = await launchInstall(inst)
  return result.ok || _runningSessions.has(inst.id) ? inst.id : null
}

async function appsBuildWindow(): Promise<string | null> {
  const apps = await findApps()
  if (apps?.status !== 'installed') return null
  if (_runningSessions.has(apps.id)) return showComfyWindow(apps) ? apps.id : null
  const result = await launchAppsBuild(apps, true)
  return result.ok || _runningSessions.has(apps.id) ? apps.id : null
}

async function localInstallId(build?: string): Promise<string | null> {
  const own = await ownBuilds()
  const used = build === undefined ? ownInUse() : null
  const inUse = used ? own.find((inst) => inst.id === used) : undefined
  if (inUse) return running(inUse)
  const target = pickOpenTarget(own, startedAt(), build)
  if (target) return running(target)
  return build === undefined ? appsBuildWindow() : null
}

async function cloudInstallId(): Promise<string | null> {
  const usable = (i: installations.InstallationRecord) =>
    i.sourceId === installations.CLOUD_SOURCE_ID &&
    (i.status === undefined || i.status === 'installed')
  const inst = (await installations.list()).find(usable)
  if (!inst) return null
  if (_runningSessions.has(inst.id)) return inst.id
  const result = await launchInstall(inst)
  return result.ok || _runningSessions.has(inst.id) ? inst.id : null
}

function liveEntry(installationId: string): ComfyWindowEntry | null {
  const entry = getEntryByInstallationId(installationId)
  return entry && !entry.window.isDestroyed() ? entry : null
}

async function windowFor(installationId: string): Promise<ComfyWindowEntry | null> {
  const deadline = Date.now() + WINDOW_TIMEOUT_MS
  for (;;) {
    const entry = liveEntry(installationId)
    if (entry || Date.now() > deadline) return entry
    await sleep(250)
  }
}

function bringForward(entry: ComfyWindowEntry): void {
  if (entry.window.isMinimized()) entry.window.restore()
  entry.window.show()
  entry.window.focus()
  if (entry.activePanel !== 'progress') setActivePanel(entry.windowKey, 'comfy')
}

async function loadInto(installationId: string, req: OpenRequest): Promise<boolean> {
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    const entry = liveEntry(installationId)
    if (!entry) return false
    const wc = entry.comfyView.webContents
    if (wc.isDestroyed()) return false
    if (!wc.isLoading() && isComfyPage(wc.getURL(), entry.comfyUrl)) {
      const ready = await wc.executeJavaScript(COMFY_READY_SCRIPT).catch(() => false)
      if (ready === true) {
        const opened = await wc.executeJavaScript(openWorkflowScript(req), true).catch(() => false)
        return opened === true
      }
    }
    await sleep(500)
  }
  return false
}

export async function openInComfy(input: unknown): Promise<OpenResult> {
  const req = openRequest(input)
  if ('error' in req) throw new Error(req.error)
  const id = req.where === 'local' ? await localInstallId(req.build) : await cloudInstallId()
  if (!id) {
    return {
      opened: false,
      error:
        req.where === 'local'
          ? 'Comfy Desktop could not start your ComfyUI.'
          : 'Add Comfy Cloud in Comfy Desktop first.'
    }
  }
  const entry = await windowFor(id)
  if (!entry) return { opened: false, error: 'Comfy Desktop has no window for that ComfyUI.' }
  bringForward(entry)
  if (await loadInto(id, req)) return { opened: true }
  return { opened: false, error: 'ComfyUI did not take the workflow.' }
}
