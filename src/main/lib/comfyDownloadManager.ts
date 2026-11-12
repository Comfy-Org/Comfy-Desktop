import { randomUUID } from 'crypto'
import { app, BrowserWindow, dialog, nativeImage, net, session as electronSession } from 'electron'
import { EventEmitter } from 'events'
import fs from 'fs'
import path from 'path'
import * as settings from '../settings'
import * as installations from '../installations'
import { findInstallationIdByComfySender } from '../host/registry'
import { expectedPartitionFor } from '../host/partition'
import { TEMP_DIR_NAME } from './models'
import { _broadcastToRenderer } from './ipc/shared'
import { ALLOWED_EXTENSIONS, stripQueryParams } from './downloadFilename'
import type { ComfyTemplateInputReference } from '../../types/comfyDesktopBridge'
import {
  buildExistenceCandidates,
  collectModelScanRoots,
  getModelsBaseDir,
  regularFileExists,
  resolveDownloadContextById
} from './modelDownloadPaths'
import {
  ensureStagedPlaceholder,
  migrateLegacyModelDownloadArtifacts,
  removeStagedArtifacts,
  revalidateStagedPair,
  scanForStagedDownloads,
  sha256File,
  type DiscoveredStagedDownload
} from './modelDownloadStaging'
import { startModelTransfer, type ModelTransferHandle } from './modelDownloadTransport'
import { isQuitInProgress } from './quit-state'

export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif']

export function buildSaveDialogFilters(suggestedName: string): Electron.FileFilter[] {
  const ext = path.extname(suggestedName).toLowerCase().replace(/^\./, '')
  const ALL_FILES: Electron.FileFilter = { name: 'All Files', extensions: ['*'] }
  if (!ext) return [ALL_FILES]

  const FAMILIES: Record<string, { name: string; extensions: string[] }> = {
    png: { name: 'PNG Image', extensions: ['png'] },
    jpg: { name: 'JPEG Image', extensions: ['jpg', 'jpeg'] },
    jpeg: { name: 'JPEG Image', extensions: ['jpg', 'jpeg'] },
    webp: { name: 'WebP Image', extensions: ['webp'] },
    gif: { name: 'GIF Image', extensions: ['gif'] },
    bmp: { name: 'Bitmap Image', extensions: ['bmp'] },
    mp4: { name: 'MP4 Video', extensions: ['mp4'] },
    webm: { name: 'WebM Video', extensions: ['webm'] },
    mov: { name: 'QuickTime Video', extensions: ['mov'] },
    wav: { name: 'WAV Audio', extensions: ['wav'] },
    mp3: { name: 'MP3 Audio', extensions: ['mp3'] },
    flac: { name: 'FLAC Audio', extensions: ['flac'] },
    ogg: { name: 'OGG Audio', extensions: ['ogg'] }
  }

  const primary = FAMILIES[ext]
  if (primary) return [primary, ALL_FILES]
  return [{ name: `${ext.toUpperCase()} File`, extensions: [ext] }, ALL_FILES]
}

export interface DownloadProgress {
  id?: string
  url: string
  filename: string
  directory?: string
  savePath?: string
  progress: number
  receivedBytes?: number
  totalBytes?: number
  speedBytesPerSec?: number
  etaSeconds?: number
  status: 'pending' | 'downloading' | 'paused' | 'completed' | 'error' | 'cancelled'
  error?: string
  createdAt?: number
  isImage?: boolean
  templateInputs?: ComfyTemplateInputReference[]
}

interface PendingDownload {
  id: string
  kind: 'model' | 'asset' | 'general'
  url: string
  filename: string
  directory: string
  savePath: string
  requestedSavePath?: string
  preserveRequestedFilename?: boolean
  templateInput?: ComfyTemplateInputReference
  tempPath?: string
  outputDir?: string
  window?: BrowserWindow
  senderContents?: Electron.WebContents
  subscriberWindows: Set<BrowserWindow>
  subscriberContents: Set<Electron.WebContents>
  installationSubscribers?: Map<Electron.WebContents, string>
  item?: Electron.DownloadItem
  transport?: ModelTransferHandle | null
  suspended?: boolean
  resumeOnWake?: boolean
  attemptGen?: number
  starting?: boolean
  cancelRequested?: boolean
  pauseHoldsClaim?: boolean
  cancelling?: boolean
  preflight?: Promise<void>
  leases?: Set<string>
  installationId?: string | null
  expectedSize?: number
  sha256?: string
  explicitSession?: Electron.Session
  progressSubscribers?: Set<(receivedBytes: number, totalBytes: number) => void>
  settleJob?: (outcome: ModelJobOutcome) => void
  completion?: Promise<ModelJobOutcome>
  lastProgress: DownloadProgress & { id: string }
  lastSpeedBytes: number
  lastSpeedTime: number
}

const attachedSessions = new WeakSet<Electron.Session>()

const pendingDownloads = new Map<string, PendingDownload>()

const activeIdsByUrl = new Map<string, Set<string>>()

function registerPending(pending: PendingDownload): void {
  pendingDownloads.set(pending.id, pending)
  let ids = activeIdsByUrl.get(pending.url)
  if (!ids) activeIdsByUrl.set(pending.url, (ids = new Set()))
  ids.add(pending.id)
}

function unregisterPending(pending: PendingDownload): void {
  pendingDownloads.delete(pending.id)
  const ids = activeIdsByUrl.get(pending.url)
  if (ids) {
    ids.delete(pending.id)
    if (ids.size === 0) activeIdsByUrl.delete(pending.url)
  }
}

function activeJobsForUrl(url: string): PendingDownload[] {
  const ids = activeIdsByUrl.get(url)
  if (!ids) return []
  const out: PendingDownload[] = []
  for (const id of ids) {
    const p = pendingDownloads.get(id)
    if (p) out.push(p)
  }
  return out
}

function findActiveByRef(ref: string): PendingDownload | undefined {
  const byId = pendingDownloads.get(ref)
  if (byId) return byId
  const byUrl = activeJobsForUrl(ref)
  return byUrl.length === 1 ? byUrl[0] : undefined
}

export type ModelJobErrorCode = 'checksum-mismatch' | 'existing-file-mismatch'

export type ModelJobOutcome =
  | { status: 'completed'; savePath: string; alreadyPresent?: boolean }
  | { status: 'cancelled' }
  | { status: 'error'; error: string; code?: ModelJobErrorCode }

const modelJobIdByDest = new Map<string, string>()

const lockedModelRoots = new Map<string, symbol>()
let modelDownloadsInitRunning = 0

const closingStreamsByDest = new Map<string, Promise<void>>()

function trackClosingStream(destKey: string, done: Promise<unknown>): void {
  const prior = closingStreamsByDest.get(destKey) ?? Promise.resolve()
  const entry: Promise<void> = Promise.allSettled([prior, done]).then(() => {
    if (closingStreamsByDest.get(destKey) === entry) closingStreamsByDest.delete(destKey)
  })
  closingStreamsByDest.set(destKey, entry)
}

