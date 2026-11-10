import path from 'path'
import fs from 'fs'
import { stateDir } from './paths'
import { isQuitInProgress } from './quit-state'

export type LastActiveSurface = { kind: 'dashboard' } | { kind: 'instance'; installationId: string }

const lastSessionPath = (): string => path.join(stateDir(), 'last-session.json')

let cache: LastActiveSurface | null | undefined
let flushTimer: ReturnType<typeof setTimeout> | null = null

function isSurface(value: unknown): value is LastActiveSurface {
  if (!value || typeof value !== 'object') return false
  const v = value as { kind?: unknown; installationId?: unknown }
  if (v.kind === 'dashboard') return true
  if (v.kind === 'instance')
    return typeof v.installationId === 'string' && v.installationId.length > 0
  return false
}

function load(): LastActiveSurface | null {
  if (cache !== undefined) return cache
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(lastSessionPath(), 'utf-8'))
    cache = isSurface(parsed) ? parsed : null
  } catch {
    cache = null
  }
  return cache
}

function scheduleFlush(): void {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => void flushLastSession(), 250)
}

export async function flushLastSession(): Promise<void> {
  if (cache === undefined) return
  try {
    const p = lastSessionPath()
    await fs.promises.mkdir(path.dirname(p), { recursive: true })
    const data = serialize()
    if (data === null) {
      await fs.promises.rm(p, { force: true })
    } else {
      await fs.promises.writeFile(p, data)
    }
  } catch {}
}

function serialize(): string | null {
  return cache == null ? null : JSON.stringify(cache, null, 2)
}

export function flushLastSessionSync(): void {
  if (cache === undefined) return
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  try {
    const p = lastSessionPath()
    fs.mkdirSync(path.dirname(p), { recursive: true })
    const data = serialize()
    if (data === null) {
      fs.rmSync(p, { force: true })
    } else {
      fs.writeFileSync(p, data)
    }
  } catch {}
}

export function getLastActiveSurface(): LastActiveSurface | null {
  return load()
}

export function recordDashboardSurface(): void {
  if (isQuitInProgress()) return
  const current = load()
  if (current?.kind === 'dashboard') return
  cache = { kind: 'dashboard' }
  scheduleFlush()
}

export function recordInstanceSurface(installationId: string): void {
  if (isQuitInProgress()) return
  const current = load()
  if (current?.kind === 'instance' && current.installationId === installationId) return
  cache = { kind: 'instance', installationId }
  scheduleFlush()
}

export function clearLastActiveSurface(): void {
  if (cache === null) return
  cache = null
  scheduleFlush()
}

export function _resetLastSessionCacheForTest(): void {
  cache = undefined
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
}
