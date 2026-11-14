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
import { _hasActiveLaunch, _onLaunch, _runningSessions } from '../lib/ipc/shared'
import type { SessionInfo } from '../lib/ipc/shared'
import { chooseLocalBuild, runningPortOf, usableLocalBuilds } from './localBuild'
import type { LocalBuild } from './localBuild'
import { launchOnce, launchQuietly, otherLaunchSettled, pageBuildId } from './localComfy'
import {
  COMFY_STATE_SCRIPT,
  isComfyPage,
  MARK_PAGE_STALE_SCRIPT,
  openWorkflowScript,
  readOpenRequest
} from './openRequest'
import type { ComfyPageState, OpenRefusal, OpenRequest } from './openRequest'

export const WINDOW_TIMEOUT_MS = 20_000
export const NO_WORKFLOW_GRACE_MS = 5_000
export const LOAD_TIMEOUT_MS = 60_000
const READY_TIMEOUT_MS = 180_000
const PAGE_ANSWER_TIMEOUT_MS = 5_000
const WINDOW_POLL_MS = 250
const READY_POLL_MS = 500
const WINDOWLESS_MODES: ReadonlySet<string> = new Set(['console', 'external'])

type Target = { id: string } | { error: string }

const sessionShownInWindow = new Map<string, number>()
const cloudLaunches = new Map<string, Promise<ActionResult>>()

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function settledWithin<T>(work: Promise<T>, ms: number, otherwise: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(otherwise), ms)
    const finish = (value: T): void => {
      clearTimeout(timer)
      resolve(value)
    }
    work.then(finish, () => finish(otherwise))
  })
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
  return (await usableLocalBuilds())
    .sort((a, b) => b.lastLaunchedAt - a.lastLaunchedAt)
    .map((build) => ({ id: build.id, name: build.name }))
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

async function startCloud(inst: InstallationRecord): Promise<ActionResult> {
  if (!_hasActiveLaunch(inst.id)) return launchQuietly(inst)
  await otherLaunchSettled(inst.id)
  return { ok: _runningSessions.has(inst.id) }
}

function startCloudOnce(inst: InstallationRecord): Promise<ActionResult> {
  const pending = cloudLaunches.get(inst.id)
  if (pending) return pending
  const launch = startCloud(inst)
    .catch((err: unknown): ActionResult => ({ ok: false, message: (err as Error)?.message }))
    .finally(() => cloudLaunches.delete(inst.id))
  cloudLaunches.set(inst.id, launch)
  return launch
}

async function cloudTarget(): Promise<Target> {
  const inst = (await installations.list()).find(isUsableCloud)
  if (!inst) return { error: i18n.t('apps.local.openNoCloud') }
  if (_runningSessions.has(inst.id)) return { id: inst.id }
  const launched = await startCloudOnce(inst)
  if (_runningSessions.has(inst.id)) return { id: inst.id }
  return { error: launched.message || i18n.t('apps.local.openCloudFailed') }
}

function liveEntry(installationId: string): ComfyWindowEntry | null {
  const entry = getEntryByInstallationId(installationId)
  return entry && !entry.window.isDestroyed() ? entry : null
}

function showsSession(installationId: string, session: SessionInfo): boolean {
  if (!WINDOWLESS_MODES.has(session.mode)) return true
  return (
    sessionShownInWindow.has(installationId) &&
    sessionShownInWindow.get(installationId) === session.startedAt
  )
}

async function markPageStale(entry: ComfyWindowEntry): Promise<void> {
  const contents = entry.comfyView.webContents
  if (contents.isDestroyed()) return
  await settledWithin(
    contents.executeJavaScript(MARK_PAGE_STALE_SCRIPT),
    PAGE_ANSWER_TIMEOUT_MS,
    null
  )
}

async function showWindow(installationId: string): Promise<boolean> {
  const session = _runningSessions.get(installationId)
  if (!session) return false
  const open = liveEntry(installationId)
  if (open && showsSession(installationId, session)) return true
  const installation = await installations.get(installationId)
  if (!installation || !_onLaunch) return false
  if (open) await markPageStale(open)
  _onLaunch({
    port: session.port,
    url: session.url,
    process: session.proc,
    installation,
    mode: 'window'
  })
  sessionShownInWindow.set(installationId, session.startedAt)
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

async function pageState(entry: ComfyWindowEntry): Promise<ComfyPageState> {
  const contents = entry.comfyView.webContents
  if (contents.isLoading() || !isComfyPage(contents.getURL(), entry.comfyUrl)) return 'starting'
  const state: unknown = await settledWithin<unknown>(
    contents.executeJavaScript(COMFY_STATE_SCRIPT),
    PAGE_ANSWER_TIMEOUT_MS,
    'starting'
  )
  return state === 'ready' || state === 'no-workflow' ? state : 'starting'
}

async function loadWorkflow(entry: ComfyWindowEntry, request: OpenRequest): Promise<boolean> {
  const opened: unknown = await settledWithin<unknown>(
    entry.comfyView.webContents.executeJavaScript(openWorkflowScript(request), true),
    LOAD_TIMEOUT_MS,
    false
  )
  return opened === true
}

async function loadInto(installationId: string, request: OpenRequest): Promise<boolean> {
  const giveUpAt = Date.now() + READY_TIMEOUT_MS
  let withoutWorkflowSince: number | null = null
  while (Date.now() < giveUpAt) {
    const entry = liveEntry(installationId)
    if (!entry || entry.comfyView.webContents.isDestroyed()) return false
    const state = await pageState(entry)
    withoutWorkflowSince = state === 'no-workflow' ? (withoutWorkflowSince ?? Date.now()) : null
    const waitedForWorkflow =
      withoutWorkflowSince !== null && Date.now() - withoutWorkflowSince >= NO_WORKFLOW_GRACE_MS
    if (state === 'ready' || waitedForWorkflow) return loadWorkflow(entry, request)
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

export function _resetForTest(): void {
  sessionShownInWindow.clear()
  cloudLaunches.clear()
}