function canonicalDestKey(savePath: string): string {
  const resolved = path.resolve(savePath)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function pathIsInModelRoot(filePath: string, root: string): boolean {
  return isPathContained(canonicalDestKey(filePath), canonicalDestKey(root))
}

function isModelPathLocked(filePath: string, exemptRootKey?: string): boolean {
  for (const root of lockedModelRoots.keys()) {
    if (root === exemptRootKey) continue
    if (pathIsInModelRoot(filePath, root)) return true
  }
  return false
}

export function acquireModelDownloadRootLock(modelsRoot: string): (() => void) | null {
  if (modelDownloadsInitRunning > 0) return null
  const rootKey = canonicalDestKey(modelsRoot)
  for (const existing of lockedModelRoots.keys()) {
    if (
      existing === rootKey ||
      pathIsInModelRoot(existing, rootKey) ||
      pathIsInModelRoot(rootKey, existing)
    ) {
      return null
    }
  }

  const token = Symbol('model-root-lock')
  lockedModelRoots.set(rootKey, token)
  const busy =
    [...pendingDownloads.values()].some(
      (pending) => pending.kind === 'model' && pathIsInModelRoot(pending.savePath, rootKey)
    ) || [...closingStreamsByDest.keys()].some((dest) => pathIsInModelRoot(dest, rootKey))
  if (busy) {
    lockedModelRoots.delete(rootKey)
    return null
  }

  return () => {
    if (lockedModelRoots.get(rootKey) === token) lockedModelRoots.delete(rootKey)
  }
}

export function releaseParkedModelJobsUnder(modelsRoot: string): void {
  const rootKey = canonicalDestKey(modelsRoot)
  for (const pending of [...pendingDownloads.values()]) {
    if (pending.kind !== 'model') continue
    if (!pathIsInModelRoot(pending.savePath, rootKey)) continue
    if (!pending.suspended || pending.transport || pending.starting || pending.cancelling) continue
    if (pending.leases && pending.leases.size > 0) continue
    if (closingStreamsByDest.has(canonicalDestKey(pending.savePath))) continue
    unregisterModelJob(pending)
    createdAtById.delete(pending.id)
    retryParamsById.delete(pending.id)
    _broadcastToRenderer('model-download-removed', { url: pending.url, id: pending.id })
    downloadEvents.emit('tray-state-changed')
    pending.settleJob?.({ status: 'cancelled' })
  }
}

function filesHaveEqualContent(a: string, b: string): boolean {
  const CHUNK = 4 * 1024 * 1024
  let fdA: number | undefined
  let fdB: number | undefined
  try {
    const statA = fs.statSync(a)
    const statB = fs.statSync(b)
    if (statA.size !== statB.size) return false
    fdA = fs.openSync(a, 'r')
    fdB = fs.openSync(b, 'r')
    const bufA = Buffer.alloc(CHUNK)
    const bufB = Buffer.alloc(CHUNK)
    let pos = 0
    while (pos < statA.size) {
      const nA = fs.readSync(fdA, bufA, 0, CHUNK, pos)
      const nB = fs.readSync(fdB, bufB, 0, CHUNK, pos)
      if (nA !== nB || nA <= 0) return false
      if (!bufA.subarray(0, nA).equals(bufB.subarray(0, nB))) return false
      pos += nA
    }
    return true
  } catch {
    return false
  } finally {
    if (fdA !== undefined)
      try {
        fs.closeSync(fdA)
      } catch {}
    if (fdB !== undefined)
      try {
        fs.closeSync(fdB)
      } catch {}
  }
}
let mainWindow: BrowserWindow | null = null

interface RetryParams {
  kind: 'model' | 'asset'
  url: string
  filename: string
  window?: BrowserWindow
  senderContents?: Electron.WebContents
  directory?: string
  outputDir?: string
  authToken?: string
  installationId?: string | null
  savePath?: string
  sha256?: string
  destinationBaseDir?: string
  existingFilePolicy?: 'deduplicate' | 'skip'
  templateInput?: ComfyTemplateInputReference
}
const retryParamsById = new Map<string, RetryParams>()

const RECENT_LIMIT = 10
const recentDownloads: DownloadProgress[] = []

export const downloadEvents = new EventEmitter()
downloadEvents.setMaxListeners(50)

export interface DownloadsTrayState {
  active: DownloadProgress[]
  recent: DownloadProgress[]
}

function isTerminalStatus(status: DownloadProgress['status']): boolean {
  return status === 'completed' || status === 'error' || status === 'cancelled'
}

function dropRowBookkeeping(row: DownloadProgress): void {
  if (row.id !== undefined) {
    createdAtById.delete(row.id)
    retryParamsById.delete(row.id)
  }
}

function findRecentByRef(ref: string): DownloadProgress | undefined {
  const byId = recentDownloads.find((d) => d.id === ref)
  if (byId) return byId
  const byUrl = recentDownloads.filter((d) => d.url === ref)
  return byUrl.length === 1 ? byUrl[0] : undefined
}

function pushRecent(progress: DownloadProgress): void {
  const idx = recentDownloads.findIndex(
    (d) =>
      d.id === progress.id ||
      (progress.url !== '' &&
        d.url === progress.url &&
        (d.directory ?? '') === (progress.directory ?? ''))
  )
  if (idx >= 0) {
    const [replaced] = recentDownloads.splice(idx, 1)
    if (replaced && replaced.id !== undefined && replaced.id !== progress.id) {
      dropRowBookkeeping(replaced)
      _broadcastToRenderer('model-download-removed', { url: replaced.url, id: replaced.id })
    }
  }
  recentDownloads.push({ ...progress })
  while (recentDownloads.length > RECENT_LIMIT) {
    const evicted = recentDownloads.shift()
    if (evicted) {
      dropRowBookkeeping(evicted)
      _broadcastToRenderer('model-download-removed', { url: evicted.url, id: evicted.id })
    }
  }
}

export function getDownloadsTrayState(): DownloadsTrayState {
  const active: DownloadProgress[] = []
  const recent: DownloadProgress[] = recentDownloads.slice()
  for (const pending of pendingDownloads.values()) {
    const s = pending.lastProgress.status
    if (s === 'pending' || s === 'downloading' || s === 'paused') {
      active.push(pending.lastProgress)
    }
  }
  return { active, recent }
}

export function setMainWindow(win: BrowserWindow | null): void {
  mainWindow = win
}

function resolveSenderInstallationId(senderContents?: Electron.WebContents): string | null {
  if (!senderContents || senderContents.isDestroyed()) return null
  return findInstallationIdByComfySender(senderContents)
}

function modelTempDirFor(baseDir: string): string {
  return path.join(baseDir, TEMP_DIR_NAME)
}

function getTempDir(): string {
  return modelTempDirFor(getModelsBaseDir())
}

function getAssetTempDir(): string {
  const outputDir = (settings.get('outputDir') as string | undefined) || settings.defaults.outputDir
  return path.join(path.dirname(outputDir), TEMP_DIR_NAME)
}

const WIN_MAX_PATH = 259
const DEDUP_RESERVE = 6

function tempFileNameFor(filename: string): string {
  return `${Date.now()}-${randomUUID().slice(0, 8)}-${filename}.tmp`
}

const WIN_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

function isUnsafePathSegment(segment: string): boolean {
  // eslint-disable-next-line no-control-regex
  if (/[<>:"|?*\u0000-\u001F]/.test(segment)) return true
  if (segment.endsWith('.') || segment.endsWith(' ')) return true
  return WIN_RESERVED_NAMES.test(segment)
}

export function sanitizeAssetFilename(filename: string, outputDir: string): string | null {
  if (!filename || filename.trim() === '') return null

  let safe = filename.replace(/\\/g, '/')

  if (safe.startsWith('/') || /^[a-z]:/i.test(safe) || safe.split('/').includes('..')) {
    return null
  }

  safe = safe
    .split('/')
    .filter((seg) => seg !== '.')
    .join('/')

  if (safe === '') return null

  const resolved = path.resolve(outputDir, safe)
  const resolvedBase = path.resolve(outputDir)
  if (!isPathContained(resolved, resolvedBase)) {
    return null
  }

  if (process.platform === 'win32') {
    const fullLen = resolved.length
    if (fullLen + DEDUP_RESERVE > WIN_MAX_PATH) {
      const ext = path.extname(safe)
      const dir = path.dirname(safe)
      const stem = path.basename(safe, ext)
      const dirPart = path.resolve(outputDir, dir)
      const available = WIN_MAX_PATH - dirPart.length - 1 - ext.length - DEDUP_RESERVE
      if (available <= 0) return null
      const truncatedStem = stem.substring(0, available).replace(/[. ]+$/, '')
      if (truncatedStem === '') return null
      safe = dir && dir !== '.' ? dir + '/' + truncatedStem + ext : truncatedStem + ext
    }
  }

  if (safe.split('/').some((seg) => isUnsafePathSegment(seg))) return null

  return safe
}

export function resolveAssetSavePath(
  currentSavePath: string,
  serverName: string,
  outputDir: string
): string | null {
  if (!isPathContained(currentSavePath, outputDir)) return null

  const currentDirectory = path.dirname(path.relative(outputDir, currentSavePath))
  const normalizedServerName = serverName.replace(/\\/g, '/')
  const safeServerName = sanitizeAssetFilename(normalizedServerName, outputDir)
  if (!safeServerName) return null
  const serverPath = currentDirectory === '.' ? safeServerName : path.basename(safeServerName)
  const relativePath =
    currentDirectory === '.' ? serverPath : path.join(currentDirectory, serverPath)
  const safeRelativePath = sanitizeAssetFilename(relativePath, outputDir)
  return safeRelativePath ? path.join(outputDir, safeRelativePath) : null
}

export function isPathContained(filePath: string, baseDir: string): boolean {
  const resolved = path.resolve(filePath)
  const resolvedBase = path.resolve(baseDir)
  const relative = path.relative(resolvedBase, resolved)
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  )
}

export function hasValidExtension(filename: string): boolean {
  const lower = filename.toLowerCase()
  return ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

function hasImageExtension(filePath: string): boolean {
  const lower = filePath.toLowerCase()
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

function isImageAsset(pending: PendingDownload): boolean {
  return !!pending.outputDir && hasImageExtension(pending.savePath)
}

function isExactAssetJobFor(pending: PendingDownload, destKey: string): boolean {
  return (
    pending.kind === 'asset' &&
    pending.preserveRequestedFilename === true &&
    canonicalDestKey(pending.requestedSavePath ?? pending.savePath) === destKey
  )
}

function discardTempFile(tempPath: string): void {
  try {
    fs.unlinkSync(tempPath)
  } catch {}
  try {
    fs.rmdirSync(path.dirname(tempPath))
  } catch {}
}

function broadcastProgress(progress: DownloadProgress): void {
  const pending = progress.id !== undefined ? pendingDownloads.get(progress.id) : undefined
  if (pending) {
    if (pending.templateInput) {
      progress = { ...progress, templateInputs: [pending.templateInput] }
    }
    pending.lastProgress = { ...progress, id: pending.id }
    const target =
      pending.senderContents ||
      (pending.window && !pending.window.isDestroyed() ? pending.window.webContents : undefined)
    if (target && !target.isDestroyed()) {
      target.send('desktop2-download-progress', progress)
    }
    for (const sub of pending.subscriberWindows) {
      if (!sub.isDestroyed()) {
        sub.webContents.send('desktop2-download-progress', progress)
      } else {
        pending.subscriberWindows.delete(sub)
      }
    }
    for (const contents of pending.subscriberContents) {
      if (contents.isDestroyed()) {
        pending.subscriberContents.delete(contents)
      } else if (contents !== target) {
        contents.send('desktop2-download-progress', progress)
      }
    }
    for (const [contents, installationId] of pending.installationSubscribers ?? []) {
      if (resolveSenderInstallationId(contents) !== installationId) {
        pending.installationSubscribers?.delete(contents)
      } else if (contents !== target && !pending.subscriberContents.has(contents)) {
        contents.send('desktop2-download-progress', progress)
      }
    }
  }
  _broadcastToRenderer('model-download-progress', progress)
  if (isTerminalStatus(progress.status)) {
    pushRecent(progress)
  }
  downloadEvents.emit('tray-state-changed')
}

function setTaskbarProgress(win: BrowserWindow, progress: DownloadProgress): void {
  if (win.isDestroyed()) return
  if (progress.status === 'downloading') {
    win.setProgressBar(progress.progress)
  } else if (
    progress.status === 'completed' ||
    progress.status === 'error' ||
    progress.status === 'cancelled'
  ) {
    win.setProgressBar(-1)
  }
}

const createdAtById = new Map<string, number>()

function reportProgress(progress: DownloadProgress & { id: string }): void {
  let createdAt = createdAtById.get(progress.id)
  if (createdAt === undefined) {
    createdAt = Date.now()
    createdAtById.set(progress.id, createdAt)
  }
  progress.createdAt = createdAt
  broadcastProgress(progress)
  const pending = pendingDownloads.get(progress.id)
  if (pending?.window) setTaskbarProgress(pending.window, progress)
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath)
    return true
  } catch {
    return false
  }
}

export function parseContentDispositionFilename(header: string | null): string | null {
  if (!header) return null
  const starMatch = header.match(/filename\*\s*=\s*(?:UTF-8''|utf-8'')([^;\s]+)/i)
  if (starMatch?.[1]) {
    try {
      return decodeURIComponent(starMatch[1])
    } catch {}
  }
  const match =
    header.match(/filename\s*=\s*"([^"]+)"/i) || header.match(/filename\s*=\s*([^;\s]+)/i)
  return match?.[1] ?? null
}

function resolveServerFilename(item: Electron.DownloadItem): string | null {
  const cd = item.getContentDisposition()
  const cdName = parseContentDispositionFilename(cd)
  if (cdName) return cdName

  for (const u of item.getURLChain()) {
    try {
      const rcd = new URL(u).searchParams.get('response-content-disposition')
      const rcdName = parseContentDispositionFilename(rcd)
      if (rcdName) return rcdName
    } catch {}
  }

  return null
}

function findPendingForItem(item: Electron.DownloadItem): PendingDownload | undefined {
  const candidates = [...item.getURLChain(), item.getURL()].filter(Boolean)
  for (const u of candidates) {
    const pending = activeJobsForUrl(u).find((p) => p.kind !== 'model' && !p.item)
    if (pending) return pending
  }
  return undefined
}

export interface ModelJobOptions {
  url: string
  filename: string
  directory: string
  installationId?: string | null
  window?: BrowserWindow
  senderContents?: Electron.WebContents
  session?: Electron.Session
  expectedSize?: number
  sha256?: string
  destinationBaseDir?: string
  bypassRootLockFor?: string
  onProgress?: (receivedBytes: number, totalBytes: number) => void
}

export interface ModelJobHandle {
  id: string
  url: string
  savePath: string
  completion: Promise<ModelJobOutcome>
  release: () => void
}

function settledJobHandle(
  id: string,
  url: string,
  savePath: string,
  outcome: ModelJobOutcome
): ModelJobHandle {
  return { id, url, savePath, completion: Promise.resolve(outcome), release: () => {} }
}

function acquireModelJobLease(pending: PendingDownload, cleanup?: () => void): () => void {
  const leaseId = randomUUID()
  ;(pending.leases ??= new Set()).add(leaseId)
  return () => {
    const leases = pending.leases
    if (!leases?.delete(leaseId)) return
    cleanup?.()
    if (leases.size > 0) return
    if (quittingModelDownloads || isQuitInProgress()) return
    if (pendingDownloads.get(pending.id) === pending && !pending.suspended) {
      pauseModelDownload(pending.id)
    }
  }
}

const contentsWatchedForDestroy = new WeakSet<Electron.WebContents>()

function addInstallationSubscriber(
  pending: PendingDownload,
  contents: Electron.WebContents,
  installationId: string
): void {
  ;(pending.installationSubscribers ??= new Map()).set(contents, installationId)
  if (contentsWatchedForDestroy.has(contents)) return
  contentsWatchedForDestroy.add(contents)
  contents.once('destroyed', () => {
    for (const job of pendingDownloads.values()) job.installationSubscribers?.delete(contents)
  })
}

function joinModelJob(
  existing: PendingDownload,
  opts: ModelJobOptions,
  installationId: string | null
): ModelJobHandle {
  const windowContents =
    opts.window && !opts.window.isDestroyed() ? opts.window.webContents : undefined
  if (opts.window && opts.window !== existing.window && windowContents) {
    existing.subscriberWindows.add(opts.window)
    windowContents.send('desktop2-download-progress', existing.lastProgress)
  }
  const joiner = opts.senderContents
  if (
    joiner &&
    !joiner.isDestroyed() &&
    joiner !== windowContents &&
    (installationId === null || resolveSenderInstallationId(joiner) === installationId)
  ) {
    if (joiner !== existing.senderContents) {
      if (installationId) addInstallationSubscriber(existing, joiner, installationId)
      else existing.subscriberContents.add(joiner)
    }
    joiner.send('desktop2-download-progress', existing.lastProgress)
  }
  const onProgress = opts.onProgress
  if (onProgress) {
    ;(existing.progressSubscribers ??= new Set()).add(onProgress)
  }
  const release = acquireModelJobLease(
    existing,
    onProgress ? () => existing.progressSubscribers?.delete(onProgress) : undefined
  )
  if (existing.suspended) resumeModelDownload(existing.id)
  return {
    id: existing.id,
    url: existing.url,
    savePath: existing.savePath,
    completion:
      existing.completion ?? Promise.resolve({ status: 'error', error: 'Download not joinable' }),
    release
  }
}

async function resolveModelSession(
  pending: PendingDownload
): Promise<Electron.Session | undefined> {
  if (pending.explicitSession) return pending.explicitSession
  if (pending.senderContents && !pending.senderContents.isDestroyed()) {
    return pending.senderContents.session
  }
  if (pending.installationId) {
    try {
      const inst = await installations.get(pending.installationId)
      if (inst) return electronSession.fromPartition(expectedPartitionFor(inst))
    } catch {}
  }
  try {
    return electronSession.defaultSession
  } catch {
    return undefined
  }
}

function unregisterModelJob(pending: PendingDownload): void {
  unregisterPending(pending)
  const destKey = canonicalDestKey(pending.savePath)
  if (modelJobIdByDest.get(destKey) === pending.id) modelJobIdByDest.delete(destKey)
}

function finishDestructiveCancel(pending: PendingDownload, destKey: string): void {
  let reowned = false
  for (const job of pendingDownloads.values()) {
    if (job !== pending && job.kind === 'model' && canonicalDestKey(job.savePath) === destKey) {
      reowned = true
      break
    }
  }
  const clean = reowned ? true : removeStagedArtifacts(pending.savePath)
  const base = {
    id: pending.id,
    url: pending.url,
    filename: pending.filename,
    directory: pending.directory
  }
  if (clean) {
    reportProgress({ ...base, progress: 0, status: 'cancelled' })
    unregisterModelJob(pending)
    pending.settleJob?.({ status: 'cancelled' })
  } else {
    const error = 'Cancel failed: staged download files could not be removed'
    reportProgress({
      ...base,
      progress: pending.lastProgress.progress,
      receivedBytes: pending.lastProgress.receivedBytes,
      totalBytes: pending.lastProgress.totalBytes,
      status: 'error',
      error
    })
    unregisterModelJob(pending)
    pending.settleJob?.({ status: 'error', error })
  }
}

const MODEL_PROGRESS_REPORT_MS = 500

async function runModelTransport(pending: PendingDownload): Promise<void> {
  const gen = (pending.attemptGen = (pending.attemptGen ?? 0) + 1)
  pending.cancelRequested = false
  pending.pauseHoldsClaim = false
  const destKey = canonicalDestKey(pending.savePath)
  const prior = pending.transport
  if (prior) {
    pending.transport = null
    trackClosingStream(destKey, prior.done)
  }
  const closing = closingStreamsByDest.get(destKey)
  if (closing) await closing
  const sess = await resolveModelSession(pending)
  if (gen !== pending.attemptGen || pending.suspended || !pendingDownloads.has(pending.id)) {
    return
  }
  if (quittingModelDownloads || isQuitInProgress()) {
    pending.suspended = true
    reportProgress({ ...pending.lastProgress, status: 'paused' })
    return
  }

  const transport = startModelTransfer({
    url: pending.url,
    jobId: pending.id,
    finalPath: pending.savePath,
    directory: pending.directory,
    filename: pending.filename,
    installationId: pending.installationId,
    session: sess,
    expectedSize: pending.expectedSize,
    sha256: pending.sha256,
    onProgress: ({ receivedBytes, totalBytes }) => {
      if (gen !== pending.attemptGen) return
      if (pending.progressSubscribers) {
        for (const sub of pending.progressSubscribers) sub(receivedBytes, totalBytes)
      }
      const now = Date.now()
      const elapsed = (now - pending.lastSpeedTime) / 1000
      if (elapsed * 1000 < MODEL_PROGRESS_REPORT_MS) return
      const delta = receivedBytes - pending.lastSpeedBytes
      const speed = delta > 0 ? delta / elapsed : 0
      pending.lastSpeedBytes = receivedBytes
      pending.lastSpeedTime = now
      const eta = speed > 0 && totalBytes > 0 ? (totalBytes - receivedBytes) / speed : undefined
      reportProgress({
        id: pending.id,
        url: pending.url,
        filename: pending.filename,
        directory: pending.directory,
        progress: totalBytes > 0 ? Math.min(1, receivedBytes / totalBytes) : 0,
        receivedBytes,
        totalBytes: totalBytes > 0 ? totalBytes : undefined,
        speedBytesPerSec: speed > 0 ? speed : undefined,
        etaSeconds: eta,
        status: 'downloading'
      })
    }
  })
  pending.transport = transport

  const outcome = await transport.done
  if (pending.transport === transport) pending.transport = null
  if (gen !== pending.attemptGen) return
  const base = {
    id: pending.id,
    url: pending.url,
    filename: pending.filename,
    directory: pending.directory
  }
  switch (outcome.outcome) {
    case 'completed':
      reportProgress({
        ...base,
        savePath: outcome.savePath,
        progress: 1,
        receivedBytes: pending.expectedSize ?? pending.lastProgress.receivedBytes,
        totalBytes: pending.expectedSize ?? pending.lastProgress.totalBytes,
        status: 'completed'
      })
      unregisterModelJob(pending)
      pending.settleJob?.({ status: 'completed', savePath: outcome.savePath })
      break
    case 'cancelled':
      reportProgress({ ...base, progress: 0, status: 'cancelled' })
      unregisterModelJob(pending)
      pending.settleJob?.({ status: 'cancelled' })
      break
    case 'error':
      reportProgress({
        ...base,
        progress: pending.lastProgress.progress,
        receivedBytes: pending.lastProgress.receivedBytes,
        totalBytes: pending.lastProgress.totalBytes,
        status: 'error',
        error: outcome.error
      })
      unregisterModelJob(pending)
      pending.settleJob?.({ status: 'error', error: outcome.error, code: outcome.code })
      break
    case 'paused':
      if (pending.cancelRequested) {
        pending.cancelRequested = false
        finishDestructiveCancel(pending, destKey)
        break
      }
      pending.suspended = true
      break
  }
}

export async function startManagedModelJob(opts: ModelJobOptions): Promise<ModelJobHandle> {
  const url = opts.url
  const filename = stripQueryParams(opts.filename)
  const directory = opts.directory
  const sha256 = opts.sha256?.trim().toLowerCase()
  const resolvedInstallId = opts.installationId ?? resolveSenderInstallationId(opts.senderContents)
  const ctx = await resolveDownloadContextById(resolvedInstallId)
  const baseDir = opts.destinationBaseDir ?? (ctx ? ctx.downloadBaseDir : getModelsBaseDir())
  const savePath = path.join(baseDir, directory, filename)

  const id = randomUUID()

  retryParamsById.set(id, {
    kind: 'model',
    url,
    filename,
    directory,
    window: opts.window,
    senderContents: opts.senderContents,
    installationId: resolvedInstallId,
    savePath,
    sha256,
    destinationBaseDir: opts.destinationBaseDir
  })

  const makeProgress = (
    overrides: Partial<DownloadProgress>
  ): DownloadProgress & { id: string } => ({
    id,
    url,
    filename,
    directory,
    progress: 0,
    status: 'pending',
    ...overrides
  })

  const lockExemptKey = opts.bypassRootLockFor
    ? canonicalDestKey(opts.bypassRootLockFor)
    : undefined
  const rejectLockedRoot = (candidatePath = savePath): ModelJobHandle | null => {
    if (!isModelPathLocked(candidatePath, lockExemptKey)) return null
    const error = 'The model directory is busy while the installation is being updated'
    reportProgress(makeProgress({ status: 'error', error }))
    return settledJobHandle(id, url, savePath, { status: 'error', error })
  }

  if (!isPathContained(savePath, baseDir)) {
    const error = 'Save path is outside models directory'
    reportProgress(makeProgress({ status: 'error', error }))
    return settledJobHandle(id, url, savePath, { status: 'error', error })
  }

  if (!hasValidExtension(filename)) {
    const error = `Invalid file type. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`
    reportProgress(makeProgress({ status: 'error', error }))
    return settledJobHandle(id, url, savePath, { status: 'error', error })
  }

  let startupSafety: ModelDownloadStartupSafety
  try {
    startupSafety = await initializeModelDownloads()
  } catch {
    startupSafety = { safe: false, unsafePaths: [] }
  }
  const lockedAfterStartup = rejectLockedRoot()
  if (lockedAfterStartup) return lockedAfterStartup
  const unsafeDestKeys = new Set(startupSafety.unsafePaths.map((p) => canonicalDestKey(p)))
  if (unsafeDestKeys.has(canonicalDestKey(savePath))) {
    const error =
      'A previous incomplete download is stuck at this location, likely in ' +
      'use by another program. Close it, then press Retry.'
    reportProgress(makeProgress({ status: 'error', error }))
    return settledJobHandle(id, url, savePath, { status: 'error', error })
  }

  const existenceCandidates = opts.destinationBaseDir
    ? [savePath]
    : buildExistenceCandidates(ctx, baseDir, directory, filename)
  for (const candidate of existenceCandidates) {
    if (unsafeDestKeys.has(canonicalDestKey(candidate))) continue
    if (await regularFileExists(candidate)) {
      const lockedBeforeExistingResult = rejectLockedRoot(candidate)
      if (lockedBeforeExistingResult) return lockedBeforeExistingResult
      if (sha256) {
        let actual: string
        try {
          actual = await sha256File(candidate)
        } catch (err) {
          const error = `Cannot verify existing file: ${(err as Error).message}`
          reportProgress(makeProgress({ status: 'error', error }))
          return settledJobHandle(id, url, savePath, { status: 'error', error })
        }
        if (actual !== sha256) {
          const error = `Existing file ${filename} does not match the expected checksum`
          reportProgress(makeProgress({ status: 'error', error }))
          return settledJobHandle(id, url, savePath, {
            status: 'error',
            error,
            code: 'existing-file-mismatch'
          })
        }
      }
      reportProgress(makeProgress({ progress: 1, status: 'completed', savePath: candidate }))
      return settledJobHandle(id, url, candidate, {
        status: 'completed',
        savePath: candidate,
        alreadyPresent: true
      })
    }
  }

  const lockedBeforeAdmission = rejectLockedRoot()
  if (lockedBeforeAdmission) return lockedBeforeAdmission

  if (quittingModelDownloads || isQuitInProgress()) {
    const error = 'Application is shutting down'
    reportProgress(makeProgress({ status: 'error', error }))
    return settledJobHandle(id, url, savePath, { status: 'error', error })
  }

  const destKey = canonicalDestKey(savePath)
  const idAtDest = modelJobIdByDest.get(destKey)
  if (idAtDest !== undefined) {
    const active = pendingDownloads.get(idAtDest)
    if (active) {
      if (
        active.url !== url ||
        (opts.expectedSize !== undefined &&
          active.expectedSize !== undefined &&
          opts.expectedSize !== active.expectedSize) ||
        (sha256 !== undefined && active.sha256 !== sha256)
      ) {
        const error = `Another download is already writing ${filename} from a different source`
        reportProgress(makeProgress({ status: 'error', error }))
        return settledJobHandle(id, url, savePath, { status: 'error', error })
      }
      retryParamsById.delete(id)
      createdAtById.delete(id)
      return joinModelJob(active, opts, resolvedInstallId)
    }
    modelJobIdByDest.delete(destKey)
  }

  const initial = makeProgress({ status: 'pending' })
  let settleJob!: (outcome: ModelJobOutcome) => void
  const completion = new Promise<ModelJobOutcome>((resolve) => {
    settleJob = resolve
  })
  const pending: PendingDownload = {
    id,
    kind: 'model',
    url,
    filename,
    directory,
    savePath,
    window: opts.window && !opts.window.isDestroyed() ? opts.window : undefined,
    senderContents:
      opts.senderContents && opts.senderContents !== opts.window?.webContents
        ? opts.senderContents
        : undefined,
    subscriberWindows: new Set(),
    subscriberContents: new Set(),
    transport: null,
    suspended: false,
    installationId: resolvedInstallId,
    expectedSize: opts.expectedSize,
    sha256,
    explicitSession: opts.session,
    progressSubscribers: opts.onProgress ? new Set([opts.onProgress]) : undefined,
    settleJob,
    completion,
    lastProgress: initial,
    lastSpeedBytes: 0,
    lastSpeedTime: Date.now()
  }
  const starterOnProgress = opts.onProgress
  const release = acquireModelJobLease(
    pending,
    starterOnProgress ? () => pending.progressSubscribers?.delete(starterOnProgress) : undefined
  )
  registerPending(pending)
  modelJobIdByDest.set(destKey, id)
  reportProgress(initial)

  pending.starting = true
  const failPreflight = (error: string): void => {
    reportProgress(makeProgress({ status: 'error', error }))
    unregisterModelJob(pending)
    pending.settleJob?.({ status: 'error', error })
  }
  pending.preflight = (async (): Promise<void> => {
    try {
      await fs.promises.mkdir(path.dirname(savePath), { recursive: true })
    } catch (err) {
      pending.starting = false
      if (pendingDownloads.get(id) !== pending || pending.cancelling) return
      failPreflight(`Failed to create download directory: ${(err as Error).message}`)
      return
    }
    if (pendingDownloads.get(id) !== pending || pending.cancelling) {
      pending.starting = false
      return
    }
    const staged = ensureStagedPlaceholder(savePath, {
      version: 2,
      jobId: id,
      url,
      expectedSize: opts.expectedSize && opts.expectedSize > 0 ? opts.expectedSize : 0,
      directory,
      filename,
      installationId: resolvedInstallId ?? undefined,
      sha256
    })
    pending.starting = false
    if (!staged) {
      failPreflight('Failed to prepare download staging files')
      return
    }
    if (pending.suspended || pending.cancelling) return
    void runModelTransport(pending)
  })()
  await pending.preflight
  return { id, url, savePath, completion, release }
}

export async function startModelDownload(
  win: BrowserWindow,
  url: string,
  rawFilename: string,
  directory: string,
  senderContents?: Electron.WebContents,
  installationId?: string | null
): Promise<boolean> {
  const handle = await startManagedModelJob({
    url,
    filename: rawFilename,
    directory,
    window: win,
    senderContents,
    installationId
  })
  const active = pendingDownloads.get(handle.id)
  if (active) return true
  const settled = await Promise.race([handle.completion, Promise.resolve(null)])
  if (settled === null) return true
  return settled.status === 'completed'
}

export interface AssetDownloadOptions {
  existingFilePolicy?: 'deduplicate' | 'skip'
  templateInput?: ComfyTemplateInputReference
}

export type AssetDownloadAdmission =
  | { status: 'already-present' }
  | { status: 'accepted' | 'joined'; downloadId: string }
  | { status: 'not-started' }

function joinActiveAssetDownload(
  win: BrowserWindow,
  url: string,
  requestedSavePath: string,
  requireExactDestination: boolean,
  senderContents?: Electron.WebContents
): PendingDownload | undefined {
  const requestedDestKey = canonicalDestKey(requestedSavePath)
  const existing = activeJobsForUrl(url).find(
    (pending) =>
      pending.kind !== 'model' &&
      (!requireExactDestination || isExactAssetJobFor(pending, requestedDestKey))
  )
  if (!existing) return undefined

  if (win !== existing.window) {
    existing.subscriberWindows.add(win)
  }
  const joiner = senderContents ?? (win.isDestroyed() ? undefined : win.webContents)
  if (joiner && !joiner.isDestroyed()) {
    if (joiner !== existing.senderContents) existing.subscriberContents.add(joiner)
    joiner.send('desktop2-download-progress', existing.lastProgress)
  }
  return existing
}

export async function startManagedAssetDownload(
  win: BrowserWindow,
  url: string,
  filename: string,
  outputDir: string,
  authToken?: string,
  senderContents?: Electron.WebContents,
  { existingFilePolicy = 'deduplicate', templateInput }: AssetDownloadOptions = {}
): Promise<AssetDownloadAdmission> {
  const safeFilename = sanitizeAssetFilename(filename, outputDir)
  if (!safeFilename) return { status: 'not-started' }
  if (existingFilePolicy === 'skip' && safeFilename !== filename) {
    return { status: 'not-started' }
  }
  const requestedSavePath = path.join(outputDir, safeFilename)

  const existing = joinActiveAssetDownload(
    win,
    url,
    requestedSavePath,
    existingFilePolicy === 'skip',
    senderContents
  )
  if (existing) return { status: 'joined', downloadId: existing.id }

  if (existingFilePolicy === 'skip' && (await fileExists(requestedSavePath))) {
    return { status: 'already-present' }
  }

  const reserved = joinActiveAssetDownload(
    win,
    url,
    requestedSavePath,
    existingFilePolicy === 'skip',
    senderContents
  )
  if (reserved) return { status: 'joined', downloadId: reserved.id }

  const id = randomUUID()
  const pending: PendingDownload = {
    id,
    kind: 'asset',
    url,
    filename: path.basename(safeFilename),
    directory: '',
    savePath: requestedSavePath,
    requestedSavePath,
    preserveRequestedFilename: existingFilePolicy === 'skip',
    templateInput,
    outputDir,
    window: win,
    senderContents: senderContents !== win.webContents ? senderContents : undefined,
    subscriberWindows: new Set(),
    subscriberContents: new Set(),
    lastProgress: {
      id,
      url,
      filename: path.basename(safeFilename),
      directory: '',
      progress: 0,
      status: 'pending'
    },
    lastSpeedBytes: 0,
    lastSpeedTime: Date.now()
  }
  registerPending(pending)

  let savePath: string
  try {
    savePath =
      existingFilePolicy === 'skip' ? requestedSavePath : await deduplicatePath(requestedSavePath)
  } catch (err) {
    reportProgress({
      ...pending.lastProgress,
      status: 'error',
      error: `Failed to prepare save path: ${err instanceof Error ? err.message : String(err)}`
    })
    unregisterPending(pending)
    return { status: 'not-started' }
  }
  const savedFilename = path.basename(savePath)
  const tempDir = path.join(path.dirname(outputDir), TEMP_DIR_NAME)
  pending.savePath = savePath
  pending.filename = savedFilename
  pending.tempPath = path.join(tempDir, tempFileNameFor(savedFilename))
  pending.lastProgress = { ...pending.lastProgress, filename: savedFilename }

  try {
    await fs.promises.mkdir(path.dirname(savePath), { recursive: true })
    await fs.promises.mkdir(tempDir, { recursive: true })
  } catch (err) {
    reportProgress({
      ...pending.lastProgress,
      status: 'error',
      error: `Failed to create download directory: ${err instanceof Error ? err.message : String(err)}`
    })
    unregisterPending(pending)
    return { status: 'not-started' }
  }

  if (win.isDestroyed()) {
    unregisterPending(pending)
    return { status: 'not-started' }
  }

  retryParamsById.set(pending.id, {
    kind: 'asset',
    url,
    filename: path.relative(outputDir, savePath),
    outputDir,
    authToken,
    window: win,
    senderContents,
    savePath: requestedSavePath,
    existingFilePolicy,
    templateInput
  })

  const sess = (senderContents || win.webContents).session
  attachSessionDownloadHandler(sess)
  const downloadOptions = authToken
    ? { headers: { Authorization: `Bearer ${authToken}` } }
    : undefined
  sess.downloadURL(url, downloadOptions)

  reportProgress(pending.lastProgress)
  return { status: 'accepted', downloadId: pending.id }
}

export async function startAssetDownload(
  win: BrowserWindow,
  url: string,
  filename: string,
  outputDir: string,
  authToken?: string,
  senderContents?: Electron.WebContents,
  options?: AssetDownloadOptions
): Promise<boolean> {
  const admission = await startManagedAssetDownload(
    win,
    url,
    filename,
    outputDir,
    authToken,
    senderContents,
    options
  )
  return admission.status !== 'not-started'
}

export function getActiveAssetDownload(
  url: string,
  filename: string,
  outputDir: string
): DownloadProgress | undefined {
  const safeFilename = sanitizeAssetFilename(filename, outputDir)
  if (!safeFilename) return undefined
  const requestedDestKey = canonicalDestKey(path.join(outputDir, safeFilename))
  const pending = activeJobsForUrl(url).find((candidate) =>
    isExactAssetJobFor(candidate, requestedDestKey)
  )
  return pending ? { ...pending.lastProgress } : undefined
}

async function deduplicatePath(filePath: string): Promise<string> {
  if (!(await fileExists(filePath))) return filePath
  const dir = path.dirname(filePath)
  const ext = path.extname(filePath)
  const base = path.basename(filePath, ext)
  let i = 1
  let candidate: string
  do {
    candidate = path.join(dir, `${base} (${i})${ext}`)
    i++
  } while (await fileExists(candidate))
  return candidate
}

function attachDownloadListeners(item: Electron.DownloadItem, pending: PendingDownload): void {
  item.on('updated', (_ev, state) => {
    if (state !== 'progressing') return
    const total = item.getTotalBytes()
    const received = item.getReceivedBytes()
    const progress = total > 0 ? received / total : 0

    const now = Date.now()
    const elapsed = (now - pending.lastSpeedTime) / 1000
    let speed: number | undefined
    let eta: number | undefined
    if (elapsed >= 0.5) {
      const delta = received - pending.lastSpeedBytes
      speed = delta / elapsed
      pending.lastSpeedBytes = received
      pending.lastSpeedTime = now
      if (speed > 0 && total > 0) {
        eta = (total - received) / speed
      }
    } else {
      speed = pending.lastProgress.speedBytesPerSec
      eta = pending.lastProgress.etaSeconds
    }

    reportProgress({
      id: pending.id,
      url: pending.url,
      filename: pending.filename,
      directory: pending.directory,
      progress,
      receivedBytes: received,
      totalBytes: total,
      speedBytesPerSec: speed,
      etaSeconds: eta,
      status: item.isPaused() ? 'paused' : 'downloading'
    })
  })

  item.once('done', (_ev, state) => {
    if (state === 'completed') {
      if (pending.preserveRequestedFilename && pending.tempPath) {
        const tempPath = pending.tempPath
        try {
          fs.linkSync(tempPath, pending.savePath)
          discardTempFile(tempPath)
          pending.tempPath = undefined
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
            discardTempFile(tempPath)
            pending.tempPath = undefined
          } else {
            try {
              fs.copyFileSync(tempPath, pending.savePath, fs.constants.COPYFILE_EXCL)
              discardTempFile(tempPath)
              pending.tempPath = undefined
            } catch (copyError) {
              if ((copyError as NodeJS.ErrnoException).code === 'EEXIST') {
                discardTempFile(tempPath)
                pending.tempPath = undefined
              } else {
                discardTempFile(tempPath)
                pending.tempPath = undefined
                reportProgress({
                  id: pending.id,
                  url: pending.url,
                  filename: pending.filename,
                  directory: pending.directory,
                  progress: 0,
                  status: 'error',
                  error: 'Failed to move downloaded file to final location'
                })
                unregisterPending(pending)
                return
              }
            }
          }
        }
      }

      if (
        pending.tempPath &&
        pending.outputDir &&
        pending.requestedSavePath &&
        pending.requestedSavePath !== pending.savePath &&
        filesHaveEqualContent(pending.tempPath, pending.requestedSavePath)
      ) {
        discardTempFile(pending.tempPath)
        pending.savePath = pending.requestedSavePath
        pending.filename = path.basename(pending.requestedSavePath)
        pending.tempPath = undefined
      }
      if (pending.tempPath) {
        try {
          fs.renameSync(pending.tempPath, pending.savePath)
        } catch {
          try {
            fs.unlinkSync(pending.tempPath)
          } catch {}
          if (!fs.existsSync(pending.savePath)) {
            reportProgress({
              id: pending.id,
              url: pending.url,
              filename: pending.filename,
              directory: pending.directory,
              progress: 0,
              status: 'error',
              error: 'Failed to move downloaded file to final location'
            })
            unregisterPending(pending)
            return
          }
        }
        try {
          fs.rmdirSync(path.dirname(pending.tempPath))
        } catch {}
      }
      reportProgress({
        id: pending.id,
        url: pending.url,
        filename: pending.filename,
        directory: pending.directory,
        savePath: pending.savePath,
        progress: 1,
        status: 'completed',
        isImage: isImageAsset(pending)
      })
    } else if (state === 'cancelled') {
      if (pending.tempPath) {
        discardTempFile(pending.tempPath)
      }
      reportProgress({
        id: pending.id,
        url: pending.url,
        filename: pending.filename,
        directory: pending.directory,
        progress: 0,
        status: 'cancelled'
      })
    } else {
      if (pending.tempPath) {
        discardTempFile(pending.tempPath)
      }
      reportProgress({
        id: pending.id,
        url: pending.url,
        filename: pending.filename,
        directory: pending.directory,
        progress: 0,
        status: 'error',
        error: `Download failed: ${state}`
      })
    }
    unregisterPending(pending)
  })
}

