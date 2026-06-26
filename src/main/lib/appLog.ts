/**
 * Persistent, rotating global application log.
 *
 * The launcher previously had no durable record of what the *app itself*
 * did: `console.*` from the main process went nowhere, and operation output
 * (install / update / migrate / restore) lived only in an in-memory ring
 * buffer that vanished on modal close, app restart, or background runs with
 * no window. The only on-disk log was the per-session `comfyui.log`, which
 * covers the running ComfyUI process, not the app.
 *
 * This module owns a single global `app.log` in Electron's per-user logs
 * dir. It captures:
 *
 *   - main-process `console.*` (patched in `initAppLog`),
 *   - uncaught errors / process-gone events (so the crash cause is durable
 *     even when the process is about to die),
 *   - the full operation output stream (teed from `appendLog`).
 *
 * Everything is ANSI-stripped and run through `scrubAll` before hitting disk
 * so credentials in index URLs and usernames in paths never get persisted.
 *
 * All writes are synchronous against a single append (`O_APPEND`) file
 * descriptor. Synchronous writes mean the crash path (uncaught exception /
 * process-gone) lands on disk before the dying process exits — a buffered
 * stream write would be lost. A single append fd avoids interleaving and
 * lets rotation close/rename/reopen deterministically (important on Windows,
 * where renaming a file with an open handle fails).
 *
 * Writes are no-ops until `initAppLog()` runs, which keeps the module inert
 * in unit tests (and during the brief window before the app is ready) unless
 * a log dir has been wired up.
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
// Carry for the operation-output tee so a credential split across two
// process chunks ("https://user:to" + "ken@host") is still scrubbed: we
// only write (and scrub) whole lines, keeping the partial tail buffered.
let opPending = ''
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
 * Identical to `writeAppLog` — writes are already synchronous — but named so
 * call sites document that the line must survive an imminent process exit.
 */
export function writeAppLogSync(level: string, text: string): void {
  if (!initialized) return
  write(formatLine(level, text))
}

/**
 * Tee operation output (raw, possibly partial process chunks) to disk. Only
 * whole lines are written so cross-chunk secrets are scrubbed intact; the
 * trailing partial line is held until the next chunk completes it.
 */
export function writeOperationOutput(text: string): void {
  if (!initialized || !text) return
  opPending += text
  let nl = opPending.indexOf('\n')
  while (nl !== -1) {
    write(opPending.slice(0, nl + 1))
    opPending = opPending.slice(nl + 1)
    nl = opPending.indexOf('\n')
  }
  if (opPending.length > MAX_PENDING_LINE) {
    write(opPending)
    opPending = ''
  }
}

function formatLine(level: string, text: string): string {
  return `[${new Date().toISOString()}] [${level}] ${text}\n`
}

function write(raw: string): void {
  if (fd === null) return
  const clean = scrubAll(stripAnsi(raw))
  const len = Buffer.byteLength(clean)
  // Rotate before writing so the live file never exceeds the cap mid-write.
  if (currentBytes + len > MAX_BYTES) rotateAppLogSync()
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
  opPending = ''
  initialized = false
  consolePatched = false
}
