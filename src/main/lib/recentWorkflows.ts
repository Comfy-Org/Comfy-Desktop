import { constants as fsConstants, promises as fsp } from 'fs'
import path from 'path'
import { ipcMain } from 'electron'

import { openSavedWorkflow } from '../apps/openInComfy'
import type { WorkflowPlace } from '../apps/openInComfy'
import { usableLocalBuilds } from '../apps/localBuild'
import { CLOUD_CONFIG } from '../cloud/config'
import { getCloudSession } from '../devplatform/session'
import { isPanelSender } from '../host/registry'
import * as installations from '../installations'
import type { InstallationRecord } from '../installations'
import type { ComfyDesktopOpenInComfy } from '../../types/comfyDesktopBridge'
import type { RecentWorkflow } from '../../types/ipc'
import { isGraphWorkflow } from './embeddedWorkflow'
import * as i18n from './i18n'
import { findComfyUIDir } from './migrate'
import { parseArgs } from './util'

export const RECENT_WORKFLOW_CHANNELS = {
  list: 'workflows:list-recent',
  open: 'workflows:open-recent'
} as const

export const RECENT_WORKFLOW_LIMIT = 10
const WORKFLOW_DIR = 'workflows'
const WORKFLOW_EXT = '.json'
const MAX_FILES_PER_BUILD = 2_000
const MAX_DEPTH = 6
const MAX_WORKFLOW_BYTES = 8_000_000
const CLOUD_TIMEOUT_MS = 10_000
const SECONDS_EPOCH_LIMIT = 1e12

interface SavedFile {
  path: string
  modifiedAt: number
}

function argValue(args: readonly string[], flag: string): string | null {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === flag) return args[i + 1] ?? null
    if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1)
  }
  return null
}

export function userDirOf(inst: InstallationRecord): string {
  const launchArgs = typeof inst.launchArgs === 'string' ? parseArgs(inst.launchArgs) : []
  const chosen = argValue(launchArgs, '--user-directory')
  if (chosen) return path.resolve(inst.installPath, chosen)
  const adoptedBaseDir = inst.adoptedBaseDir
  if (typeof adoptedBaseDir === 'string' && adoptedBaseDir !== '') {
    return path.join(adoptedBaseDir, 'user')
  }
  const comfyDir = findComfyUIDir(inst.installPath) ?? path.join(inst.installPath, 'ComfyUI')
  return path.join(comfyDir, 'user')
}

export function workflowsDirOf(inst: InstallationRecord): string {
  return path.join(userDirOf(inst), 'default', WORKFLOW_DIR)
}

export function isSavedWorkflowPath(value: unknown): value is string {
  if (typeof value !== 'string' || value === '' || value.length > 512) return false
  if (!value.toLowerCase().endsWith(WORKFLOW_EXT)) return false
  if ([...value].some((char) => char === '\\' || char.charCodeAt(0) < 0x20)) return false
  const parts = value.split('/')
  return parts.every((part) => part !== '' && part !== '.' && part !== '..')
}

async function listSavedFiles(root: string): Promise<SavedFile[]> {
  const found: SavedFile[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH || found.length >= MAX_FILES_PER_BUILD) return
    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (found.length >= MAX_FILES_PER_BUILD) return
      if (entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full, depth + 1)
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(WORKFLOW_EXT)) {
        const stat = await fsp.stat(full).catch(() => null)
        if (stat) {
          found.push({
            path: path.relative(root, full).split(path.sep).join('/'),
            modifiedAt: stat.mtimeMs
          })
        }
      }
    }
  }
  await walk(root, 0)
  return found
}

function titleOf(savedPath: string): string {
  const base = savedPath.split('/').pop() ?? savedPath
  return base.slice(0, base.length - WORKFLOW_EXT.length) || base
}

function toRecent(
  file: SavedFile,
  build: { id: string; name: string },
  where: RecentWorkflow['where']
): RecentWorkflow {
  return {
    id: `${build.id}:${file.path}`,
    title: titleOf(file.path),
    path: file.path,
    installationId: build.id,
    buildName: build.name,
    where,
    modifiedAt: file.modifiedAt
  }
}

type BuildScope = ReadonlySet<string> | null

function inScope(buildIds: BuildScope, installationId: string): boolean {
  return buildIds === null || buildIds.has(installationId)
}

async function localRecents(buildIds: BuildScope): Promise<RecentWorkflow[]> {
  const builds = (await usableLocalBuilds()).filter((build) => inScope(buildIds, build.id))
  const lists = await Promise.all(
    builds.map(async (build) => {
      const inst = await installations.get(build.id)
      if (!inst) return []
      const files = await listSavedFiles(workflowsDirOf(inst))
      return files.map((file) => toRecent(file, build, 'local'))
    })
  )
  return lists.flat()
}

export function epochMs(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return value < SECONDS_EPOCH_LIMIT ? value * 1000 : value
}

export function readCloudListing(body: unknown): SavedFile[] {
  if (!Array.isArray(body)) return []
  const files: SavedFile[] = []
  for (const row of body) {
    if (typeof row !== 'object' || row === null) continue
    const { path: savedPath, modified } = row as { path?: unknown; modified?: unknown }
    const modifiedAt = epochMs(modified)
    if (isSavedWorkflowPath(savedPath) && modifiedAt !== null) {
      files.push({ path: savedPath, modifiedAt })
    }
  }
  return files
}

