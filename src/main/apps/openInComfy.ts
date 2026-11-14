import type { WebContents } from 'electron'

import type {
  ComfyDesktopLocalBuild,
  ComfyDesktopOpenInComfy
} from '../../types/comfyDesktopBridge'
import { setActivePanel } from '../host/panelView'
import { getEntryByInstallationId } from '../host/registry'
import type { ComfyWindowEntry } from '../host/registry'
import * as installations from '../installations'
import type { InstallationRecord } from '../installations'
import * as i18n from '../lib/i18n'
import type { ActionResult } from '../lib/ipc/sessionActions/types'
import { _onLaunch, _runningSessions } from '../lib/ipc/shared'
import { chooseLocalBuild, runningPortOf, usableLocalBuilds } from './localBuild'
import type { LocalBuild } from './localBuild'
import { launchOnce, launchQuietly, pageBuildId } from './localComfy'
import { COMFY_READY_SCRIPT, isComfyPage, openWorkflowScript, readOpenRequest } from './openRequest'
import type { OpenRefusal, OpenRequest } from './openRequest'

export const WINDOW_TIMEOUT_MS = 20_000
const READY_TIMEOUT_MS = 180_000
const WINDOW_POLL_MS = 250
const READY_POLL_MS = 500

type Target = { id: string } | { error: string }

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function refusalText(refusal: OpenRefusal): string {
  switch (refusal) {
    case 'unknown-place':
      return i18n.t('apps.local.openUnknownPlace')
    case 'unknown-build':
      return i18n.t('apps.local.openUnknownBuild')
    case 'carries-keys':
      return i18n.t('apps.local.openCarriesKeys')
    case 'not-a-workflow':
      return i18n.t('apps.local.openNotWorkflow')
  }
}

export async function localBuilds(): Promise<ComfyDesktopLocalBuild[]> {
  return (await usableLocalBuilds()).map((build) => ({ id: build.id, name: build.name }))
}

function pickLocal(builds: LocalBuild[], wanted: string | null): LocalBuild | null {
  const named = wanted === null ? undefined : builds.find((build) => build.id === wanted)
  if (named) return named
  const choice = chooseLocalBuild(builds, null)
  return choice.kind === 'build' ? choice.build : null
}

async function localTarget(page: WebContents, build?: string): Promise<Target> {
  const builds = await usableLocalBuilds()
  if (build !== undefined && !builds.some((one) => one.id === build)) {
    return { error: i18n.t('apps.local.openUnknownBuild') }
  }
  const picked = pickLocal(builds, build ?? pageBuildId(page))
  if (!picked) return { error: i18n.t('apps.local.noBuilds') }
  if (runningPortOf(picked.id) !== null) return { id: picked.id }
  const launched = await launchOnce(picked.id)
  if (runningPortOf(picked.id) !== null) return { id: picked.id }
  return {
    error: launched.message || i18n.t('apps.local.couldNotStart', { name: picked.name })
  }
}

function isUsableCloud(inst: InstallationRecord): boolean {
  return (
    inst.sourceId === installations.CLOUD_SOURCE_ID &&
    (inst.status === undefined || inst.status === 'installed')
  )
}

async function cloudTarget(): Promise<Target> {
  const inst = (await installations.list()).find(isUsableCloud)
  if (!inst) return { error: i18n.t('apps.local.openNoCloud') }
  if (_runningSessions.has(inst.id)) return { id: inst.id }
  const launched = await launchQuietly(inst).catch(
    (err: unknown): ActionResult => ({
      ok: false,
      message: (err as Error)?.message
    })
  )
  if (_runningSessions.has(inst.id)) return { id: inst.id }
  return { error: launched.message || i18n.t('apps.local.openCloudFailed') }
}

function liveEntry(installationId: string): ComfyWindowEntry | null {
  const entry = getEntryByInstallationId(installationId)
  return entry && !entry.window.isDestroyed() ? entry : null
}

async function showWindow(installationId: string): Promise<boolean> {
  if (liveEntry(installationId)) return true
  const session = _runningSessions.get(installationId)
  const installation = await installations.get(installationId)
  if (!session || !installation || !_onLaunch) return false
  _onLaunch({
    port: session.port,
    url: session.url,
    process: session.proc,
    installation,
    mode: 'window'
  })
  return true
}

async function windowFor(installationId: string): Promise<ComfyWindowEntry | null> {
  if (!(await showWindow(installationId))) return null
  const giveUpAt = Date.now() + WINDOW_TIMEOUT_MS
  for (;;) {
    const entry = liveEntry(installationId)
    if (entry || Date.now() >= giveUpAt) return entry
    await pause(WINDOW_POLL_MS)
  }
}

function bringForward(entry: ComfyWindowEntry): void {
  if (entry.window.isMinimized()) entry.window.restore()
  entry.window.show()
  entry.window.focus()
  if (entry.activePanel !== 'progress') setActivePanel(entry.windowKey, 'comfy')
}

async function loadInto(installationId: string, request: OpenRequest): Promise<boolean> {
  const giveUpAt = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < giveUpAt) {
    const entry = liveEntry(installationId)
    if (!entry) return false
    const contents = entry.comfyView.webContents
    if (contents.isDestroyed()) return false
    if (!contents.isLoading() && isComfyPage(contents.getURL(), entry.comfyUrl)) {
      const ready: unknown = await contents.executeJavaScript(COMFY_READY_SCRIPT).catch(() => false)
      if (ready === true) {
        const opened: unknown = await contents
          .executeJavaScript(openWorkflowScript(request), true)
          .catch(() => false)
        return opened === true
      }
    }
    await pause(READY_POLL_MS)
  }
  return false
}

async function openIn(page: WebContents, request: OpenRequest): Promise<ComfyDesktopOpenInComfy> {
  const target =
    request.where === 'local' ? await localTarget(page, request.build) : await cloudTarget()
  if ('error' in target) return { opened: false, error: target.error }
  const entry = await windowFor(target.id)
  if (!entry) return { opened: false, error: i18n.t('apps.local.openNoWindow') }
  bringForward(entry)
  if (await loadInto(target.id, request)) return { opened: true }
  return { opened: false, error: i18n.t('apps.local.openNotTaken') }
}

export async function openInComfy(
  page: WebContents,
  raw: unknown
): Promise<ComfyDesktopOpenInComfy> {
  const request = readOpenRequest(raw)
  if (typeof request === 'string') return { opened: false, error: refusalText(request) }
  try {
    return await openIn(page, request)
  } catch {
    return { opened: false, error: i18n.t('apps.local.openNotTaken') }
  }
}
