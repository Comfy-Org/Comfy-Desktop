import fs from 'fs'
import path from 'path'
import { format } from 'node:util'
import { app } from 'electron'
import { stripAnsi } from './stderrTail'
import { scrubAll } from '../../shared/piiScrub'

const BASE_NAME = 'app.log'
const MAX_BYTES = 5 * 1024 * 1024
const MAX_FILES = 50
const ROTATED_RE = /^app\.log_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.log$/
const MAX_PENDING_LINE = 64 * 1024

const CONSOLE_LEVELS = ['log', 'info', 'warn', 'error', 'debug'] as const
type ConsoleLevel = (typeof CONSOLE_LEVELS)[number]

let logDir: string | null = null
let fd: number | null = null
let currentBytes = 0
let initialized = false
let consolePatched = false
const opPendingById = new Map<string, string>()
const originalConsole = new Map<ConsoleLevel, (...args: unknown[]) => void>()

export function getAppLogDir(): string {
  return logDir ?? app.getPath('logs')
}

export function getAppLogPath(): string {
  return path.join(getAppLogDir(), BASE_NAME)
}

export function initAppLog(opts?: { dir?: string }): void {
  if (initialized) return
  logDir = opts?.dir ?? app.getPath('logs')
  try {
    fs.mkdirSync(logDir, { recursive: true })
    rotateAppLogSync()
  } catch {
    closeFd()
  }
  initialized = true
  patchConsole()
}

export function writeAppLog(level: string, text: string): void {
  if (!initialized) return
  write(formatLine(level, text))
}

export function writeAppLogSync(level: string, text: string): void {
  if (!initialized) return
  write(formatLine(level, text), { rotate: false })
}

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
  if (opts?.rotate !== false && currentBytes + len > MAX_BYTES) rotateAppLogSync()
  if (fd === null) return
  try {
    fs.writeSync(fd, clean)
    currentBytes += len
  } catch {}
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