function cloudListUrl(): string {
  const url = new URL(`${CLOUD_CONFIG.apiBase}/userdata`)
  url.searchParams.set('dir', WORKFLOW_DIR)
  url.searchParams.set('recurse', 'true')
  url.searchParams.set('split', 'false')
  url.searchParams.set('full_info', 'true')
  return url.toString()
}

function cloudFileUrl(savedPath: string): string {
  return `${CLOUD_CONFIG.apiBase}/userdata/${encodeURIComponent(`${WORKFLOW_DIR}/${savedPath}`)}`
}

async function cloudBuild(): Promise<InstallationRecord | null> {
  return (
    (await installations.list()).find(
      (inst) =>
        inst.sourceId === installations.CLOUD_SOURCE_ID &&
        (inst.status === undefined || inst.status === 'installed')
    ) ?? null
  )
}

async function cloudToken(): Promise<string | null> {
  const session = getCloudSession()
  if (!session.status().signedIn) return null
  return session.getAccessToken().catch(() => null)
}

async function cloudRecents(buildIds: BuildScope): Promise<RecentWorkflow[]> {
  const found = await cloudBuild()
  const inst = found && inScope(buildIds, found.id) ? found : null
  const token = inst ? await cloudToken() : null
  if (!inst || !token) return []
  try {
    const res = await fetch(cloudListUrl(), {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(CLOUD_TIMEOUT_MS)
    })
    if (!res.ok) return []
    return readCloudListing(await res.json()).map((file) =>
      toRecent(file, { id: inst.id, name: inst.name }, 'cloud')
    )
  } catch {
    return []
  }
}

export function newestFirst(workflows: RecentWorkflow[], limit: number): RecentWorkflow[] {
  return [...workflows].sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, limit)
}

export function readBuildIds(value: unknown): ReadonlySet<string> | null {
  if (!Array.isArray(value)) return null
  return new Set(value.filter((id): id is string => typeof id === 'string'))
}

export async function listRecentWorkflows(buildIds: BuildScope = null): Promise<RecentWorkflow[]> {
  const [local, cloud] = await Promise.all([localRecents(buildIds), cloudRecents(buildIds)])
  return newestFirst([...local, ...cloud], RECENT_WORKFLOW_LIMIT)
}

const READ_WITHOUT_FOLLOWING =
  fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0)

async function readWithin(file: string): Promise<string | null> {
  const handle = await fsp.open(file, READ_WITHOUT_FOLLOWING).catch(() => null)
  if (!handle) return null
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > MAX_WORKFLOW_BYTES) return null
    return await handle.readFile('utf8')
  } catch {
    return null
  } finally {
    await handle.close().catch(() => undefined)
  }
}

function isInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

async function readLocalWorkflow(installationId: string, savedPath: string): Promise<unknown> {
  const inst = await installations.get(installationId)
  if (!inst) return null
  const root = workflowsDirOf(inst)
  const file = path.resolve(root, ...savedPath.split('/'))
  if (!isInside(file, root)) return null
  const realRoot = await fsp.realpath(root).catch(() => null)
  const realFile = await fsp.realpath(file).catch(() => null)
  if (!realRoot || !realFile || !isInside(realFile, realRoot)) return null
  const text = await readWithin(realFile)
  return text === null ? null : JSON.parse(text)
}

async function readCloudWorkflow(savedPath: string): Promise<unknown> {
  const token = await cloudToken()
  if (!token) return null
  const res = await fetch(cloudFileUrl(savedPath), {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    redirect: 'error',
    signal: AbortSignal.timeout(CLOUD_TIMEOUT_MS)
  })
  if (!res.ok) return null
  const text = await res.text()
  return text.length > MAX_WORKFLOW_BYTES ? null : JSON.parse(text)
}

export async function openRecentWorkflow(
  installationId: unknown,
  savedPath: unknown
): Promise<ComfyDesktopOpenInComfy> {
  if (typeof installationId !== 'string' || !isSavedWorkflowPath(savedPath)) {
    return { opened: false, error: i18n.t('apps.local.openNotTaken') }
  }
  const inst = await installations.get(installationId)
  if (!inst) return { opened: false, error: i18n.t('apps.local.openUnknownBuild') }
  const onCloud = inst.sourceId === installations.CLOUD_SOURCE_ID
  const place: WorkflowPlace = onCloud
    ? { where: 'cloud' }
    : { where: 'local', build: installationId }
  const graph = await (
    onCloud ? readCloudWorkflow(savedPath) : readLocalWorkflow(installationId, savedPath)
  ).catch(() => null)
  if (graph === null) return { opened: false, error: i18n.t('apps.local.openUnreadable') }
  if (!isGraphWorkflow(graph)) return { opened: false, error: i18n.t('apps.local.openNotWorkflow') }
  return openSavedWorkflow(place, graph, savedPath.slice(0, -WORKFLOW_EXT.length))
}

export function registerRecentWorkflowHandlers(): void {
  ipcMain.handle(RECENT_WORKFLOW_CHANNELS.list, (event, buildIds: unknown) =>
    isPanelSender(event.sender) ? listRecentWorkflows(readBuildIds(buildIds)) : []
  )
  ipcMain.handle(
    RECENT_WORKFLOW_CHANNELS.open,
    (event, installationId: unknown, savedPath: unknown) =>
      isPanelSender(event.sender)
        ? openRecentWorkflow(installationId, savedPath)
        : { opened: false, error: i18n.t('apps.local.openNotTaken') }
  )
}
