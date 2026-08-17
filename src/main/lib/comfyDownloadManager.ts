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

/** Asset (output) downloads whose final file is itself an image we can preview. */
export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif']

/**
 * Build "Save as type" filters for the generic Save dialog from the suggested
 * filename. Electron's `showSaveDialog`/`showSaveDialogSync` does not infer
 * filters from the default filename - on Windows the dropdown collapses to
 * "All Files (*.*)" if you omit `filters`, which is the symptom field-reported
 * as "Can't save image from Preview Image node" (#989). Pick a primary filter
 * matching the file's actual extension so the dialog opens on the right
 * format, with "All Files" as a fallback escape hatch.
 */
export function buildSaveDialogFilters(suggestedName: string): Electron.FileFilter[] {
  const ext = path.extname(suggestedName).toLowerCase().replace(/^\./, '')
  const ALL_FILES: Electron.FileFilter = { name: 'All Files', extensions: ['*'] }
  if (!ext) return [ALL_FILES]

  // Group images / video / audio by family so the user can switch between
  // related extensions inside the same Save dialog instead of being locked
  // to the single one we infer. Comfy outputs png/webp/jpg images, mp4/webm
  // video, and wav/mp3/flac/ogg audio depending on the node graph.
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
  // Unknown extension - keep it as a literal filter so the dialog still shows
  // the user what file type they're saving instead of collapsing to *.
  return [{ name: `${ext.toUpperCase()} File`, extensions: [ext] }, ALL_FILES]
}

export interface DownloadProgress {
  /** Stable per-job identifier. Renderer state/controls may address a job by
   *  this instead of the URL (URL keying stays supported for compatibility). */
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
  /** First-seen ms for this URL, preserved across status transitions so the
   *  renderer keeps each entry in its insertion-ordered slot. */
  createdAt?: number
  /** Set on a completed asset download whose file is an image, so the renderer
   *  knows to lazily request a thumbnail via `download-thumbnail`. */
  isImage?: boolean
}

interface PendingDownload {
  /** Stable job id, mirrored onto every progress broadcast. */
  id: string
  /** `model` jobs ride the managed resumable transport; `asset`/`general`
   *  downloads keep the Electron DownloadItem flow. */
  kind: 'model' | 'asset' | 'general'
  url: string
  filename: string
  directory: string
  savePath: string
  /** Asset downloads: the destination as originally requested, before any
   *  "name (1)" dedup. When the completed download is byte-identical to a
   *  file already at this path, the download is discarded in its favor. */
  requestedSavePath?: string
  tempPath?: string
  outputDir?: string
  /** Presentation window. Optional: managed model jobs can run headless
   *  (starter-template downloads start before any ComfyUI window exists). */
  window?: BrowserWindow
  /** The webContents that initiated the download (may differ from window.webContents for WebContentsView). */
  senderContents?: Electron.WebContents
  subscriberWindows: Set<BrowserWindow>
  item?: Electron.DownloadItem
  // --- managed model-job state (kind === 'model') ---
  /** Active transport; null while paused / awaiting session resolution. */
  transport?: ModelTransferHandle | null
  /** True while the job is deliberately parked (paused / restored from a
   *  previous run). Set synchronously on pause; the outgoing transport may
   *  still be flushing its teardown briefly afterwards. */
  suspended?: boolean
  /** Set when system sleep parked the job; wake auto-resumes it. User-paused
   *  jobs never carry this flag. */
  resumeOnWake?: boolean
  /** Bumped per runModelTransport invocation so a superseded attempt (pause
   *  -> quick resume) can't overwrite the live attempt's state. */
  attemptGen?: number
  /** True while admission preflight (directory creation + durable staging
   *  placeholder) is still running. Controls landing during preflight only
   *  toggle `suspended`/registry state; the preflight completion is the ONLY
   *  path that may start the job's first transport. */
  starting?: boolean
  /** Cancel arrived while the live transport was already settling (pause
   *  teardown or finalize verification held the terminal claim). The
   *  transport outcome decides: 'paused' applies the cancel; a completed or
   *  error outcome wins over it (the model may already be installed). */
  cancelRequested?: boolean
  /** True when the live transport's terminal claim is held by a PAUSE this
   *  manager issued - the outcome can only be 'paused', so a cancel landing
   *  during that teardown may commit destructively right away. False when
   *  pause() lost the claim race (finalize verification may be mid-install),
   *  in which case a cancel must defer to the outcome. */
  pauseHoldsClaim?: boolean
  /** Committed to an explicit destructive cancel. The job refuses every
   *  further control and no new attempt may start; the terminal report/
   *  settlement runs once any prior stream for the destination has closed
   *  and the staged-cleanup outcome is known. */
  cancelling?: boolean
  /** Resolves when the admission preflight has finished (transport started,
   *  parked, or failed). Quit/sleep parking awaits it so an admitted job is
   *  durably staged on disk before the process exits. */
  preflight?: Promise<void>
  /** Lease ids of the callers attached to this job (starter + joins). Each
   *  caller owns exactly one lease, released idempotently via its handle's
   *  `release()`. The transfer is only cancelled when the last lease is gone,
   *  so one template abandoning a shared destination can't kill another
   *  caller's download. */
  leases?: Set<string>
  installationId?: string | null
  expectedSize?: number
  /** Expected lowercase-hex sha256 of the complete file; the transport
   *  verifies staged bytes against it before finalizing. */
  sha256?: string
  /** Explicit session for headless callers (template task). Falls back to
   *  senderContents.session, then the install's partition, then default. */
  explicitSession?: Electron.Session
  /** Hot-path byte subscribers (template task counters). Called per chunk. */
  progressSubscribers?: Set<(receivedBytes: number, totalBytes: number) => void>
  /** Settles the job-level completion promise (completed/cancelled/error).
   *  Pause does NOT settle it. */
  settleJob?: (outcome: ModelJobOutcome) => void
  completion?: Promise<ModelJobOutcome>
  lastProgress: DownloadProgress & { id: string }
  lastSpeedBytes: number
  lastSpeedTime: number
}

const attachedSessions = new WeakSet<Electron.Session>()

/** Active downloads keyed by stable job id. The id is the PRIMARY identity;
 *  URLs are a compatibility lookup only (`activeIdsByUrl`), so two jobs with
 *  the same source URL but different destinations coexist independently. */
const pendingDownloads = new Map<string, PendingDownload>()

/** Active job ids per source URL, for compatibility resolution (the in-Comfy
 *  bridge addresses downloads by URL) and DownloadItem matching. */
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

/** Resolve a control ref (stable job id, or a source URL for compatibility
 *  with the in-Comfy bridge / older renderers) to an ACTIVE job. URL
 *  resolution succeeds only when it identifies exactly one job - an ambiguous
 *  URL (same source downloading to two destinations) must not act on an
 *  arbitrary one. */
function findActiveByRef(ref: string): PendingDownload | undefined {
  const byId = pendingDownloads.get(ref)
  if (byId) return byId
  const byUrl = activeJobsForUrl(ref)
  return byUrl.length === 1 ? byUrl[0] : undefined
}

/** Machine-readable cause for callers that must distinguish integrity
 *  failures from transport failures (e.g. ComfyBuilder model staging):
 *  `checksum-mismatch` means the downloaded bytes failed sha256 verification;
 *  `existing-file-mismatch` means a file already at the destination does not
 *  match the expected sha256. */
export type ModelJobErrorCode = 'checksum-mismatch' | 'existing-file-mismatch'

/** Terminal outcome of a managed model job. `paused` is deliberately absent:
 *  a paused job's completion promise stays pending until it is resumed and
 *  finishes, or is cancelled. */
export type ModelJobOutcome =
  | { status: 'completed'; savePath: string; alreadyPresent?: boolean }
  | { status: 'cancelled' }
  | { status: 'error'; error: string; code?: ModelJobErrorCode }

/** Active model job ids indexed by canonical final destination, so concurrent
 *  installs/templates requesting the same model join one transfer instead of
 *  writing the same file twice. */
const modelJobIdByDest = new Map<string, string>()

/** Model roots undergoing an external filesystem transaction. Managed jobs
 * must not read or write inside a locked root. */
const lockedModelRoots = new Map<string, symbol>()
let modelDownloadsInitRunning = 0

/** Streams of superseded or cancelled transports that are still flushing to
 *  a destination's staging file, keyed by canonical destination. A new
 *  transport must not open that staging file until the previous stream there
 *  has fully closed (two writers would corrupt it, and Windows blocks
 *  unlink/rename on open handles), and quit must wait for these before the
 *  process exits so a closing stream cannot be truncated. */
const closingStreamsByDest = new Map<string, Promise<void>>()

/** Record `done` (a settling transport's completion, possibly chained with
 *  its cleanup) as the closing stream for `destKey`. Entries remove
 *  themselves once resolved; multiple closings for one destination chain. */
