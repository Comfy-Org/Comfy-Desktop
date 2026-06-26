/**
 * Persistent, rotating global `app.log` in Electron's per-user logs dir.
 *
 * Captures main-process `console.*`, uncaught errors / process-gone events,
 * and teed operation output. Everything is ANSI-stripped and `scrubAll`-ed
 * before write so credentials and usernames are not persisted.
 *
 * Writes are synchronous against a single `O_APPEND` fd: the crash path lands
 * on disk before the dying process exits (a buffered write would be lost), and
 * a single fd lets rotation close/rename/reopen deterministically (renaming a
 * file with an open handle fails on Windows). Writes are no-ops until
 * `initAppLog()` runs, keeping the module inert in unit tests.
 */

import fs from 'fs'
import path from 'path'
import { format } from 'node:util'
import { app } from 'electron'
import { stripAnsi } from './stderrTail'
import { scrubAll } from '../../shared/piiScrub'

const BASE_NAME = 'app.log'
const MAX_BYTES = 5 * 1024 * 1024 // rotate mid-session past 5 MB
const MAX_FILES = 50 // match comfyui.log retention
const ROTATED_RE = /^app\.log_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.log$/
// Flush a not-yet-terminated operation line once it grows past this so a
// chunk stream that never emits a newline can't buffer unbounded.
const MAX_PENDING_LINE = 64 * 1024

const CONSOLE_LEVELS = ['log', 'info', 'warn', 'error', 'debug'] as const
type ConsoleLevel = (typeof CONSOLE_LEVELS)[number]

let logDir: string | null = null
let fd: number | null = null
let currentBytes = 0
let initialized = false
let consolePatched = false
// Per-installation carry for the operation-output tee so a credential split
// across two process chunks ("https://user:to" + "ken@host") is still
// scrubbed: we only write (and scrub) whole lines, keeping the partial tail
// buffered. Keyed by installationId so concurrent installs don't interleave
// partial lines into each other.
const opPendingById = new Map<string, string>()
const originalConsole = new Map<ConsoleLevel, (...args: unknown[]) => void>()

/** Resolve the directory the global log lives in. Falls back to Electron's
 *  per-user logs path when init hasn't picked a dir yet. */
export function getAppLogDir(): string {
  return logDir ?? app.getPath('logs')
}

export function getAppLogPath(): string {
  return path.join(getAppLogDir(), BASE_NAME)
}

/**
 * Open the global log, rotate the previous session's file, and begin
 * capturing `console.*`. Safe to call once; subsequent calls are no-ops.
 * `dir` is injectable for tests.
 */
export function initAppLog(opts?: { dir?: string }): void {
  if (initialized) return
  logDir = opts?.dir ?? app.getPath('logs')
  try {
    fs.mkdirSync(logDir, { recursive: true })
    // Rotates the previous session's app.log (if any) and opens a fresh fd.
    rotateAppLogSync()
  } catch {
    // If we can't open the log, keep going as a no-op rather than crash.
    closeFd()
  }
  initialized = true
  patchConsole()
}

/** Append a runtime log line. Synchronous; safe on the crash path. */
export function writeAppLog(level: string, text: string): void {
  if (!initialized) return
  write(formatLine(level, text))
}

/**
 * Append a log line from the crash path (uncaught exception / process-gone).
 * Synchronous, and skips rotation so a failed rename/reopen can never drop the
 * final record before an imminent process exit.
 */
export function writeAppLogSync(level: string, text: string): void {
  if (!initialized) return
  write(formatLine(level, text), { rotate: false })
}

/**
 * Tee operation output (raw, possibly partial process chunks) to disk for a
 * given installation. Only whole lines are written so cross-chunk secrets are
 * scrubbed intact; the trailing partial line is held (per installation) until
 * the next chunk completes it, the pending tail exceeds `MAX_PENDING_LINE`, or
 * `flushOperationOutput` is called.
 */