export function attachSessionDownloadHandler(sess: Electron.Session): void {
  if (attachedSessions.has(sess)) return
  attachedSessions.add(sess)

  sess.on('will-download', (_event, item, webContents) => {
    const pending = findPendingForItem(item)

    if (pending) {
      pending.item = item

      if (pending.tempPath && pending.outputDir && !pending.preserveRequestedFilename) {
        const serverName = resolveServerFilename(item)
        if (serverName) {
          const baseDir = pending.outputDir
          const newSavePath = resolveAssetSavePath(pending.savePath, serverName, baseDir)
          if (newSavePath) {
            if (newSavePath !== pending.savePath) {
              pending.requestedSavePath = newSavePath
              const saveDir = path.dirname(newSavePath)
              let candidate = newSavePath
              let i = 1
              while (fs.existsSync(candidate)) {
                const ext = path.extname(newSavePath)
                const base = path.basename(newSavePath, ext)
                candidate = path.join(saveDir, `${base} (${i})${ext}`)
                i++
              }
              fs.mkdirSync(path.dirname(candidate), { recursive: true })
              pending.savePath = candidate
              pending.filename = path.basename(candidate)
              pending.tempPath = path.join(
                path.dirname(pending.tempPath),
                tempFileNameFor(pending.filename)
              )
              pending.lastProgress = { ...pending.lastProgress, filename: pending.filename }
              const retryParams = retryParamsById.get(pending.id)
              if (retryParams?.kind === 'asset') {
                retryParams.filename = path.relative(baseDir, candidate)
              }
            }
          }
        }
      }

      item.setSavePath(pending.tempPath!)
      attachDownloadListeners(item, pending)
    } else {
      const suggestedName = item.getFilename()
      const downloadsDir = app.getPath('downloads')
      const remembered = settings.get('lastSaveDialogDir')
      const startDir = remembered && fs.existsSync(remembered) ? remembered : downloadsDir
      const sourceWin = webContents ? BrowserWindow.fromWebContents(webContents) : null
      const win =
        sourceWin ?? BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null

      let savePath: string | undefined
      if (win) {
        const filePath = dialog.showSaveDialogSync(win, {
          defaultPath: path.join(startDir, suggestedName),
          filters: buildSaveDialogFilters(suggestedName)
        })
        if (filePath) {
          savePath = filePath
          settings.set('lastSaveDialogDir', path.dirname(filePath))
        } else {
          item.cancel()
          return
        }
      } else {
        let candidate = path.join(startDir, suggestedName)
        let i = 1
        while (fs.existsSync(candidate)) {
          const ext = path.extname(suggestedName)
          const base = path.basename(suggestedName, ext)
          candidate = path.join(startDir, `${base} (${i})${ext}`)
          i++
        }
        savePath = candidate
      }

      item.setSavePath(savePath)

      const url = item.getURL()
      const filename = path.basename(savePath)
      const fallbackWindow = win || mainWindow || BrowserWindow.getAllWindows()[0]
      const id = randomUUID()
      const general: PendingDownload = {
        id,
        kind: 'general',
        url,
        filename,
        directory: '',
        savePath,
        window: fallbackWindow!,
        subscriberWindows: new Set(),
        subscriberContents: new Set(),
        item,
        lastProgress: { id, url, filename, progress: 0, status: 'pending' },
        lastSpeedBytes: 0,
        lastSpeedTime: Date.now()
      }
      registerPending(general)
      reportProgress(general.lastProgress)
      attachDownloadListeners(item, general)
    }
  })
}

