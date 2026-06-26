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
 *   - uncaught errors / process-gone events (written synchronously from the
 *     error handlers so the crash cause survives the dying process),
 *   - the full operation output stream (teed from `appendLog`).
 *
 * Everything is ANSI-stripped and run through `scrubAll` before hitting disk
 * so credentials in index URLs and usernames in paths never get persisted.
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

const CONSOLE_LEVELS = ['log', 'info', 'warn', 'error', 'debug'] as const
type ConsoleLevel = (typeof CONSOLE_LEVELS)[number]

let logDir: string | null = null
let stream: fs.WriteStream | null = null
let currentBytes = 0
let initialized = false
let consolePatched = false
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
    rotateAppLogSync()
    stream = openStream()
    currentBytes = 0
  } catch {
    // If we can't open the log, keep going as a no-op rather than crash.
    stream = null
  }
  initialized = true
  patchConsole()
}

/** Buffered append for normal runtime logging. */
export function writeAppLog(level: string, text: string): void {
  if (!initialized) return
  appendAsync(formatLine(level, text))
}

/**
 * Synchronous append for the crash path. A buffered stream write would be
 * lost when an uncaught exception or process-gone event kills the process
 * before the buffer flushes, so the error handlers use this to guarantee
 * the cause reaches disk.
 */
export function writeAppLogSync(level: string, text: string): void {
  if (!initialized) return
  appendSync(formatLine(level, text))
}

/** Tee operation output (already chunked, no per-line framing) to disk. */
export function writeOperationOutput(text: string): void {
  if (!initialized || !text) return
  appendAsync(text)
}

/** Flush buffered (non-sync) writes to disk. Resolves once the stream has
 *  drained everything queued so far. */
export function flushAppLog(): Promise<void> {
  return new Promise((resolve) => {
    if (!stream || stream.writableEnded) {
      resolve()
      return
    }
    stream.write('', () => resolve())
  })
}

/** Open the append stream with an error listener so a transient FS error
 *  (disk full, locked file) is swallowed instead of crashing the app. */
function openStream(): fs.WriteStream {
  const s = fs.createWriteStream(getAppLogPath(), { flags: 'a' })
  s.on('error', () => {})
  return s
}

function formatLine(level: string, text: string): string {
  return `[${new Date().toISOString()}] [${level}] ${text}\n`
}

function appendAsync(raw: string): void {
  const clean = scrubAll(stripAnsi(raw))
  currentBytes += Buffer.byteLength(clean)
  if (stream && !stream.writableEnded) {
    try {
      stream.write(clean)
    } catch {
      // Stream may have torn down; fall back to a synchronous append.
      try {
        fs.appendFileSync(getAppLogPath(), clean)
      } catch {}
    }
  } else {
    try {
      fs.appendFileSync(getAppLogPath(), clean)
    } catch {}
  }
  if (currentBytes > MAX_BYTES) rotateAppLogSync()
}

function appendSync(raw: string): void {
  const clean = scrubAll(stripAnsi(raw))
  try {
    fs.appendFileSync(getAppLogPath(), clean)
  } catch {}
  currentBytes += Buffer.byteLength(clean)
  if (currentBytes > MAX_BYTES) rotateAppLogSync()
}

/**
 * Synchronous rotation: prune the oldest rotated files past the retention
 * cap, rename the live log to a timestamped sibling, and reopen a fresh
 * stream. Synchronous so it stays consistent when called from the crash
 * path or mid-write.
 */
function rotateAppLogSync(): void {
  if (!logDir) return
  try {
    stream?.end()
  } catch {}
  stream = null
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
  try {
    stream = openStream()
  } catch {
    stream = null
  }
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
  try {
    stream?.destroy()
  } catch {}
  stream = null
  logDir = null
  currentBytes = 0
  initialized = false
  consolePatched = false
}
