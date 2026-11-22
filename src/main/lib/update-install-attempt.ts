import fs from 'fs'
import path from 'path'
import { configDir } from './paths'
import { readFileWithRetrySync, writeFileSafe } from './safe-file'
import { errorTail } from '../../shared/errorEvent'

export type InstallAttemptSource = 'install_call' | 'startup_install'

export interface InstallAttemptRecord {
  attemptId: string | null
  targetVersion: string
  fromVersion: string
  source: InstallAttemptSource
  triggeredAt: string
  exitedAt?: string
  exitQuitReason?: string
}

export type AppLocationKind =
  'applications' | 'user_applications' | 'translocated' | 'mounted_volume' | 'other'

export interface AppLocation {
  bundlePath: string
  kind: AppLocationKind | null
  writable: boolean
}

export interface ShipItReport {
  logFound: boolean
  ranAfterTrigger: boolean | null
  errorTail: string | null
}

const SHIPIT_TAIL_BYTES = 64 * 1024
const SHIPIT_ERROR_LINES = 5
const SHIPIT_ERROR_MAX_CHARS = 600
const SHIPIT_ERROR_LINE = /error|fail|denied|not permitted|could ?n[o']t|unable|refus/i

function recordPath(): string {
  return path.join(configDir(), 'update-install-attempt.json')
}

function isRecord(value: unknown): value is InstallAttemptRecord {
  if (!value || typeof value !== 'object') return false
  const r = value as Record<string, unknown>
  return (
    typeof r.targetVersion === 'string' &&
    typeof r.fromVersion === 'string' &&
    typeof r.triggeredAt === 'string' &&
    (r.source === 'install_call' || r.source === 'startup_install') &&
    (r.attemptId === null || typeof r.attemptId === 'string')
  )
}

export function writeInstallAttempt(record: InstallAttemptRecord): boolean {
  try {
    writeFileSafe(recordPath(), JSON.stringify(record, null, 2), { durable: true })
    return true
  } catch {
    return false
  }
}

export function readInstallAttempt(): InstallAttemptRecord | null {
  const outcome = readFileWithRetrySync(recordPath())
  if (outcome.kind !== 'data') return null
  try {
    const parsed: unknown = JSON.parse(outcome.data)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function clearInstallAttempt(): void {
  try {
    fs.unlinkSync(recordPath())
  } catch {}
}

export function markInstallAttemptExit(quitReason: string, now: Date = new Date()): void {
  const record = readInstallAttempt()
  if (!record || record.exitedAt) return
  writeInstallAttempt({ ...record, exitedAt: now.toISOString(), exitQuitReason: quitReason })
}

export function appBundlePath(exePath: string, platform: NodeJS.Platform): string {
  if (platform === 'darwin') return path.resolve(exePath, '..', '..', '..')
  return path.dirname(exePath)
}

export function classifyMacAppLocation(bundlePath: string, homeDir: string): AppLocationKind {
  if (bundlePath.includes('/AppTranslocation/')) return 'translocated'
  if (bundlePath.startsWith('/Volumes/')) return 'mounted_volume'
  if (bundlePath.startsWith('/Applications/')) return 'applications'
  if (bundlePath.startsWith(path.join(homeDir, 'Applications') + '/')) return 'user_applications'
  return 'other'
}

function isWritable(target: string): boolean {
  try {
    fs.accessSync(target, fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}

export function describeAppLocation(
  exePath: string,
  platform: NodeJS.Platform,
  homeDir: string
): AppLocation {
  const bundlePath = appBundlePath(exePath, platform)
  return {
    bundlePath,
    kind: platform === 'darwin' ? classifyMacAppLocation(bundlePath, homeDir) : null,
    writable: isWritable(bundlePath) && isWritable(path.dirname(bundlePath))
  }
}

export function readMacBundleId(bundlePath: string): string | null {
  try {
    const plist = fs.readFileSync(path.join(bundlePath, 'Contents', 'Info.plist'), 'utf-8')
    const match = /<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)
    return match?.[1]?.trim() || null
  } catch {
    return null
  }
}

export function shipItLogPath(homeDir: string, bundleId: string): string {
  return path.join(homeDir, 'Library', 'Caches', `${bundleId}.ShipIt`, 'ShipIt_stderr.log')
}

function readTail(filePath: string, size: number): string {
  const fd = fs.openSync(filePath, 'r')
  try {
    const start = Math.max(0, size - SHIPIT_TAIL_BYTES)
    const buffer = Buffer.alloc(size - start)
    fs.readSync(fd, buffer, 0, buffer.length, start)
    return buffer.toString('utf-8')
  } finally {
    fs.closeSync(fd)
  }
}

export function shipItErrorTail(logText: string): string | null {
  const errorLines = logText
    .split(/\r?\n/)
    .filter((line) => SHIPIT_ERROR_LINE.test(line))
    .slice(-SHIPIT_ERROR_LINES)
  return errorTail(errorLines.join('\n'), { maxChars: SHIPIT_ERROR_MAX_CHARS })
}

export function readShipItReport(logPath: string | null, triggeredAt: Date): ShipItReport {
  if (!logPath) return { logFound: false, ranAfterTrigger: null, errorTail: null }
  try {
    const stat = fs.statSync(logPath)
    const ranAfterTrigger = stat.mtimeMs >= triggeredAt.getTime()
    return {
      logFound: true,
      ranAfterTrigger,
      errorTail: ranAfterTrigger ? shipItErrorTail(readTail(logPath, stat.size)) : null
    }
  } catch {
    return { logFound: false, ranAfterTrigger: null, errorTail: null }
  }
}
