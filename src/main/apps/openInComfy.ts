import { setActivePanel } from '../host/panelView'
import { getEntryByInstallationId } from '../host/registry'
import type { ComfyWindowEntry } from '../host/registry'
import * as installations from '../installations'
import { _runningSessions } from '../lib/ipc/shared'
import {
  COMFY_READY_SCRIPT,
  isComfyPage,
  type OpenRequest,
  openRequest,
  openWorkflowScript
} from './guards'
import { launchInstall, runningLocalId, startLocal } from './localComfy'

export type OpenResult = { opened: true } | { opened: false; error: string }

const WINDOW_TIMEOUT_MS = 20_000
const READY_TIMEOUT_MS = 180_000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function localInstallId(): Promise<string | null> {
  const running = runningLocalId()
  if (running) return running
  const s = await startLocal()
  return s.state === 'running' ? runningLocalId() : null
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
  const id = req.where === 'local' ? await localInstallId() : await cloudInstallId()
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
