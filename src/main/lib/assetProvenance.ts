import fs from 'fs/promises'
import type { Stats } from 'fs'
import path from 'path'
import { outputFilesOf } from '../apps/localCalls'
import { createLocalRelay } from '../apps/localRelay'
import { stateDir } from './paths'
import { readFileSafeAsync, writeFileSafeAsync } from './safe-file'

interface Origin {
  installationId: string | null
  size: number
  mtimeMs: number
  ctimeMs: number
}

type FileVersion = Pick<Stats, 'size' | 'mtimeMs' | 'ctimeMs'>

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isOrigin(value: unknown): value is Origin {
  return (
    isRecord(value) &&
    (typeof value.installationId === 'string' || value.installationId === null) &&
    ['size', 'mtimeMs', 'ctimeMs'].every(
      (key) => typeof value[key] === 'number' && Number.isFinite(value[key])
    )
  )
}

function sameVersion(origin: Origin, file: FileVersion): boolean {
  return (
    origin.size === file.size && origin.mtimeMs === file.mtimeMs && origin.ctimeMs === file.ctimeMs
  )
}

function executionWindow(entry: unknown): { start: number; end: number } | null {
  if (!isRecord(entry) || !isRecord(entry.status) || !Array.isArray(entry.status.messages))
    return null
  let start: number | undefined
  let end: number | undefined
  for (const message of entry.status.messages) {
    if (!Array.isArray(message) || !isRecord(message[1])) continue
    const timestamp = message[1].timestamp
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) continue
    if (message[0] === 'execution_start') start = timestamp
    if (['execution_success', 'execution_error', 'execution_interrupted'].includes(message[0]))
      end = timestamp
  }
  return start !== undefined && end !== undefined && start <= end ? { start, end } : null
}

function outputPath(root: string, filename: string, subfolder: string): string | null {
  if ([filename, subfolder].some((part) => part.includes('\0'))) return null
  if (
    [filename, subfolder].some((part) => path.posix.isAbsolute(part) || path.win32.isAbsolute(part))
  )
    return null
  const parts = [subfolder, filename].flatMap((part) => part.split(/[\\/]/))
  if (parts.includes('..')) return null
  const file = path.resolve(root, ...parts)
  return insideRoot(file, root) ? file : null
}

function insideRoot(file: string, root: string): boolean {
  const relative = path.relative(root, file)
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  )
}

export function createAssetProvenanceStore(filePath: string) {
  const origins = new Map<string, Origin>()
  let loaded: Promise<void> | undefined
  let writing: Promise<void> = Promise.resolve()
  let dirty = false

  function load(): Promise<void> {
    loaded ??= (async () => {
      const result = await readFileSafeAsync(filePath)
      if (result.kind !== 'data') return
      try {
        const saved: unknown = JSON.parse(result.data)
        if (!isRecord(saved) || saved.version !== 1 || !isRecord(saved.files)) return
        for (const [file, origin] of Object.entries(saved.files))
          if (path.isAbsolute(file) && isOrigin(origin)) origins.set(file, origin)
      } catch {}
    })()
    return loaded
  }

  async function record(installationId: string, root: string, history: unknown): Promise<void> {
    await load()
    const realRoot = await fs.realpath(root).catch(() => null)
    if (!realRoot || !isRecord(history)) return
    for (const entry of Object.values(history)) {
      const window = executionWindow(entry)
      if (!window) continue
      for (const output of outputFilesOf(entry)) {
        if (output.type !== 'output') continue
        const file = outputPath(realRoot, output.filename, output.subfolder)
        if (!file) continue
        const real = await fs.realpath(file).catch(() => null)
        if (!real || !insideRoot(real, realRoot)) continue
        const stat = await fs.stat(real).catch(() => null)
        if (!stat?.isFile() || stat.mtimeMs < window.start || stat.mtimeMs >= window.end + 1)
          continue
        const previous = origins.get(real)
        const owner =
          previous && sameVersion(previous, stat) && previous.installationId !== installationId
            ? null
            : installationId
        const origin: Origin = {
          installationId: owner,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          ctimeMs: stat.ctimeMs
        }
        if (previous && sameVersion(previous, origin) && previous.installationId === owner) continue
        origins.set(real, origin)
        dirty = true
      }
    }
    if (dirty) {
      await writeFileSafeAsync(
        filePath,
        JSON.stringify({ version: 1, files: Object.fromEntries(origins) })
      )
      dirty = false
    }
  }

  return {
    recordHistory(installationId: string, root: string, history: unknown): Promise<void> {
      const next = writing.then(() => record(installationId, root, history))
      writing = next.catch(() => {})
      return next
    },
    async ready(): Promise<void> {
      await load()
      await writing
    },
    originFor(file: string, version: FileVersion): string | null {
      const origin = origins.get(file)
      return origin && sameVersion(origin, version) ? origin.installationId : null
    }
  }
}

let store: ReturnType<typeof createAssetProvenanceStore> | undefined

export function assetProvenanceStore(): ReturnType<typeof createAssetProvenanceStore> {
  store ??= createAssetProvenanceStore(path.join(stateDir(), 'asset-provenance.json'))
  return store
}

export function trackAssetProvenance(installationId: string, root: string, port: number) {
  let stopped = false
  let pending: Promise<void> | undefined
  let requested = false
  const capturedRuns = new Set<string>()
  const controller = new AbortController()

  async function readHistory(): Promise<void> {
    do {
      requested = false
      try {
        const response = await fetch(`http://127.0.0.1:${port}/history?max_items=1000`, {
          redirect: 'error',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)])
        })
        if (response.ok && !stopped) {
          const history: unknown = await response.json()
          if (!isRecord(history)) continue
          const unseen = Object.fromEntries(
            Object.entries(history).filter(([id]) => !capturedRuns.has(id))
          )
          await assetProvenanceStore().recordHistory(installationId, root, unseen)
          capturedRuns.clear()
          for (const id of Object.keys(history)) capturedRuns.add(id)
        }
      } catch {}
    } while (requested && !stopped)
  }

  function sync(): Promise<void> {
    if (stopped) return Promise.resolve()
    requested = true
    pending ??= readHistory().finally(() => (pending = undefined))
    return pending
  }

  const relay = createLocalRelay((message) => {
    if (isRecord(message) && message.type === 'status') void sync()
  })
  relay.follow(port)
  void sync()

  return {
    sync,
    stop(): void {
      stopped = true
      controller.abort()
      relay.stop()
    }
  }
}