export function pauseModelDownload(ref: string): boolean {
  const pending = findActiveByRef(ref)
  if (!pending) return false
  if (pending.kind === 'model') {
    if (pending.cancelling) return false
    pending.resumeOnWake = false
    if (pending.suspended) return true
    pending.suspended = true
    if (pending.transport) {
      pending.pauseHoldsClaim = pending.transport.pause()
    }
    reportProgress({ ...pending.lastProgress, status: 'paused' })
    return true
  }
  if (pending.item && !pending.item.isPaused()) {
    pending.item.pause()
    reportProgress({
      ...pending.lastProgress,
      status: 'paused'
    })
  }
  return true
}

export function resumeModelDownload(ref: string): boolean {
  const pending = findActiveByRef(ref)
  if (!pending) return false
  if (pending.kind === 'model') {
    if (pending.cancelling) return false
    pending.resumeOnWake = false
    if (quittingModelDownloads || isQuitInProgress()) return false
    if (pending.suspended) {
      pending.suspended = false
      reportProgress({ ...pending.lastProgress, status: 'downloading' })
      if (!pending.starting) void runModelTransport(pending)
    }
    return true
  }
  if (pending.item && pending.item.isPaused()) {
    pending.item.resume()
    reportProgress({
      ...pending.lastProgress,
      status: 'downloading'
    })
  }
  return true
}