function trackClosingStream(destKey: string, done: Promise<unknown>): void {
  const prior = closingStreamsByDest.get(destKey) ?? Promise.resolve()
  // allSettled: a rejected teardown (e.g. progress broadcast onto destroyed
  // WebContents) must still release the destination, or every later transfer
  // for it would wait forever and quit suspension would burn its timeout.
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

/** `exemptRootKey` (a canonical dest key) admits paths locked ONLY by that
 *  root: the transaction holding that lock may run its own managed jobs
 *  inside it while everyone else stays locked out. */
function isModelPathLocked(filePath: string, exemptRootKey?: string): boolean {
  for (const root of lockedModelRoots.keys()) {
    if (root === exemptRootKey) continue
    if (pathIsInModelRoot(filePath, root)) return true
  }
  return false
}

/**
 * Reserve a complete model root for a filesystem transaction. Returns null if
 * another transaction overlaps the root or a managed job/closing stream still
 * owns a destination inside it. The release callback is idempotent.
 */
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

/**
 * Retire every PARKED managed model job under `modelsRoot`: suspended jobs
 * with no live transport, no lease holders, and no pending teardown - i.e.
 * rows hydrated from a previous run or left parked by a released caller.
 * Their rows leave the Downloads surfaces and their completion settles as
 * cancelled, but the staged bytes + sidecar STAY on disk, so a new job for
 * the same content (matched by persisted sha256 or URL) resumes them.
 *
 * For ComfyBuilder installs/updates: a parked row inside the install's model
 * root would otherwise permanently block `acquireModelDownloadRootLock`, and
 * its stale presigned URL could never finish anyway - the re-staged download
 * adopts the bytes instead. Jobs that are actively downloading are left
 * alone (the lock acquisition then fails, correctly reporting a busy root).
 */
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

/** Chunked synchronous byte comparison. Bounded memory so it is safe for
 *  large video outputs; sync because it runs inside the DownloadItem's
 *  `done` handler alongside the existing renameSync. */
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

/** Original dispatch params per job id, for `retryDownload`. Kept off the
 *  broadcast `DownloadProgress` because asset downloads carry an `authToken`
 *  that must never reach the renderer. */
interface RetryParams {
  kind: 'model' | 'asset'
  url: string
  filename: string
  /** Optional: model retries can run headless (hydrated/template jobs). */
  window?: BrowserWindow
  senderContents?: Electron.WebContents
  directory?: string
  outputDir?: string
  authToken?: string
  /** Install that initiated the download, so a retry resolves the same
   *  destination even after the originating comfy view is gone. */
  installationId?: string | null
  /** Model jobs: the RESOLVED final destination of the original attempt.
   *  Retry dedupe compares canonical destinations, never URL + directory -
   *  two installs can share both while writing different files. */
  savePath?: string
  /** Model jobs: expected sha256, so a retry keeps verifying integrity. */
  sha256?: string
  /** Model jobs: explicit destination root of the original attempt, so a
   *  retry resolves the same final path. */
  destinationBaseDir?: string
}
const retryParamsById = new Map<string, RetryParams>()

/** Recent terminal downloads kept in main so a tray mounted after a download
 *  finished can still surface it. FIFO-capped at `RECENT_LIMIT`. */
const RECENT_LIMIT = 10
const recentDownloads: DownloadProgress[] = []

/** Event bus for the downloads tray; emits `'tray-state-changed'` on every
 *  progress broadcast. Listener cap bumped since every comfy window subscribes. */
export const downloadEvents = new EventEmitter()
downloadEvents.setMaxListeners(50)

/** Snapshot of the downloads tray: `active` (in-flight) + `recent` (last
 *  `RECENT_LIMIT` terminal entries). Mirrors `comfy-titlebar:downloads-changed`. */
export interface DownloadsTrayState {
  active: DownloadProgress[]
  recent: DownloadProgress[]
}

function isTerminalStatus(status: DownloadProgress['status']): boolean {
  return status === 'completed' || status === 'error' || status === 'cancelled'
}

/** Drop a terminal row's per-id bookkeeping when the row leaves the recent
 *  buffer (dismissed, cleared, replaced by a newer attempt, or evicted). */
function dropRowBookkeeping(row: DownloadProgress): void {
  if (row.id !== undefined) {
    createdAtById.delete(row.id)
    retryParamsById.delete(row.id)
  }
}

/** Resolve a control ref (job id or source URL) to a terminal row in the
 *  recent buffer. URL matching succeeds only when exactly one row matches. */
function findRecentByRef(ref: string): DownloadProgress | undefined {
  const byId = recentDownloads.find((d) => d.id === ref)
  if (byId) return byId
  const byUrl = recentDownloads.filter((d) => d.url === ref)
  return byUrl.length === 1 ? byUrl[0] : undefined
}

function pushRecent(progress: DownloadProgress): void {
  // Replace any prior entry for the same job - or an older attempt at the
  // same URL + directory - so a re-attempted download appears once. Renderer
  // stores key rows by job id, so when the replaced row belonged to an older
  // attempt (different id) tell them to drop it. Rows without a source URL
  // (e.g. unsafe legacy-migration warnings) never match each other by URL -
  // two such files in one directory must both stay visible.
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
  // FIFO eviction past the cap; also drop the createdAt/retry stamps so the
  // maps don't grow unbounded. Broadcast each eviction: renderer stores keep
  // every row they were sent and a later dismissal of an already-evicted row
  // finds nothing in `recentDownloads` (so emits nothing) - without this an
  // evicted row would stay visible forever in open windows.
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

/** installationId backing a download's originating comfy webview, or null when
 *  it can't be attributed (destroyed view / non-comfy sender). */
function resolveSenderInstallationId(senderContents?: Electron.WebContents): string | null {
  if (!senderContents || senderContents.isDestroyed()) return null
  return findInstallationIdByComfySender(senderContents)
}

/** Temp dir on the destination's volume so the final rename is atomic (no EXDEV). */
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

// Windows MAX_PATH is 260 chars (259 usable + null terminator).
// Reserve space for deduplication suffix " (999)" = 6 chars.
const WIN_MAX_PATH = 259
const DEDUP_RESERVE = 6

/**
 * Unique temp file name for an in-flight download. A random nonce (not just
 * a timestamp) prevents collisions when two downloads with the same leaf
 * name start in the same millisecond - plausible now that nested output
 * subfolders make identical basenames (a/video.mp4, b/video.mp4) common.
 */
function tempFileNameFor(filename: string): string {
  return `${Date.now()}-${randomUUID().slice(0, 8)}-${filename}.tmp`
}

// Reserved DOS device names; Windows treats these as devices even with an
// extension (e.g. "NUL.png").
const WIN_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

/**
 * Reject path segments that are unsafe on Windows regardless of host
 * platform (output dirs may be on shared/synced storage): NTFS alternate
 * data streams and other invalid characters, control characters, reserved
 * device names, and trailing dot/space aliases that make filesystem
 * identity disagree with the lexical name.
 */
function isUnsafePathSegment(segment: string): boolean {
  // eslint-disable-next-line no-control-regex
  if (/[<>:"|?*\u0000-\u001F]/.test(segment)) return true
  if (segment.endsWith('.') || segment.endsWith(' ')) return true
  return WIN_RESERVED_NAMES.test(segment)
}

/**
 * Sanitize an asset filename to prevent path traversal and ensure it fits
 * within filesystem limits.  Returns null if the filename is invalid.
 */
export function sanitizeAssetFilename(filename: string, outputDir: string): string | null {
  if (!filename || filename.trim() === '') return null

  // Normalise separators and collapse sequences
  let safe = filename.replace(/\\/g, '/')

  // Reject absolute paths and traversal before treating the name as relative.
  if (safe.startsWith('/') || /^[a-z]:/i.test(safe) || safe.split('/').includes('..')) {
    return null
  }

  safe = safe
    .split('/')
    .filter((seg) => seg !== '.')
    .join('/')

  if (safe === '') return null

  // Verify the resolved path stays inside outputDir
  const resolved = path.resolve(outputDir, safe)
  const resolvedBase = path.resolve(outputDir)
  if (!isPathContained(resolved, resolvedBase)) {
    return null
  }

  // On Windows, truncate filename stem if the full path exceeds MAX_PATH.
  if (process.platform === 'win32') {
    const fullLen = resolved.length
    if (fullLen + DEDUP_RESERVE > WIN_MAX_PATH) {
      const ext = path.extname(safe)
      const dir = path.dirname(safe)
      const stem = path.basename(safe, ext)
      const dirPart = path.resolve(outputDir, dir)
      const available = WIN_MAX_PATH - dirPart.length - 1 - ext.length - DEDUP_RESERVE
      if (available <= 0) return null
      // Trim trailing dots/spaces the truncation may expose so a legitimate
      // long name is shortened rather than rejected below.
      const truncatedStem = stem.substring(0, available).replace(/[. ]+$/, '')
      if (truncatedStem === '') return null
      safe = dir && dir !== '.' ? dir + '/' + truncatedStem + ext : truncatedStem + ext
    }
  }

  // Validate segments last so truncation results are covered too.
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

/**
 * Lexical containment check - deliberately no realpath. Symlinks/junctions
 * the user created inside the output/models directory are respected: a save
 * path under `outputDir/mylink/...` passes and the write follows the link to
 * its target. Only the local user can create such links (a remote server
 * cannot), so following them is user intent, not an escape vector.
 */
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

/** A completed download is previewable only if it's an asset (carries
 *  `outputDir`; model downloads never do) whose final file is an image. */
function isImageAsset(pending: PendingDownload): boolean {
  return !!pending.outputDir && hasImageExtension(pending.savePath)
}

function broadcastProgress(progress: DownloadProgress): void {
  // Send to the originating ComfyUI window and any subscribers
  const pending = progress.id !== undefined ? pendingDownloads.get(progress.id) : undefined
  if (pending) {
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
  }
  // Fan out to every renderer so the Settings -> Downloads tab and popup store
  // both receive live progress events.
  _broadcastToRenderer('model-download-progress', progress)
  // Push terminal entries to the recent buffer first so the snapshot the
  // tray-state listener pulls already reflects the new state.
  if (isTerminalStatus(progress.status)) {
    pushRecent(progress)
  }
  downloadEvents.emit('tray-state-changed')
}

interface TaskbarDownload extends DownloadProgress {
  id: string
}

/** A taskbar batch retains completed jobs until the last job finishes. Without
 *  that retention, completing one of two downloads would remove its bytes
 *  from the denominator and make the aggregate bar jump backwards. Cancelled
 *  and failed jobs are removed because they no longer belong to the workload. */
const taskbarBatches = new Map<BrowserWindow, Map<string, TaskbarDownload>>()

function mergeTaskbarDownload(
  previous: TaskbarDownload | undefined,
  progress: DownloadProgress & { id: string }
): TaskbarDownload {
  const merged = {
    ...previous,
    ...progress,
    receivedBytes: progress.receivedBytes ?? previous?.receivedBytes,
    totalBytes: progress.totalBytes ?? previous?.totalBytes
  }
  // A transport may complete between throttled progress ticks. Its terminal
  // report is authoritative even when the last sampled byte count was lower.
  if (merged.status === 'completed' && merged.totalBytes && merged.totalBytes > 0) {
    merged.receivedBytes = merged.totalBytes
  }
  return merged
}

/** Aggregate known byte totals. Keep the bar empty until every active job has
 *  reported its size: Electron's indeterminate value (> 1) briefly renders as
 *  a full Dock bar on macOS. Completed unknown-size jobs do not hide progress
 *  for work that is still measurable. */
function aggregateTaskbarProgress(downloads: Iterable<TaskbarDownload>): number {
  const jobs = [...downloads]
  if (!jobs.some((job) => !isTerminalStatus(job.status))) return -1
  if (
    jobs.some((job) => !isTerminalStatus(job.status) && !(job.totalBytes && job.totalBytes > 0))
  ) {
    return 0
  }

  let receivedBytes = 0
  let totalBytes = 0
  for (const job of jobs) {
    if (!(job.totalBytes && job.totalBytes > 0)) continue
    totalBytes += job.totalBytes
    const received =
      job.status === 'completed'
        ? job.totalBytes
        : (job.receivedBytes ?? job.progress * job.totalBytes)
    receivedBytes += Math.max(0, Math.min(job.totalBytes, received))
  }
  return totalBytes > 0 ? Math.max(0, Math.min(1, receivedBytes / totalBytes)) : 0
}

function liveTaskbarBatches(): Array<[BrowserWindow, Map<string, TaskbarDownload>]> {
  const live: Array<[BrowserWindow, Map<string, TaskbarDownload>]> = []
  for (const [win, batch] of taskbarBatches) {
    if (win.isDestroyed()) taskbarBatches.delete(win)
    else live.push([win, batch])
  }
  return live
}

function setTaskbarProgress(win: BrowserWindow, progress: DownloadProgress & { id: string }): void {
  if (win.isDestroyed()) return
  let batch = taskbarBatches.get(win)
  if (!batch) taskbarBatches.set(win, (batch = new Map()))
  if (progress.status === 'cancelled' || progress.status === 'error') {
    batch.delete(progress.id)
  } else {
    batch.set(progress.id, mergeTaskbarDownload(batch.get(progress.id), progress))
  }

  // macOS exposes one Dock progress bar for the whole application, so every
  // window-backed download must contribute to the same value. Other platforms
  // retain their native per-window taskbar behavior.
  const batches = liveTaskbarBatches()
  const scopedBatches =
    process.platform === 'darwin' ? batches : batches.filter(([candidate]) => candidate === win)
  const aggregate = aggregateTaskbarProgress(
    scopedBatches.flatMap(([, jobs]) => [...jobs.values()])
  )

  for (const [target] of scopedBatches) target.setProgressBar(aggregate)
  if (aggregate < 0) {
    for (const [target] of scopedBatches) taskbarBatches.delete(target)
  }
}

function detachTaskbarProgress(win: BrowserWindow): void {
  taskbarBatches.delete(win)
  if (!win.isDestroyed()) win.setProgressBar(-1)
  if (process.platform !== 'darwin') return

  const batches = liveTaskbarBatches()
  if (batches.length === 0) return
  const aggregate = aggregateTaskbarProgress(batches.flatMap(([, jobs]) => [...jobs.values()]))
  for (const [target] of batches) target.setProgressBar(aggregate)
  if (aggregate < 0) taskbarBatches.clear()
}

/** First-seen timestamp per job id, preserved across status transitions and
 *  the pending->recent migration; cleared when the row leaves the buffer. */
const createdAtById = new Map<string, number>()

/** Every progress report MUST carry the job's stable id - rows are keyed by
 *  it across main and every renderer surface. */
function reportProgress(progress: DownloadProgress & { id: string }): void {
  // Stamp once per job so its entries keep their slot in the combined view.
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
  // Try filename*= (RFC 5987 encoded)
  const starMatch = header.match(/filename\*\s*=\s*(?:UTF-8''|utf-8'')([^;\s]+)/i)
  if (starMatch?.[1]) {
    try {
      return decodeURIComponent(starMatch[1])
    } catch {}
  }
  // Try filename="..." or filename=...
  const match =
    header.match(/filename\s*=\s*"([^"]+)"/i) || header.match(/filename\s*=\s*([^;\s]+)/i)
  return match?.[1] ?? null
}

function resolveServerFilename(item: Electron.DownloadItem): string | null {
  // 1. Try Content-Disposition header from the response
  const cd = item.getContentDisposition()
  const cdName = parseContentDispositionFilename(cd)
  if (cdName) return cdName

  // 2. Try response-content-disposition query param from the URL chain (GCS pre-signed URLs)
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
    // Only match entries still awaiting their DownloadItem; ones that already
    // have an item are active general downloads we mustn't hijack. Managed
    // model jobs never use a DownloadItem, so a same-URL browser download
    // must not attach to them either.
    const pending = activeJobsForUrl(u).find((p) => p.kind !== 'model' && !p.item)
    if (pending) return pending
  }
  return undefined
}

// ---- Managed model jobs (issue #1322) ---------------------------------------
//
// Every model transfer - in-Comfy missing-model downloads, starter-template
// downloads, tray retries, and jobs restored after a restart - is one managed
// job in `pendingDownloads`, moved by the resumable `modelDownloadTransport`
// (staged `.part` + sidecar; never partial bytes under a model extension).
// Asset/general downloads keep the Electron DownloadItem flow below.

export interface ModelJobOptions {
  url: string
  /** Raw filename; query params are stripped internally. */
  filename: string
  /** Models subdirectory (e.g. `checkpoints`). */
  directory: string
  /** Install context for destination resolution + session fallback. When
   *  omitted, attributed from `senderContents`. */
  installationId?: string | null
  /** Presentation window; optional (headless template jobs omit it). */
  window?: BrowserWindow
  senderContents?: Electron.WebContents
  /** Explicit session (headless callers). */
  session?: Electron.Session
  /** Caller-known expected byte count, validated against the server. */
  expectedSize?: number
  /** Expected lowercase-hex sha256 of the complete file. When set, the staged
   *  bytes are verified before finalization (mismatch -> error with code
   *  'checksum-mismatch'), and a file already at the destination must match
   *  it to count as already present (mismatch -> 'existing-file-mismatch'). */
  sha256?: string
  /** Explicit models root the file must land under, bypassing the install's
   *  model-settings resolution (ComfyBuilder staging always targets the
   *  install-local `ComfyUI/models`). Also narrows the already-present check
   *  to the exact destination. */
  destinationBaseDir?: string
  /** Models root the CALLER itself holds the download root lock on (via
   *  `acquireModelDownloadRootLock`), admitting this job inside it while the
   *  lock keeps every other caller out. */
  bypassRootLockFor?: string
  /** Hot-path per-chunk byte counter (O(1) work only - no IPC/allocation). */
  onProgress?: (receivedBytes: number, totalBytes: number) => void
}

export interface ModelJobHandle {
  id: string
  url: string
  savePath: string
  /** Resolves with the job's terminal outcome; never rejects. Pause keeps it
   *  pending; resume/retry continue the same promise. */
  completion: Promise<ModelJobOutcome>
  /** Release THIS caller's lease on the job. Idempotent - calling it twice
   *  releases one lease once, and it can never release another caller's
   *  lease. Releasing the last lease PARKS the transfer resumably (network
   *  stops, staged bytes + sidecar kept); only an explicit Downloads Cancel
   *  is destructive. During app quit release defers to the quit path, which
   *  parks every active transfer itself. */
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

/** Create a caller-owned, idempotent lease on `pending`. `cleanup` runs once
 *  when THIS lease is released (e.g. detaching the caller's progress
 *  subscriber). Releasing the last lease PARKS the job resumably (network
 *  stops, staged bytes + sidecar stay, the row shows paused): a host window
 *  closing over a template download must not destroy bytes the Downloads UI
 *  can resume. Only an explicit Downloads Cancel (`cancelModelDownload`) is
 *  destructive. During app quit, release defers entirely to the quit path,
 *  which parks every active transfer itself. */
function acquireModelJobLease(pending: PendingDownload, cleanup?: () => void): () => void {
  const leaseId = randomUUID()
  ;(pending.leases ??= new Set()).add(leaseId)
  return () => {
    const leases = pending.leases
    if (!leases?.delete(leaseId)) return
    cleanup?.()
    if (leases.size > 0) return
    if (quittingModelDownloads || isQuitInProgress()) return
    // Only park the job this lease belongs to - never a newer job that
    // happens to reuse the same id slot.
    if (pendingDownloads.get(pending.id) === pending && !pending.suspended) {
      pauseModelDownload(pending.id)
    }
  }
}

/** Attach a caller to an existing active job (same canonical destination). */
function joinModelJob(existing: PendingDownload, opts: ModelJobOptions): ModelJobHandle {
  if (opts.window && opts.window !== existing.window && !opts.window.isDestroyed()) {
    existing.subscriberWindows.add(opts.window)
    opts.window.webContents.send('desktop2-download-progress', existing.lastProgress)
  }
  const onProgress = opts.onProgress
  if (onProgress) {
    ;(existing.progressSubscribers ??= new Set()).add(onProgress)
  }
  const release = acquireModelJobLease(
    existing,
    onProgress ? () => existing.progressSubscribers?.delete(onProgress) : undefined
  )
  // A parked job (user pause, or hydrated from a previous run) that a NEW
  // caller joins must actually transfer - otherwise the joiner's completion
  // (e.g. a template launch awaiting this model) would never settle.
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

/** Session for a model transfer: explicit > originating sender > the install's
 *  partition > default. Keeps gated-repo cookies riding along even for
 *  headless (template / hydrated) jobs. */
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

/** Remove a finished/cancelled model job from the active registries. */
function unregisterModelJob(pending: PendingDownload): void {
  unregisterPending(pending)
  const destKey = canonicalDestKey(pending.savePath)
  if (modelJobIdByDest.get(destKey) === pending.id) modelJobIdByDest.delete(destKey)
}

/** Terminal half of an explicit destructive cancel. Must run only once any
 *  prior stream for the destination has closed (deleting staged files under
 *  an open stream fails on Windows). Removes the staged artifacts - unless a
 *  replacement job re-owned the destination while the stream closed, in
 *  which case they are the replacement's, not this job's to delete - then
 *  reports honestly: a failed removal means the pair would rehydrate next
 *  launch, so a clean 'cancelled' would lie and the job settles as an error
 *  instead. Reports while still registered so subscribers resolved through
 *  the registry receive the terminal event. */
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

/** Drive one transport attempt for `pending` and translate its outcome into
 *  registry/broadcast state. Pause leaves the job parked for a later resume;
 *  everything else is terminal and settles the completion promise. */
async function runModelTransport(pending: PendingDownload): Promise<void> {
  const gen = (pending.attemptGen = (pending.attemptGen ?? 0) + 1)
  // A fresh attempt supersedes any cancel that was deferred against a prior
  // attempt's settling transport (the prior outcome handler early-returns on
  // gen mismatch, so it would never consume the flag; left set it would
  // destroy this attempt the next time it parks). The pause-claim marker
  // likewise belongs to the prior attempt's transport.
  pending.cancelRequested = false
  pending.pauseHoldsClaim = false
  const destKey = canonicalDestKey(pending.savePath)
  // Drain any stream still flushing to this destination - a prior attempt of
  // this job (pause -> quick resume) or a cancelled predecessor job whose
  // teardown is still closing - so two transports never write the same
  // staging file.
  const prior = pending.transport
  if (prior) {
    pending.transport = null
    trackClosingStream(destKey, prior.done)
  }
  const closing = closingStreamsByDest.get(destKey)
  if (closing) await closing
  const sess = await resolveModelSession(pending)
  // The job may have been paused, cancelled, superseded by a newer attempt,
  // or overtaken by quit parking while the awaits above resolved.
  if (gen !== pending.attemptGen || pending.suspended || !pendingDownloads.has(pending.id)) {
    return
  }
  if (quittingModelDownloads || isQuitInProgress()) {
    // Quit began while the awaits above resolved. Park instead of starting a
    // transport: the staged pair from admission preflight is already durable,
    // so the job hydrates paused on the next launch - and if this quit is
    // later aborted (update flow), the row is an honest Paused with a working
    // Resume instead of a silently stalled download.
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
  // A newer attempt superseded this one while it was settling (pause ->
  // quick resume). The newer attempt owns every state transition now; a
  // stale attempt must not mutate progress, suspension, or registries.
  if (gen !== pending.attemptGen) return
  const base = {
    id: pending.id,
    url: pending.url,
    filename: pending.filename,
    directory: pending.directory
  }
  // Terminal reports go out BEFORE the job leaves the registries: the
  // originating window / senderContents / subscriber windows and the taskbar
  // are resolved through `pendingDownloads`, so unregistering first would
  // silently drop the final completed/cancelled/error event for them.
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
        // A cancel arrived while this transport was settling and was
        // deferred to the outcome. The transport parked (did not complete),
        // so the cancel applies now: the stream is closed, staged artifacts
        // are safe to delete.
        pending.cancelRequested = false
        finishDestructiveCancel(pending, destKey)
        break
      }
      // Parked: staged bytes + sidecar retained; the job row stays in
      // `pendingDownloads` as paused. `resumeModelDownload` restarts the
      // transport; `cancelModelDownload` removes the staged state.
      pending.suspended = true
      break
  }
}

/**
 * Start (or join) a managed model download. The single entry point for every
 * model transfer: the ComfyUI bridge (`startModelDownload` wraps this), the
 * starter-template task, tray retries, and restored jobs.
 */
export async function startManagedModelJob(opts: ModelJobOptions): Promise<ModelJobHandle> {
  const url = opts.url
  const filename = stripQueryParams(opts.filename)
  const directory = opts.directory
  const sha256 = opts.sha256?.trim().toLowerCase()
  // Resolve the initiating install so destination + existence check follow its
  // model settings. An explicit `installationId` (from retries / templates)
  // wins over the live sender so a retry still targets the right install
  // after its view is gone. An explicit destination root wins over both.
  const resolvedInstallId = opts.installationId ?? resolveSenderInstallationId(opts.senderContents)
  const ctx = await resolveDownloadContextById(resolvedInstallId)
  const baseDir = opts.destinationBaseDir ?? (ctx ? ctx.downloadBaseDir : getModelsBaseDir())
  const savePath = path.join(baseDir, directory, filename)

  // Candidate identity for this request. Discarded (with its bookkeeping) if
  // the request ends up joining an already-active job at the same destination.
  const id = randomUUID()

  // Capture before the validation early-returns so even a synchronous
  // error (bad path / extension) lands a retryable terminal entry.
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

  // Startup-safety barrier BEFORE the existence check: the startup pass
  // quarantines legacy truncated files that sit under final model names.
  // Admitting a job (or worse, reporting `alreadyPresent` for such a file)
  // while that pass is still running would certify a truncated model as
  // complete - the exact corruption #1322 is about. All callers share the
  // memoized pass. An unsafe pass is NARROW: it only refuses a job whose own
  // destination is a still-visible incomplete file (the quarantine rename
  // failed, e.g. the file is locked - a fresh transfer could not replace it
  // either), and it only excludes those paths from the already-present check.
  // Unrelated destinations, and a pass that merely failed to certify the
  // roots, proceed normally - one stuck file must not disable every model
  // download, and it never blocks launching ComfyUI itself.
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
    // The quarantine was re-attempted by the awaited pass just above (unsafe
    // passes are never memoized), so this fires only while the broken file is
    // STILL immovable right now - and a completed transfer could not replace
    // it at finalization either (install is strictly no-clobber). Refusing up
    // front spares the full transfer; Retry re-runs the whole path.
    const error =
      'A previous incomplete download is stuck at this location, likely in ' +
      'use by another program. Close it, then press Retry.'
    reportProgress(makeProgress({ status: 'error', error }))
    return settledJobHandle(id, url, savePath, { status: 'error', error })
  }

  // Report completed without downloading only when the file already exists
  // somewhere the install's ComfyUI actually searches. A known-incomplete
  // file must never satisfy this check - it is exactly the truncated model
  // #1322 is about. With an explicit destination root, only the exact
  // destination counts (ComfyBuilder staging must place the file there).
  const existenceCandidates = opts.destinationBaseDir
    ? [savePath]
    : buildExistenceCandidates(ctx, baseDir, directory, filename)
  for (const candidate of existenceCandidates) {
    if (unsafeDestKeys.has(canonicalDestKey(candidate))) continue
    if (await regularFileExists(candidate)) {
      const lockedBeforeExistingResult = rejectLockedRoot(candidate)
      if (lockedBeforeExistingResult) return lockedBeforeExistingResult
      if (sha256) {
        // An integrity-checked caller can only accept an existing file that
        // IS the expected content; anything else at the destination is a
        // conflict the caller must resolve, not a completed download.
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

  // Atomic with registration below: a lock acquired before this check is seen
  // here; one acquired afterwards sees the registered pending job and refuses.
  const lockedBeforeAdmission = rejectLockedRoot()
  if (lockedBeforeAdmission) return lockedBeforeAdmission

  // Shutdown admission gate, checked in the same synchronous block that
  // registers the job: quit parking snapshots the active jobs once and waits
  // on that snapshot, so a job admitted after the snapshot would run its
  // preflight disk writes (and possibly a transport) with nothing awaiting
  // them. Refuse admission outright - the caller gets a settled error handle
  // and no registry entry, staging, or network activity is created.
  if (quittingModelDownloads || isQuitInProgress()) {
    const error = 'Application is shutting down'
    reportProgress(makeProgress({ status: 'error', error }))
    return settledJobHandle(id, url, savePath, { status: 'error', error })
  }

  // Join by canonical destination: another job already writing this exact
  // final file (concurrent installs / template + manual download), whether it
  // was started from the same URL or a different one. The same URL aimed at a
  // DIFFERENT destination stays a fully independent job - jobs are keyed by
  // id, never by URL, so it cannot attach to the wrong transfer.
  const destKey = canonicalDestKey(savePath)
  const idAtDest = modelJobIdByDest.get(destKey)
  if (idAtDest !== undefined) {
    const active = pendingDownloads.get(idAtDest)
    if (active) {
      // Joining is only safe when the caller wants the same bytes: the same
      // source URL and (when both sides declare one) the same expected size
      // and hash. A caller that REQUIRES integrity verification can also
      // never join a job that does not verify - the guarantee would silently
      // vanish. A different source aimed at the same final file is a
      // conflict, not a join - silently attaching would hand the caller
      // another URL's file.
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
      return joinModelJob(active, opts)
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
  // Admission is atomic: the destination reservation and job registration
  // happen in the same synchronous block as the join check above, so two
  // concurrent starts for one destination can never both create a transport -
  // the second start always finds (and joins) the first.
  registerPending(pending)
  modelJobIdByDest.set(destKey, id)
  reportProgress(initial)

  // Admission preflight: everything between registration and the first
  // transport start. Controls landing during it only toggle state (pause and
  // resume flip `suspended`; cancel removes the job from the registry) - the
  // preflight completion below is the ONLY path that may start the first
  // transport, so a pause -> resume during the awaits can never launch a
  // second concurrent transport. Quit/sleep parking awaits `preflight` so an
  // admitted job is durably staged on disk before the process exits.
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
      // Cancel may have landed during the mkdir await and already reported
      // and settled this job (or committed to a deferred destructive cancel
      // that will) - a late mkdir failure is not ours to report.
      if (pendingDownloads.get(id) !== pending || pending.cancelling) return
      failPreflight(`Failed to create download directory: ${(err as Error).message}`)
      return
    }
    // Cancelled during the mkdir await: the job already reported/settled (or
    // committed to a deferred destructive cancel whose teardown will remove
    // the staged artifacts) - do not create/recreate them.
    if (pendingDownloads.get(id) !== pending || pending.cancelling) {
      pending.starting = false
      return
    }
    // Durable placeholder while the job is only in-memory: a quit/crash
    // after admission must still leave a hydratable pair on disk. The
    // transport re-verifies (and refreshes) it before any network activity.
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
    // A pause (user or quit/sleep parking) during preflight keeps the job
    // parked until it is explicitly resumed; a deferred cancel means the
    // teardown owns the job and no transport may ever start.
    if (pending.suspended || pending.cancelling) return
    void runModelTransport(pending)
  })()
  await pending.preflight
  return { id, url, savePath, completion, release }
}

/** ComfyUI-bridge compatible wrapper (`downloadModel(url, filename, directory)
 *  => boolean`). Dispatch success = a managed job was started, joined, or the
 *  file already existed; synchronous validation failures return false. */
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
  // Only a pre-dispatch failure (validation / conflict) reports false, so the
  // bridge keeps its existing semantics: `true` means "the download is
  // underway (or done)", not "it finished successfully".
  const active = pendingDownloads.get(handle.id)
  if (active) return true
  const settled = await Promise.race([handle.completion, Promise.resolve(null)])
  if (settled === null) return true
  return settled.status === 'completed'
}

export async function startAssetDownload(
  win: BrowserWindow,
  url: string,
  filename: string,
  outputDir: string,
  authToken?: string,
  senderContents?: Electron.WebContents
): Promise<boolean> {
  const safeFilename = sanitizeAssetFilename(filename, outputDir)
  if (!safeFilename) return false

  // Join an active asset/general download of the same URL. Managed model jobs
  // sharing the URL are independent (different destination class entirely).
  const existing = activeJobsForUrl(url).find((p) => p.kind !== 'model')
  if (existing) {
    if (win !== existing.window) {
      existing.subscriberWindows.add(win)
    }
    if (!win.isDestroyed()) {
      win.webContents.send('desktop2-download-progress', existing.lastProgress)
    }
    return true
  }

  // Reserve the URL before the first await: the same URL can be requested
  // again while the async setup below is still in flight (e.g. an output
  // reported twice in quick succession), and that request must join this
  // download instead of racing past the pending check above and starting a
  // second download, which would save a duplicate file.
  const id = randomUUID()
  const pending: PendingDownload = {
    id,
    kind: 'asset',
    url,
    filename: path.basename(safeFilename),
    directory: '',
    savePath: path.join(outputDir, safeFilename),
    requestedSavePath: path.join(outputDir, safeFilename),
    outputDir,
    window: win,
    senderContents: senderContents !== win.webContents ? senderContents : undefined,
    subscriberWindows: new Set(),
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

  // Failures below report a terminal `error` entry and resolve false instead
  // of rethrowing: `retryDownload` re-dispatches fire-and-forget, so a
  // rejection here would surface as an unhandled promise rejection rather
  // than an error row, unlike `startModelDownload`'s failure paths.
  let savePath: string
  try {
    savePath = await deduplicatePath(path.join(outputDir, safeFilename))
  } catch (err) {
    reportProgress({
      ...pending.lastProgress,
      status: 'error',
      error: `Failed to prepare save path: ${err instanceof Error ? err.message : String(err)}`
    })
    unregisterPending(pending)
    return false
  }
  const savedFilename = path.basename(savePath)
  // Temp dir is a sibling of the output dir - same filesystem for atomic rename,
  // but outside the output dir so ComfyUI won't scan it.
  const tempDir = path.join(path.dirname(outputDir), TEMP_DIR_NAME)
  pending.savePath = savePath
  pending.filename = savedFilename
  pending.tempPath = path.join(tempDir, tempFileNameFor(savedFilename))
  pending.lastProgress = { ...pending.lastProgress, filename: savedFilename }

  try {
    await fs.promises.mkdir(path.dirname(savePath), { recursive: true })
    await fs.promises.mkdir(tempDir, { recursive: true })
  } catch (err) {
    // Release the reservation so the URL is not stuck pointing at a download
    // that never started.
    reportProgress({
      ...pending.lastProgress,
      status: 'error',
      error: `Failed to create download directory: ${err instanceof Error ? err.message : String(err)}`
    })
    unregisterPending(pending)
    return false
  }

  if (win.isDestroyed()) {
    unregisterPending(pending)
    return false
  }

  // Register retry params only once the download is viable: an earlier
  // registration would survive a mkdir failure or destroyed window as a
  // ghost entry with no matching pending download.
  retryParamsById.set(pending.id, {
    kind: 'asset',
    url,
    filename: path.relative(outputDir, savePath),
    outputDir,
    authToken,
    window: win,
    senderContents
  })

  const sess = (senderContents || win.webContents).session
  attachSessionDownloadHandler(sess)
  // Pass auth headers directly; the original URL stays in item.getURLChain()
  // across redirects, so findPendingForItem still matches.
  const downloadOptions = authToken
    ? { headers: { Authorization: `Bearer ${authToken}` } }
    : undefined
  sess.downloadURL(url, downloadOptions)

  reportProgress(pending.lastProgress)
  return true
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
      // If a byte-identical file already sits at the originally requested
      // destination, keep it and discard the temp copy instead of saving a
      // duplicate "name (1)" file. This is the normal case when the "remote"
      // server is actually local and writes its outputs into the same
      // directory the auto-download saves to, and when a re-run re-serves an
      // output that was already downloaded.
      if (
        pending.tempPath &&
        pending.outputDir &&
        pending.requestedSavePath &&
        pending.requestedSavePath !== pending.savePath &&
        filesHaveEqualContent(pending.tempPath, pending.requestedSavePath)
      ) {
        try {
          fs.unlinkSync(pending.tempPath)
        } catch {}
        try {
          fs.rmdirSync(path.dirname(pending.tempPath))
        } catch {}
        pending.savePath = pending.requestedSavePath
        pending.filename = path.basename(pending.requestedSavePath)
        pending.tempPath = undefined
      }
      // Model downloads use a temp file that needs to be moved to the final path
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
        // Try to remove the temp directory if it's now empty (safe - fails silently if not empty)
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
        try {
          fs.unlinkSync(pending.tempPath)
        } catch {}
        try {
          fs.rmdirSync(path.dirname(pending.tempPath))
        } catch {}
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
        try {
          fs.unlinkSync(pending.tempPath)
        } catch {}
        try {
          fs.rmdirSync(path.dirname(pending.tempPath))
        } catch {}
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
      // Managed download - auto-save to the resolved path
      pending.item = item

      // Resolve a better asset filename from the server response: cloud uses
      // content hashes in the WebSocket message, so the human-readable name is
      // only available from the HTTP Content-Disposition.
      if (pending.tempPath && pending.outputDir) {
        const serverName = resolveServerFilename(item)
        if (serverName) {
          const baseDir = pending.outputDir
          const newSavePath = resolveAssetSavePath(pending.savePath, serverName, baseDir)
          if (newSavePath) {
            if (newSavePath !== pending.savePath) {
              // The server-resolved name is now the requested destination the
              // completed download compares against for content-identity.
              pending.requestedSavePath = newSavePath
              // Synchronous dedup since will-download must be handled synchronously.
              const saveDir = path.dirname(newSavePath)
              let candidate = newSavePath
              let i = 1
              while (fs.existsSync(candidate)) {
                const ext = path.extname(newSavePath)
                const base = path.basename(newSavePath, ext)
                candidate = path.join(saveDir, `${base} (${i})${ext}`)
                i++
              }
              // Ensure the target directory exists (server name may introduce subdirs)
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
      // General download - browser-like save dialog
      const suggestedName = item.getFilename()
      const downloadsDir = app.getPath('downloads')
      // Seed the dialog with the directory the user last saved to, matching
      // browser behavior. Fall back to Downloads if unset or no longer present.
      const remembered = settings.get('lastSaveDialogDir')
      const startDir = remembered && fs.existsSync(remembered) ? remembered : downloadsDir
      // `webContents` is null for `session.downloadURL(...)`-initiated downloads
      // (Electron only sets it for page-initiated ones), so fall back to the
      // focused window for the Save dialog parent.
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
        // setSavePath must be synchronous within will-download
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

// ---- Pause / Resume / Cancel ----
//
// Controls accept either a stable job id or the source URL (`findActiveByRef`;
// URL resolution requires an unambiguous match). Managed model jobs are driven
// through their transport; asset/general downloads keep the Electron
// DownloadItem controls.

export function pauseModelDownload(ref: string): boolean {
  const pending = findActiveByRef(ref)
  if (!pending) return false
  if (pending.kind === 'model') {
    // A committed destructive cancel owns the job's remaining transitions -
    // pausing a job that is being torn down is not a real control.
    if (pending.cancelling) return false
    // An explicit pause always cancels a pending wake auto-resume: the user
    // parked this job deliberately (possibly while a post-wake connectivity
    // wait was in flight) and it must stay parked until they resume it.
    pending.resumeOnWake = false
    if (pending.suspended) return true
    // Mark suspended synchronously so a resume/cancel that lands while the
    // transport is still flushing sees the job as parked (and resume can
    // start a fresh attempt that drains the old stream first).
    pending.suspended = true
    if (pending.transport) {
      // Transport teardown flushes + keeps staged bytes and sidecar,
      // resolving its `done` as 'paused'. Record whether the pause actually
      // took the terminal claim - a cancel landing during the teardown may
      // only settle immediately when the outcome is provably 'paused'.
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
    // A committed destructive cancel owns the job's remaining transitions -
    // it must never be resumed back to life.
    if (pending.cancelling) return false
    // Explicitly resumed - the wake waiter no longer owns this job.
    pending.resumeOnWake = false
    // Never start a transport once quit parking has begun: the staged state
    // is already durable and the app is exiting for good.
    if (quittingModelDownloads || isQuitInProgress()) return false
    if (pending.suspended) {
      pending.suspended = false
      reportProgress({ ...pending.lastProgress, status: 'downloading' })
      // During admission preflight only the state flips - the preflight
      // completion is the single path that starts the first transport.
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
    // Already committed to a destructive teardown - the pending cancel owns
    // every remaining transition; a second cancel is an idempotent success.
    if (pending.cancelling) return true
    if (pending.transport) {
      // An active transport deletes the staged bytes + sidecar and resolves
      // 'cancelled'; runModelTransport unregisters, broadcasts, and settles
      // the job.
      if (!pending.suspended && pending.transport.cancel()) return true
      if (pending.suspended && pending.pauseHoldsClaim) {
        // Pause teardown holds the transport's terminal claim, so the only
        // possible outcome is 'paused'. Commit the destructive cancel now:
        // free the destination for replacement jobs and refuse further
        // controls, but report/settle only after the old stream has closed
        // and the staged cleanup outcome is known - settling earlier would
        // claim a clean cancel while the bytes/sidecar may still survive.
        pending.cancelling = true
        pending.attemptGen = (pending.attemptGen ?? 0) + 1
        const transport = pending.transport
        pending.transport = null
        const destKey = canonicalDestKey(pending.savePath)
        if (modelJobIdByDest.get(destKey) === pending.id) modelJobIdByDest.delete(destKey)
        // Track the WHOLE teardown (stream close + staged cleanup + settle)
        // as the destination's closing entry: quit waits for it, and a
        // replacement transport at this destination starts only after the
        // cleanup outcome is decided.
        trackClosingStream(
          destKey,
          transport.done.then(() => finishDestructiveCancel(pending, destKey))
        )
        return true
      }
      // The transport refused the cancel (or the pause that parked this job
      // lost the claim race): finalize verification may already hold the
      // terminal claim and the completed model may be mid-install. Reporting
      // a synthetic cancel here could lie about an installed model, so
      // defer: the outcome handler in runModelTransport applies the cancel
      // if the transport parks ('paused'), and lets completed/error win.
      pending.cancelRequested = true
      return true
    }
    // No live transport: parked (paused/hydrated), still in preflight, or
    // mid-attempt while a resumed transport waits on a predecessor's closing
    // stream. Commit the destructive cancel and invalidate the attempt
    // bookkeeping so nothing can resurrect the job, then run the teardown -
    // deferred behind the destination's closing stream when a prior stream
    // is still flushing (its writes could recreate the artifacts after an
    // eager deletion, and deleting under an open handle fails on Windows).
    pending.cancelling = true
    pending.attemptGen = (pending.attemptGen ?? 0) + 1
    const destKey = canonicalDestKey(pending.savePath)
    if (modelJobIdByDest.get(destKey) === pending.id) modelJobIdByDest.delete(destKey)
    const closing = closingStreamsByDest.get(destKey)
    if (closing) {
      // Chain the teardown behind the flushing stream and re-register it as
      // the closing entry so quit and replacement transports wait for the
      // cleanup, not just the stream close.
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
    // Download hasn't reached will-download yet - clean up immediately
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

/** Re-dispatch a terminal download from its captured params. No-op if an
 *  equivalent job is still in flight or its params were evicted. Removes the
 *  old terminal row first (from the buffer and every renderer store) so the
 *  retry gets a fresh slot and a fresh job id. A model retry starts a managed
 *  job that resumes any retained staged bytes. */
export function retryDownload(ref: string): boolean {
  const row = findRecentByRef(ref)
  if (!row || row.id === undefined) return false
  // Unsafe-model warning rows carry no captured job params: Retry re-runs
  // the startup quarantine pass instead of dispatching a transfer (unsafe
  // passes are never memoized, so this attempts the rename again right now).
  // A pass that succeeds dismisses the row; one that still cannot move the
  // file updates the same row in place, so the row itself is left alone here.
  if (isUnsafeModelWarningRow(row.id)) {
    void initializeModelDownloads().catch(() => undefined)
    return true
  }
  const params = retryParamsById.get(row.id)
  if (!params) return false
  // Don't double-dispatch while an equivalent job is already active. Model
  // jobs compare CANONICAL destinations (URL + directory is ambiguous: two
  // installs can share both while resolving to different model roots, and a
  // retry for one must not be blocked by the other's active download).
  // Includes jobs committed to a destructive cancel - their teardown still
  // owns the destination's staged artifacts.
  if (params.kind === 'model' && params.savePath) {
    const destKey = canonicalDestKey(params.savePath)
    for (const active of pendingDownloads.values()) {
      if (active.kind === 'model' && canonicalDestKey(active.savePath) === destKey) return false
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
  // Assets stream through a DownloadItem and genuinely need a window; model
  // jobs run headless on the managed transport.
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
    // Best-effort token reuse - if the captured token has expired the
    // download simply re-enters `error` and stays retryable.
    void startAssetDownload(
      win!,
      params.url,
      params.filename,
      params.outputDir!,
      params.authToken,
      sender
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

export function getActiveDownloads(): DownloadProgress[] {
  const result: DownloadProgress[] = []
  for (const pending of pendingDownloads.values()) {
    result.push(pending.lastProgress)
  }
  return result
}

/** Downscaled-thumbnail data URLs keyed by `${resolvedPath}:${mtimeMs}` so a
 *  re-downloaded file at the same path re-encodes. LRU-capped. */
const THUMB_WIDTH = 96
const THUMB_CACHE_MAX = 64
const thumbnailCache = new Map<string, string>()

/** Read a completed image download and return a small `data:` URL preview, or
 *  `null` for non-images, missing/unreadable files, or any decode failure.
 *  Lazy + cached so it only runs for visible image rows.
 *
 *  `savePath` is a LOCAL filesystem path (a download's `savePath`), never a
 *  remote/source URL - this only ever reads from disk, never the network. A
 *  value with a URL scheme is rejected so a caller passing the wrong field
 *  (e.g. the entry's `url`) can't trigger a path-resolve on a URL. */
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
    // LRU touch: re-insert so it counts as most-recently-used.
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

/** Full snapshot for the renderer store to seed from on mount - active entries
 *  plus the recent terminal buffer. */
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

/** Dismiss a single terminal entry from the recent buffer. Accepts a job id
 *  or an unambiguous URL. Broadcasts `model-download-removed` so every
 *  renderer drops it. */
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

/** Bulk-dismiss every terminal entry from the recent buffer. */
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

/** Detach a closing window's downloads; they continue in the background via
 *  broadcastProgress. Drops the job's references to the window (and its
 *  WebContents): a paused/hydrated job can sit in the registry indefinitely
 *  with no progress event to run the lazy destroyed-window cleanup, so a
 *  retained reference would pin the closed BrowserWindow forever. */
export function detachWindowDownloads(win: BrowserWindow): void {
  const contents = win.isDestroyed() ? undefined : win.webContents
  detachTaskbarProgress(win)
  // The initiating sender is usually a ComfyUI WebContentsView hosted by the
  // window, not the window's own webContents - match by owner (or by already
  // being destroyed), not only by identity with `win.webContents`.
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
      pending.window = undefined
    }
    pending.subscriberWindows.delete(win)
    if (ownedByWin(pending.senderContents)) pending.senderContents = undefined
  }
  // Retry params live as long as their terminal row (recent-buffer cap), so
  // they too would pin the closed window/WebContents.
  for (const params of retryParamsById.values()) {
    if (params.window === win) params.window = undefined
    if (ownedByWin(params.senderContents)) params.senderContents = undefined
  }
}

// ---- Restart lifecycle for managed model jobs --------------------------------

/**
 * Startup pass over every launcher-managed model root, run BEFORE any ComfyUI
 * can scan the model dirs:
 *  1. migrate legacy `<model>` + `<model>.dl-meta` partials (affected releases
 *     wrote failed template downloads straight to the final path) so truncated
 *     files no longer masquerade as loadable models;
 *  2. restore every staged `.part` + sidecar as an actionable paused job in
 *     the Downloads surfaces (Resume continues with Range; Cancel removes the
 *     staged state).
 *
 * Memoized while safe: the app kicks it off at startup, `handleLaunch` awaits
 * it before spawning any ComfyUI process, and `startManagedModelJob` awaits
 * it before admitting any model job; all share one pass. An UNSAFE pass
 * (known-incomplete files still visible under final model names) is NOT
 * memoized - the lock that blocked quarantine may have been released, so the
 * next launch attempt must re-run the migration instead of reusing a stale
 * "checked" result. A REJECTED pass is likewise not memoized.
 *
 * `invalidateModelDownloadStartupPass` marks the memoized result stale (the
 * scan roots changed - e.g. a new installation was created whose model dirs
 * the startup pass never covered). The next call chains a fresh pass behind
 * any in-flight one so two passes can never migrate the same roots
 * concurrently.
 */
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

/** Mark the memoized startup pass stale so the next `initializeModelDownloads`
 *  call re-runs migration/scan over the CURRENT roots. Called when an
 *  installation is created: its model dirs may predate the launcher (or hold
 *  legacy artifacts from an affected release) and were not part of the
 *  startup pass. */
export function invalidateModelDownloadStartupPass(): void {
  _modelDownloadsInitStale = true
}

/** Result of the startup migration/hydration pass. Advisory only: launch
 *  awaits the pass for ordering but NEVER blocks on `safe` (a truncated file
 *  that fails to load beats refusing to start); job admission uses
 *  `unsafePaths` to refuse only jobs targeting those exact destinations. */
export interface ModelDownloadStartupSafety {
  /** False when a model root may still expose a known-incomplete file under
   *  a final model extension (quarantine failed, or the migration pass
   *  itself could not run). ComfyUI may scan truncated models. */
  safe: boolean
  /** The still-visible incomplete final-extension files, when known. */
  unsafePaths: string[]
}

let _modelDownloadsInit: Promise<ModelDownloadStartupSafety> | null = null
let _modelDownloadsInitStale = false

/** Each producer's LATEST KNOWN unsafe findings, keyed by canonical path. A
 *  producer that fails outright on a pass retains its previous snapshot (its
 *  findings are still unresolved); a producer that succeeds replaces its
 *  snapshot with the pass's findings. Warning rows are reconciled against the
 *  UNION of both snapshots, so one path reported by both producers keeps a
 *  visible row until BOTH stop reporting it - keying rows by path alone once
 *  let a later clean migration pass dismiss the only row for a path the scan
 *  still considered unsafe. */
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

/** Persistent "still visible under a final model name" warning rows, keyed by
 *  canonical unsafe path. Stable per path so an UNSAFE pass that is retried
 *  (unsafe results are not memoized) updates one row instead of stacking a
 *  duplicate on every blocked launch attempt, and a later pass that resolves
 *  the path everywhere dismisses its stale warning. */
const unsafeModelWarnings = new Map<string, { id: string; path: string }>()

/** Rebuild the destination root a staged job was created under by walking up
 *  from its final path: one dirname for the filename, one per `directory`
 *  segment. Retrying a hydrated job must reuse this root - resolving the
 *  CURRENT shared models root instead would move the file (and orphan the
 *  staged bytes) for jobs staged under an install-local root. */
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

/** Whether a Downloads row id belongs to an unsafe-model warning row (these
 *  have no retry params; their Retry re-runs the quarantine pass). */
function isUnsafeModelWarningRow(id: string): boolean {
  for (const warning of unsafeModelWarnings.values()) {
    if (warning.id === id) return true
  }
  return false
}

/** All paths currently considered unsafe by any producer, deduplicated by
 *  canonical path. */
function currentUnsafeModelPaths(): string[] {
  const union = new Map<string, string>()
  for (const snapshot of Object.values(unsafeModelSnapshots)) {
    for (const [key, p] of snapshot) if (!union.has(key)) union.set(key, p)
  }
  return [...union.values()]
}

/** Fold one producer's pass result into its snapshot (`null` = the producing
 *  step itself failed; keep its previous findings) and reconcile the warning
 *  rows against the union of both snapshots. */
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
    // Without the roots the legacy migration cannot certify anything -
    // treat the whole pass as unsafe rather than silently skipping it.
    console.error('Model download startup: collecting model roots failed:', err)
    return { safe: false, unsafePaths: [] }
  }
  // Known-incomplete model files that could NOT be hidden from ComfyUI's
  // scan (move failed, e.g. file locked). Their sidecars were kept so the
  // next launch retries; surface each as a persistent error row so the user
  // knows the file is truncated - it would otherwise silently load as a
  // broken model. Never delete the bytes, and never block the launch: the
  // warning rows are the surface, and job admission refuses re-downloads to
  // these exact destinations until the quarantine succeeds.
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
    // The staged scan is strict and is also what finds zero-byte final-name
    // claim markers: a failed (or partial) scan cannot certify that no
    // broken file is visible under a final model name, so the pass is
    // unsafe - not merely "lost Downloads rows". Markers a PREVIOUS pass
    // found (and could not clear) also stay unsafe until a successful scan
    // proves them gone.
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
    // The destination may also be owned by a job that no longer holds the
    // reservation but is still tearing down - a committed destructive cancel
    // releases `modelJobIdByDest` before its deferred cleanup deletes the
    // staged artifacts. Hydrating that pair here would resurrect the
    // cancelled job as a paused row (and the teardown would then treat the
    // new row as a replacement owner and skip the deletion the user asked
    // for). Reachable because an unsafe pass is retried, not memoized.
    if (closingStreamsByDest.has(destKey)) continue
    let destOwned = false
    for (const p of pendingDownloads.values()) {
      if (p.kind === 'model' && canonicalDestKey(p.savePath) === destKey) {
        destOwned = true
        break
      }
    }
    if (destOwned) continue

    // The scan snapshot is stale by now (the walk awaited between roots): a
    // destructive cancel that held no registry entry when checked above may
    // have ALREADY finished and deleted the pair. Re-read the pair
    // synchronously in the same event-loop turn as the registration below so
    // nothing can delete it in between - registering from the snapshot alone
    // would resurrect a destination the user cancelled.
    const fresh = revalidateStagedPair(finalPath)
    if (fresh === null) continue
    const { meta, stagedBytes } = fresh

    // Restore the persisted job identity so restart hydration keeps the same
    // stable ID; fall back to a fresh one for legacy-migrated sidecars (no
    // jobId) or a copied model dir that duplicates an ID.
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
      // Pin the retry to the root this pair was staged under; resolving the
      // current install/shared settings could pick a different root.
      destinationBaseDir: deriveDestinationBaseDir(finalPath, meta.directory)
    })
    reportProgress(progress)
  }
  return safety
}

/** True while any managed model job still needs quit-time attention. Drives
 *  the deferred-quit suspension (`will-quit`) - parked (suspended) jobs need
 *  no teardown, their staged state is already durable. */
export function hasActiveModelTransfers(): boolean {
  // Streams of cancelled/superseded transports may still be flushing to
  // staging files; exiting before they close could truncate staged bytes.
  if (closingStreamsByDest.size > 0) return true
  for (const pending of pendingDownloads.values()) {
    if (pending.kind !== 'model') continue
    // A job still in admission preflight has no transport yet, but its
    // durable staging placeholder may not have landed on disk - quit must
    // wait for the preflight or the job would be lost on restart.
    if (pending.transport || pending.starting) return true
    // A non-parked job with no live transport is between transport attempts
    // (e.g. awaiting session resolution inside runModelTransport). Skipping
    // suspension here would let that attempt start a transport with nothing
    // awaiting its stream; parking it is cheap and makes it hydratable. A
    // committed destructive cancel is owned by its closing-stream entry.
    if (!pending.suspended && !pending.cancelling) return true
  }
  return false
}

/** One-way latch: set once quit parking has begun, so a wake auto-resume
 *  that is still waiting for connectivity cannot restart transfers during
 *  shutdown (the app quits for good after `will-quit` parking). */
let quittingModelDownloads = false

/**
 * Park every active managed model transfer for app quit: network stops, the
 * staged bytes + sidecar stay on disk, and the next launch restores the job
 * as paused via `initializeModelDownloads`. Resolves once every transport has
 * flushed and closed its stream (bounded by `timeoutMs` as a safety valve so
 * a wedged stream can't hang shutdown).
 */
export async function suspendActiveModelDownloadsForQuit(timeoutMs = 5000): Promise<void> {
  quittingModelDownloads = true
  const deadline = Date.now() + timeoutMs
  let waits: Promise<unknown>[] = parkActiveModelTransfers({ resumeOnWake: false })
  const seenClosings = new Set<Promise<unknown>>()
  // Drain until stable: streams of cancelled/superseded transports may still
  // be flushing to staging files (exiting before they close could truncate
  // staged bytes), and settling one can REGISTER a new closing entry (a
  // destructive cancel chains its staged cleanup behind the stream it was
  // waiting on). A single snapshot would miss that continuation.
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
      // allSettled: a wait that rejects (e.g. a preflight that threw while
      // broadcasting) must not abort the drain - the remaining streams still
      // need to flush before quit.
      Promise.allSettled(waits).then(() => false),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(true), remaining))
    ])
    if (timedOut) return
    waits = []
  }
}

/** Park every active model job (network stopped, staged bytes + sidecar
 *  flushed and kept). Shared by quit suspension and system-sleep suspension.
 *  Returns the settle promises of the transports that were still running so
 *  callers can bound-wait for their streams to flush. */
function parkActiveModelTransfers(opts: { resumeOnWake: boolean }): Promise<unknown>[] {
  const waits: Promise<unknown>[] = []
  for (const pending of pendingDownloads.values()) {
    if (pending.kind !== 'model') continue
    if (opts.resumeOnWake && !pending.suspended) pending.resumeOnWake = true
    const transport = pending.transport
    pending.suspended = true
    if (pending.starting && pending.preflight) {
      // Still in admission preflight: wait for its durable staging
      // placeholder to land on disk; `suspended` stops the preflight from
      // starting a transport afterwards.
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

/**
 * System sleep: a socket that dies while the machine is asleep produces no
 * events on wake, so an in-flight transfer would sit until the idle timeout
 * fires. Park active jobs before sleep instead; `resumeModelDownloadsAfterWake`
 * restarts them with a Range resume. User-paused jobs stay paused.
 */
export function suspendActiveModelDownloadsForSleep(): void {
  // Entering sleep invalidates any post-wake waiter from a PREVIOUS cycle
  // that is still polling for connectivity: without this, that stale waiter
  // could auto-resume transfers while the machine is entering (or already
  // in) this new sleep.
  wakeResumeGen++
  parkActiveModelTransfers({ resumeOnWake: true })
}

/** Generation token for the post-wake connectivity waiter. Every sleep entry
 *  and every wake pass bumps it, invalidating any older waiter still polling
 *  for connectivity so only the newest wake pass may auto-resume jobs. */
let wakeResumeGen = 0

/** Wake: wait (bounded) for connectivity, then resume the jobs that sleep
 *  parked. The `resumeOnWake` flags stay on the jobs while we wait (instead of
 *  being drained upfront) so a user action during the wait - pause, resume,
 *  cancel - takes ownership of its job away from the waiter. Quit parking or a
 *  newer sleep/wake cycle invalidates the waiter entirely. */
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
  // Re-check: quit parking may have begun while we waited for connectivity
  // (its parked jobs must stay parked - they hydrate on the next launch), or
  // another sleep/wake cycle superseded this waiter.
  if (quittingModelDownloads || gen !== wakeResumeGen) return
  for (const pending of [...pendingDownloads.values()]) {
    if (pending.kind !== 'model' || !pending.resumeOnWake) continue
    pending.resumeOnWake = false
    if (pending.suspended) resumeModelDownload(pending.id)
  }
}

/** Poll `net.isOnline()` until the network is back or `timeoutMs` elapses.
 *  On timeout the caller proceeds anyway: a failed resume lands a retryable
 *  error row instead of a silent stall. */
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

/** Test-only: clear the one-way quit-parking latch so suites can exercise
 *  quit suspension without poisoning later tests in the same module. */
export function _test_resetModelDownloadsQuitLatch(): void {
  quittingModelDownloads = false
}

/** Test-only: clear the memoized startup pass so suites can run it again. */
export function _test_resetModelDownloadsInit(): void {
  _modelDownloadsInit = null
  _modelDownloadsInitStale = false
}

/** Remove the temp download directories and all their contents. */
export async function cleanupTempDownloads(): Promise<void> {
  try {
    await fs.promises.rm(getTempDir(), { recursive: true, force: true })
  } catch {}
  try {
    await fs.promises.rm(getAssetTempDir(), { recursive: true, force: true })
  } catch {}
}

/** Test-only: replace the in-memory buffers with `snapshot` and emit
 *  `tray-state-changed`. Active entries are stubs carrying only `lastProgress`. */
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