export function writeOperationOutput(installationId: string, text: string): void {
  if (!initialized || !text) return
  let pending = (opPendingById.get(installationId) ?? '') + text
  let nl = pending.indexOf('\n')
  while (nl !== -1) {
    write(pending.slice(0, nl + 1))
    pending = pending.slice(nl + 1)
    nl = pending.indexOf('\n')
  }
  if (pending.length > MAX_PENDING_LINE) {
    write(pending.endsWith('\n') ? pending : `${pending}\n`)
    pending = ''
  }
  if (pending) opPendingById.set(installationId, pending)
  else opPendingById.delete(installationId)
}

/** Emit any buffered partial line for an installation (or all installations
 *  when no id is given). Call at operation/session end so a final unterminated
 *  line is durable and a later operation reusing the id can't be appended onto
 *  it. Pass `{ rotate: false }` from the crash path to match `writeAppLogSync`. */
export function flushOperationOutput(installationId?: string, opts?: { rotate?: boolean }): void {
  if (!initialized) return
  const ids = installationId ? [installationId] : [...opPendingById.keys()]
  for (const id of ids) {
    const pending = opPendingById.get(id)
    opPendingById.delete(id)
    if (pending) write(pending.endsWith('\n') ? pending : `${pending}\n`, opts)
  }
}

function formatLine(level: string, text: string): string {
  return `[${new Date().toISOString()}] [${level}] ${text}\n`
}

function write(raw: string, opts?: { rotate?: boolean }): void {
  if (fd === null) return
  const clean = scrubAll(stripAnsi(raw))
  const len = Buffer.byteLength(clean)
  // Rotate before writing so the live file never exceeds the cap mid-write.
  // Crash-path writes opt out: rotation closes the live fd to rename/reopen,
  // and a failed reopen would drop the final record. Letting the file run
  // slightly over the cap (a later normal write rotates it) is safer.
  if (opts?.rotate !== false && currentBytes + len > MAX_BYTES) rotateAppLogSync()
  if (fd === null) return
  try {
    fs.writeSync(fd, clean)
    currentBytes += len
  } catch {
    // Disk full / locked file — drop the line rather than crash the app.
  }
}

function openFd(): void {
  try {
    fd = fs.openSync(getAppLogPath(), 'a')
  } catch {
    fd = null
  }
}

function closeFd(): void {
  if (fd !== null) {
    try {
      fs.closeSync(fd)
    } catch {}
    fd = null
  }
}

/**
 * Synchronous rotation: close the live fd, prune the oldest rotated files
 * past the retention cap, rename the live log to a timestamped sibling, and
 * reopen a fresh fd. Synchronous throughout so the handle is closed before
 * the rename (required on Windows) and `currentBytes` stays consistent.
 */
function rotateAppLogSync(): void {
  if (!logDir) return
  closeFd()
  try {
    const names = fs
      .readdirSync(logDir)
      .filter((n) => ROTATED_RE.test(n))
      .sort()
    while (names.length >= MAX_FILES) {
      const oldest = names.shift()
      if (!oldest) break
      try {
        fs.unlinkSync(path.join(logDir, oldest))
      } catch {}
    }
    if (fs.existsSync(getAppLogPath())) {
      const timestamp = new Date().toISOString().replaceAll(/[.:]/g, '-')
      fs.renameSync(getAppLogPath(), path.join(logDir, `${BASE_NAME}_${timestamp}.log`))
    }
  } catch {}
  openFd()
  currentBytes = 0
}

function patchConsole(): void {
  if (consolePatched) return
  consolePatched = true
  for (const level of CONSOLE_LEVELS) {
    const original = console[level].bind(console) as (...args: unknown[]) => void
    originalConsole.set(level, original)
    console[level] = (...args: unknown[]): void => {
      original(...args)
      try {
        writeAppLog(level === 'log' ? 'INFO' : level.toUpperCase(), format(...args))
      } catch {}
    }
  }
}

/** Test hook: restore console and reset module state between tests. */
export function resetAppLogForTest(): void {
  for (const [level, original] of originalConsole) {
    console[level] = original
  }
  originalConsole.clear()
  closeFd()
  logDir = null
  currentBytes = 0
  opPendingById.clear()
  initialized = false
  consolePatched = false
}