export function cancelModelDownload(ref: string): boolean {
  const pending = findActiveByRef(ref)
  if (!pending) return false
  if (pending.kind === 'model') {
    if (pending.cancelling) return true
    if (pending.transport) {
      if (!pending.suspended && pending.transport.cancel()) return true
      if (pending.suspended && pending.pauseHoldsClaim) {
        pending.cancelling = true
        pending.attemptGen = (pending.attemptGen ?? 0) + 1
        const transport = pending.transport
        pending.transport = null
        const destKey = canonicalDestKey(pending.savePath)
        if (modelJobIdByDest.get(destKey) === pending.id) modelJobIdByDest.delete(destKey)
        trackClosingStream(
          destKey,
          transport.done.then(() => finishDestructiveCancel(pending, destKey))
        )
        return true
      }
      pending.cancelRequested = true
      return true
    }
    pending.cancelling = true
    pending.attemptGen = (pending.attemptGen ?? 0) + 1
    const destKey = canonicalDestKey(pending.savePath)
    if (modelJobIdByDest.get(destKey) === pending.id) modelJobIdByDest.delete(destKey)
    const closing = closingStreamsByDest.get(destKey)
    if (closing) {
      trackClosingStream(
        destKey,
        closing.then(() => finishDestructiveCancel(pending, destKey))
      )
    } else {
      finishDestructiveCancel(pending, destKey)
    }
    return true
  }
  if (pending.item) {
    pending.item.cancel()
  } else {
    unregisterPending(pending)
    reportProgress({
      id: pending.id,
      url: pending.url,
      filename: pending.filename,
      directory: pending.directory,
      progress: 0,
      status: 'cancelled'
    })
  }
  return true
}

export function retryDownload(ref: string): boolean {
  const row = findRecentByRef(ref)
  if (!row || row.id === undefined) return false
  if (isUnsafeModelWarningRow(row.id)) {
    void initializeModelDownloads().catch(() => undefined)
    return true
  }
  const params = retryParamsById.get(row.id)
  if (!params) return false
  if (params.kind === 'model' && params.savePath) {
    const destKey = canonicalDestKey(params.savePath)
    for (const active of pendingDownloads.values()) {
      if (active.kind === 'model' && canonicalDestKey(active.savePath) === destKey) return false
    }
  } else if (params.kind === 'asset' && params.existingFilePolicy === 'skip' && params.savePath) {
    const destKey = canonicalDestKey(params.savePath)
    for (const active of activeJobsForUrl(params.url)) {
      if (isExactAssetJobFor(active, destKey)) return false
    }
  } else {
    for (const active of activeJobsForUrl(params.url)) {
      if ((active.directory ?? '') === (params.directory ?? '')) return false
    }
  }

  const win =
    params.window && !params.window.isDestroyed()
      ? params.window
      : mainWindow && !mainWindow.isDestroyed()
        ? mainWindow
        : (BrowserWindow.getAllWindows()[0] ?? null)
  if (params.kind === 'asset' && (!win || win.isDestroyed())) return false

  const sender =
    params.senderContents && !params.senderContents.isDestroyed()
      ? params.senderContents
      : undefined

  const idx = recentDownloads.findIndex((d) => d.id === row.id)
  if (idx >= 0) recentDownloads.splice(idx, 1)
  dropRowBookkeeping(row)
  _broadcastToRenderer('model-download-removed', { url: row.url, id: row.id })
  downloadEvents.emit('tray-state-changed')

  if (params.kind === 'asset') {
    void startAssetDownload(
      win!,
      params.url,
      params.filename,
      params.outputDir!,
      params.authToken,
      sender,
      {
        existingFilePolicy: params.existingFilePolicy ?? 'deduplicate',
        templateInput: params.templateInput
      }
    )
  } else {
    void startManagedModelJob({
      url: params.url,
      filename: params.filename,
      directory: params.directory ?? '',
      window: win ?? undefined,
      senderContents: sender,
      installationId: params.installationId,
      sha256: params.sha256,
      destinationBaseDir: params.destinationBaseDir
    })
  }
  return true
}

function isCancellationUnderWay(pending: PendingDownload): boolean {
  return pending.cancelling === true || pending.cancelRequested === true
}

export function subscribeToInstallationModelJobs(
  installationId: string,
  contents: Electron.WebContents
): DownloadProgress[] {
  if (contents.isDestroyed()) return []
  const jobs = [...pendingDownloads.values()].filter(
    (pending) => pending.installationId === installationId && !isCancellationUnderWay(pending)
  )
  for (const job of jobs) addInstallationSubscriber(job, contents, installationId)
  return jobs.map(({ lastProgress: { savePath: _savePath, ...row }, suspended }) => ({
    ...row,
    ...(suspended ? { status: 'paused' as const } : {})
  }))
}

export function getActiveDownloads(): DownloadProgress[] {
  const result: DownloadProgress[] = []
  for (const pending of pendingDownloads.values()) {
    result.push(pending.lastProgress)
  }
  return result
}

const THUMB_WIDTH = 96
const THUMB_CACHE_MAX = 64
const thumbnailCache = new Map<string, string>()

export async function getDownloadThumbnail(savePath: unknown): Promise<string | null> {
  if (typeof savePath !== 'string' || !savePath) return null
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(savePath)) return null
  const resolved = path.resolve(savePath)
  if (!hasImageExtension(resolved)) return null

  let stat: fs.Stats
  try {
    stat = await fs.promises.stat(resolved)
  } catch {
    return null
  }
  if (!stat.isFile()) return null

  const key = `${resolved}:${stat.mtimeMs}`
  const cached = thumbnailCache.get(key)
  if (cached !== undefined) {
    thumbnailCache.delete(key)
    thumbnailCache.set(key, cached)
    return cached
  }

  try {
    const img = nativeImage.createFromPath(resolved)
    if (img.isEmpty()) return null
    const dataUrl = img.resize({ width: THUMB_WIDTH, quality: 'good' }).toDataURL()
    thumbnailCache.set(key, dataUrl)
    while (thumbnailCache.size > THUMB_CACHE_MAX) {
      const oldest = thumbnailCache.keys().next().value
      if (oldest === undefined) break
      thumbnailCache.delete(oldest)
    }
    return dataUrl
  } catch {
    return null
  }
}

export function getAllDownloads(): DownloadProgress[] {
  const result: DownloadProgress[] = []
  for (const pending of pendingDownloads.values()) {
    result.push(pending.lastProgress)
  }
  for (const recent of recentDownloads) {
    result.push(recent)
  }
  return result
}

export function dismissRecentDownload(ref: string): boolean {
  const row = findRecentByRef(ref)
  if (!row) return false
  const idx = recentDownloads.indexOf(row)
  if (idx < 0) return false
  recentDownloads.splice(idx, 1)
  dropRowBookkeeping(row)
  _broadcastToRenderer('model-download-removed', { url: row.url, id: row.id })
  downloadEvents.emit('tray-state-changed')
  return true
}

export function clearFinishedDownloads(): number {
  const removedUrls: string[] = []
  const removedRefs: string[] = []
  const removed = recentDownloads.splice(0, recentDownloads.length)
  for (const r of removed) {
    dropRowBookkeeping(r)
    removedUrls.push(r.url)
    removedRefs.push(r.id ?? r.url)
  }
  if (removedUrls.length === 0) return 0
  _broadcastToRenderer('model-downloads-cleared-finished', { urls: removedUrls, refs: removedRefs })
  downloadEvents.emit('tray-state-changed')
  return removedUrls.length
}

export function detachWindowDownloads(win: BrowserWindow): void {
  const contents = win.isDestroyed() ? undefined : win.webContents
  const ownedByWin = (wc: Electron.WebContents | undefined): boolean => {
    if (!wc) return false
    if (wc.isDestroyed()) return true
    if (contents && wc === contents) return true
    try {
      return BrowserWindow.fromWebContents(wc) === win
    } catch {
      return false
    }
  }
  for (const pending of pendingDownloads.values()) {
    if (pending.window === win) {
      if (!win.isDestroyed()) win.setProgressBar(-1)
      pending.window = undefined
    }
    pending.subscriberWindows.delete(win)
    if (ownedByWin(pending.senderContents)) pending.senderContents = undefined
    for (const contents of pending.installationSubscribers?.keys() ?? []) {
      if (ownedByWin(contents)) pending.installationSubscribers?.delete(contents)
    }
  }
  for (const params of retryParamsById.values()) {
    if (params.window === win) params.window = undefined
    if (ownedByWin(params.senderContents)) params.senderContents = undefined
  }
}

export function initializeModelDownloads(): Promise<ModelDownloadStartupSafety> {
  if (_modelDownloadsInit && !_modelDownloadsInitStale) return _modelDownloadsInit
  _modelDownloadsInitStale = false
  const prior: Promise<unknown> = _modelDownloadsInit ?? Promise.resolve()
  const run = prior
    .catch(() => undefined)
    .then(async () => {
      if (lockedModelRoots.size > 0) return { safe: false, unsafePaths: [] }
      modelDownloadsInitRunning++
      try {
        return await doInitializeModelDownloads()
      } finally {
        modelDownloadsInitRunning--
      }
    })
    .then(
      (safety) => {
        if (!safety.safe && _modelDownloadsInit === run) _modelDownloadsInit = null
        return safety
      },
      (err: unknown) => {
        if (_modelDownloadsInit === run) _modelDownloadsInit = null
        throw err
      }
    )
  _modelDownloadsInit = run
  return run
}

export function invalidateModelDownloadStartupPass(): void {
  _modelDownloadsInitStale = true
}

export interface ModelDownloadStartupSafety {
  safe: boolean
  unsafePaths: string[]
}

let _modelDownloadsInit: Promise<ModelDownloadStartupSafety> | null = null
let _modelDownloadsInitStale = false

const unsafeModelSnapshots: Record<'migration' | 'scan', Map<string, string>> = {
  migration: new Map(),
  scan: new Map()
}

const UNSAFE_MODEL_MESSAGES: Record<'migration' | 'scan', string> = {
  migration:
    'An incomplete download from a previous version is stuck under this ' +
    'model name and may appear broken in ComfyUI. The file is likely in use ' +
    'by another program - close it, then press Retry.',
  scan:
    'A crashed download left an unusable placeholder under this model name ' +
    'and it could not be removed; it may appear broken in ComfyUI. The file ' +
    'is likely in use by another program - close it, then press Retry.'
}

const unsafeModelWarnings = new Map<string, { id: string; path: string }>()

function deriveDestinationBaseDir(finalPath: string, directory: string): string {
  let base = path.dirname(finalPath)
  const segments = directory
    ? path
        .normalize(directory)
        .split(path.sep)
        .filter((s) => s && s !== '.')
    : []
  for (let i = 0; i < segments.length; i++) base = path.dirname(base)
  return base
}

function isUnsafeModelWarningRow(id: string): boolean {
  for (const warning of unsafeModelWarnings.values()) {
    if (warning.id === id) return true
  }
  return false
}

function currentUnsafeModelPaths(): string[] {
  const union = new Map<string, string>()
  for (const snapshot of Object.values(unsafeModelSnapshots)) {
    for (const [key, p] of snapshot) if (!union.has(key)) union.set(key, p)
  }
  return [...union.values()]
}

function reconcileUnsafeModelWarnings(
  origin: 'migration' | 'scan',
  currentPaths: string[] | null
): void {
  if (currentPaths !== null) {
    const next = new Map<string, string>()
    for (const p of currentPaths) next.set(canonicalDestKey(p), p)
    unsafeModelSnapshots[origin] = next
  }
  const union = new Map<string, { path: string; origin: 'migration' | 'scan' }>()
  for (const o of ['migration', 'scan'] as const) {
    for (const [key, p] of unsafeModelSnapshots[o]) {
      if (!union.has(key)) union.set(key, { path: p, origin: o })
    }
  }
  for (const [key, warning] of [...unsafeModelWarnings]) {
    if (union.has(key)) continue
    unsafeModelWarnings.delete(key)
    dismissRecentDownload(warning.id)
  }
  for (const [key, { path: unsafePath, origin: rowOrigin }] of union) {
    let warning = unsafeModelWarnings.get(key)
    if (!warning) {
      warning = { id: randomUUID(), path: unsafePath }
      unsafeModelWarnings.set(key, warning)
    }
    console.error(
      'Model download startup: incomplete model could not be quarantined ' +
        `(will retry next launch): ${unsafePath}`
    )
    reportProgress({
      id: warning.id,
      url: '',
      filename: path.basename(unsafePath),
      directory: path.basename(path.dirname(unsafePath)),
      progress: 0,
      status: 'error',
      error: UNSAFE_MODEL_MESSAGES[rowOrigin]
    })
  }
}

async function doInitializeModelDownloads(): Promise<ModelDownloadStartupSafety> {
  let roots: string[]
  try {
    roots = await collectModelScanRoots()
  } catch (err) {
    console.error('Model download startup: collecting model roots failed:', err)
    return { safe: false, unsafePaths: [] }
  }
  let migrationUnsafe: string[] | null
  try {
    migrationUnsafe = (await migrateLegacyModelDownloadArtifacts(roots)).unsafe
  } catch (err) {
    console.error('Model download startup: legacy artifact migration failed:', err)
    migrationUnsafe = null
  }
  reconcileUnsafeModelWarnings('migration', migrationUnsafe)
  let staged: DiscoveredStagedDownload[] = []
  let scanUnsafe: string[] | null
  try {
    const scan = await scanForStagedDownloads(roots)
    staged = scan.downloads
    scanUnsafe = scan.unsafeFinalPaths
  } catch (err) {
    console.error('Model download startup: staged download scan failed:', err)
    scanUnsafe = null
  }
  reconcileUnsafeModelWarnings('scan', scanUnsafe)
  const unsafePaths = currentUnsafeModelPaths()
  const safety: ModelDownloadStartupSafety = {
    safe: migrationUnsafe !== null && scanUnsafe !== null && unsafePaths.length === 0,
    unsafePaths
  }
  for (const job of staged) {
    const { finalPath } = job
    const destKey = canonicalDestKey(finalPath)
    if (modelJobIdByDest.has(destKey)) continue
    if (closingStreamsByDest.has(destKey)) continue
    let destOwned = false
    for (const p of pendingDownloads.values()) {
      if (p.kind === 'model' && canonicalDestKey(p.savePath) === destKey) {
        destOwned = true
        break
      }
    }
    if (destOwned) continue

    const fresh = revalidateStagedPair(finalPath)
    if (fresh === null) continue
    const { meta, stagedBytes } = fresh

    const id = meta.jobId && !pendingDownloads.has(meta.jobId) ? meta.jobId : randomUUID()
    const progress: DownloadProgress & { id: string } = {
      id,
      url: meta.url,
      filename: meta.filename,
      directory: meta.directory,
      progress: meta.expectedSize > 0 ? Math.min(1, stagedBytes / meta.expectedSize) : 0,
      receivedBytes: stagedBytes,
      totalBytes: meta.expectedSize > 0 ? meta.expectedSize : undefined,
      status: 'paused'
    }
    let settleJob!: (outcome: ModelJobOutcome) => void
    const completion = new Promise<ModelJobOutcome>((resolve) => {
      settleJob = resolve
    })
    const pending: PendingDownload = {
      id,
      kind: 'model',
      url: meta.url,
      filename: meta.filename,
      directory: meta.directory,
      savePath: finalPath,
      subscriberWindows: new Set(),
      subscriberContents: new Set(),
      transport: null,
      suspended: true,
      installationId: meta.installationId ?? null,
      expectedSize: meta.expectedSize > 0 ? meta.expectedSize : undefined,
      sha256: meta.sha256,
      settleJob,
      completion,
      lastProgress: progress,
      lastSpeedBytes: stagedBytes,
      lastSpeedTime: Date.now()
    }
    registerPending(pending)
    modelJobIdByDest.set(destKey, id)
    retryParamsById.set(id, {
      kind: 'model',
      url: meta.url,
      filename: meta.filename,
      directory: meta.directory,
      installationId: meta.installationId ?? null,
      savePath: finalPath,
      sha256: meta.sha256,
      destinationBaseDir: deriveDestinationBaseDir(finalPath, meta.directory)
    })
    reportProgress(progress)
  }
  return safety
}

export function hasActiveModelTransfers(): boolean {
  if (closingStreamsByDest.size > 0) return true
  for (const pending of pendingDownloads.values()) {
    if (pending.kind !== 'model') continue
    if (pending.transport || pending.starting) return true
    if (!pending.suspended && !pending.cancelling) return true
  }
  return false
}

let quittingModelDownloads = false

export async function suspendActiveModelDownloadsForQuit(timeoutMs = 5000): Promise<void> {
  quittingModelDownloads = true
  const deadline = Date.now() + timeoutMs
  let waits: Promise<unknown>[] = parkActiveModelTransfers({ resumeOnWake: false })
  const seenClosings = new Set<Promise<unknown>>()
  for (;;) {
    for (const closing of closingStreamsByDest.values()) {
      if (!seenClosings.has(closing)) {
        seenClosings.add(closing)
        waits.push(closing)
      }
    }
    if (waits.length === 0) return
    const remaining = deadline - Date.now()
    if (remaining <= 0) return
    const timedOut = await Promise.race([
      Promise.allSettled(waits).then(() => false),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(true), remaining))
    ])
    if (timedOut) return
    waits = []
  }
}

function parkActiveModelTransfers(opts: { resumeOnWake: boolean }): Promise<unknown>[] {
  const waits: Promise<unknown>[] = []
  for (const pending of pendingDownloads.values()) {
    if (pending.kind !== 'model') continue
    if (opts.resumeOnWake && !pending.suspended) pending.resumeOnWake = true
    const transport = pending.transport
    pending.suspended = true
    if (pending.starting && pending.preflight) {
      waits.push(pending.preflight)
    }
    if (transport) {
      waits.push(transport.done)
      pending.pauseHoldsClaim = transport.pause()
      reportProgress({ ...pending.lastProgress, status: 'paused' })
    }
  }
  return waits
}

export function suspendActiveModelDownloadsForSleep(): void {
  wakeResumeGen++
  parkActiveModelTransfers({ resumeOnWake: true })
}

let wakeResumeGen = 0

export async function resumeModelDownloadsAfterWake(): Promise<void> {
  if (quittingModelDownloads) return
  let anyFlagged = false
  for (const pending of pendingDownloads.values()) {
    if (pending.kind === 'model' && pending.resumeOnWake) {
      anyFlagged = true
      break
    }
  }
  if (!anyFlagged) return
  const gen = ++wakeResumeGen
  await waitForOnline(60_000)
  if (quittingModelDownloads || gen !== wakeResumeGen) return
  for (const pending of [...pendingDownloads.values()]) {
    if (pending.kind !== 'model' || !pending.resumeOnWake) continue
    pending.resumeOnWake = false
    if (pending.suspended) resumeModelDownload(pending.id)
  }
}

async function waitForOnline(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      if (net.isOnline()) return
    } catch {
      return
    }
    if (Date.now() >= deadline) return
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
}

export function _test_resetModelDownloadsQuitLatch(): void {
  quittingModelDownloads = false
}

export function _test_resetModelDownloadsInit(): void {
  _modelDownloadsInit = null
  _modelDownloadsInitStale = false
}

export async function cleanupTempDownloads(): Promise<void> {
  try {
    await fs.promises.rm(getTempDir(), { recursive: true, force: true })
  } catch {}
  try {
    await fs.promises.rm(getAssetTempDir(), { recursive: true, force: true })
  } catch {}
}

export function _test_setSeededTrayState(snapshot: DownloadsTrayState): void {
  pendingDownloads.clear()
  activeIdsByUrl.clear()
  modelJobIdByDest.clear()
  for (const entry of snapshot.active) {
    const id = entry.id ?? randomUUID()
    const stub: PendingDownload = {
      id,
      kind: 'model',
      url: entry.url,
      filename: entry.filename,
      directory: entry.directory ?? '',
      savePath: entry.savePath ?? '',
      subscriberWindows: new Set(),
      subscriberContents: new Set(),
      lastProgress: { ...entry, id },
      lastSpeedBytes: 0,
      lastSpeedTime: Date.now()
    }
    registerPending(stub)
  }
  recentDownloads.length = 0
  for (const entry of snapshot.recent) {
    recentDownloads.push({ ...entry })
  }
  downloadEvents.emit('tray-state-changed')
}
