import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { inspect } from 'util'
import { configDir } from './paths'
import { readFileSafe, writeFileSafe } from './safe-file'
import * as mainTelemetry from './telemetry'
import type { FeatureFlagValue, OpsFlagFetchResult } from './telemetry'

type OpsFlagValueResult = Extract<OpsFlagFetchResult, { kind: 'value' }>

const DEFAULT_TIMEOUT_MS = 2000

export const OPS_FLAGS_FILE = 'ops-flags.json'

function persistFilePath(file: string): string {
  return path.join(configDir(), file)
}

interface PersistedFileRead {
  entries: Record<string, unknown>
  primaryUnreadable: boolean
}

let e2eSeedApplied = false
function maybeSeedFromEnv(): void {
  if (e2eSeedApplied) return
  e2eSeedApplied = true
  if (process.env['E2E'] !== '1') return
  const seed = process.env['E2E_OPS_FLAGS_SEED']
  if (!seed) return
  delete process.env['E2E_OPS_FLAGS_SEED']
  try {
    if (app.isPackaged) return
    JSON.parse(seed)
    const filePath = persistFilePath(OPS_FLAGS_FILE)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    writeFileSafe(filePath + '.bak', seed)
    writeFileSafe(filePath, seed)
  } catch (err) {
    console.warn('OpsFlag: failed to apply E2E_OPS_FLAGS_SEED:', (err as Error).message)
  }
}

function parseEntries(data: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(data)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

export function readPersistedFile(file: string, strict = false): PersistedFileRead {
  if (file === OPS_FLAGS_FILE) maybeSeedFromEnv()
  const outcome = readFileSafe(persistFilePath(file))
  if (outcome.kind === 'unreadable') return { entries: {}, primaryUnreadable: true }
  if (outcome.kind !== 'data') return { entries: {}, primaryUnreadable: false }

  const primaryUnreadable = outcome.primaryUnreadable === true
  const entries = parseEntries(outcome.data)
  if (entries !== null || !strict) return { entries: entries ?? {}, primaryUnreadable }
  const filePath = persistFilePath(file)
  const bak = readFileSafe(filePath + '.bak', { restore: false })
  const fromBak = bak.kind === 'data' ? parseEntries(bak.data) : null
  if (fromBak === null || primaryUnreadable)
    return { entries: fromBak ?? {}, primaryUnreadable: true }
  try {
    fs.copyFileSync(filePath + '.bak', filePath)
    return { entries: fromBak, primaryUnreadable: false }
  } catch {
    return { entries: fromBak, primaryUnreadable: true }
  }
}

function readPersistedFileForWrite(file: string, strict = false): Record<string, unknown> {
  const { entries, primaryUnreadable } = readPersistedFile(file, strict)
  if (primaryUnreadable) {
    throw new Error(
      `${file} exists but its entries cannot be recovered right now; refusing to modify it`
    )
  }
  return entries
}

interface PersistedOpsFlagEntry {
  value: FeatureFlagValue
  payload: unknown
}

export function readPersistedResult(
  file: string,
  key: string
): (PersistedOpsFlagEntry & { fetchedAt?: number }) | undefined {
  const entry = readPersistedFile(file).entries[key]
  if (!entry || typeof entry !== 'object') return undefined
  const { value, payload, fetchedAt } = entry as {
    value?: unknown
    payload?: unknown
    fetchedAt?: unknown
  }
  if (typeof value !== 'string' && typeof value !== 'boolean') return undefined
  return { value, payload, ...(typeof fetchedAt === 'number' && { fetchedAt }) }
}

function writePersistedResult(file: string, key: string, entry: PersistedOpsFlagEntry): void {
  writePersistedEntry(file, key, { ...entry, fetchedAt: Date.now() })
}

export function writePersistedEntry(
  file: string,
  key: string,
  entry: unknown,
  strict = false
): void {
  const all = readPersistedFileForWrite(file, strict)
  all[key] = entry
  const contents = JSON.stringify(all)
  const filePath = persistFilePath(file)
  writeFileSafe(filePath + '.bak', contents)
  writeFileSafe(filePath, contents)
}

export interface OpsFlag<T> {
  init(opts: { distinctId: string; timeoutMs?: number }): Promise<void>
  get(): Promise<T>
  refresh(): Promise<void>
  _resetForTest(): void
}

export function makeOpsFlag<T>(opts: {
  key: string
  fallback: T
  parse: (
    value: FeatureFlagValue | undefined,
    payload: unknown,
    fetchedAt?: number
  ) => T | undefined
  logLabel?: string
  timeoutMs?: number
  persist?: true
  persistFile?: string
}): OpsFlag<T> {
  const { key, fallback, parse, logLabel, timeoutMs, persist } = opts
  const persistFile = opts.persistFile ?? OPS_FLAGS_FILE
  let cached: T = fallback
  let initPromise: Promise<void> | null = null
  let generation = 0
  let fetchSeq = 0
  let initOpts: { distinctId: string; timeoutMs?: number } | null = null
  let refreshPromise: Promise<void> | null = null

  function readPersisted(): T | undefined {
    if (!persist) return undefined
    const stored = readPersistedResult(persistFile, key)
    return stored && parse(stored.value, stored.payload, stored.fetchedAt)
  }

  function persistLate(generationAtInit: number, seq: number, result: OpsFlagValueResult): void {
    if (generationAtInit !== generation || seq !== fetchSeq) return
    const parsed = parse(result.value, result.payload, Date.now())
    if (parsed !== undefined) cached = parsed
    if (logLabel) console.log(`[${logLabel}] late: fetched=`, result.value)
    try {
      writePersistedResult(persistFile, key, { value: result.value, payload: result.payload })
    } catch (err) {
      if (logLabel) console.log(`[${logLabel}] late persist error:`, err)
    }
  }

  function fetchAndApply(
    fetchOpts: { distinctId: string; timeoutMs?: number },
    fallbackOnUnreachable: boolean,
    tag: 'init' | 'refresh'
  ): Promise<void> {
    const generationAtInit = generation
    const seq = ++fetchSeq
    return mainTelemetry
      .getOpsFlagResult(
        key,
        fetchOpts.distinctId,
        fetchOpts.timeoutMs ?? timeoutMs ?? DEFAULT_TIMEOUT_MS,
        persist ? (late) => persistLate(generationAtInit, seq, late) : undefined
      )
      .then((result) => {
        if (generationAtInit !== generation) return
        if (seq !== fetchSeq) return
        if (result.kind === 'unreachable') {
          const parsed = fallbackOnUnreachable ? parse(undefined, undefined) : undefined
          if (parsed !== undefined) cached = parsed
        } else {
          const parsed = parse(result.value, result.payload, Date.now())
          if (parsed !== undefined) cached = parsed
          if (persist) {
            try {
              writePersistedResult(persistFile, key, {
                value: result.value,
                payload: result.payload
              })
            } catch (err) {
              if (logLabel) console.log(`[${logLabel}] persist error:`, err)
            }
          }
        }

        if (logLabel)
          console.log(
            `[${logLabel}] ${tag}: fetched=`,
            result.kind === 'value' ? result.value : result.kind,
            '→ cached=',
            inspect(cached, { depth: null, breakLength: Infinity, compact: true })
          )
      })
      .catch((err) => {
        if (logLabel) console.log(`[${logLabel}] ${tag} error:`, err)
      })
  }

  return {
    init(bootOpts) {
      if (initPromise) return initPromise
      initOpts = bootOpts
      const saved = readPersisted()
      if (saved !== undefined) cached = saved
      const fetched = fetchAndApply(bootOpts, saved === undefined, 'init')
      initPromise = saved !== undefined ? Promise.resolve() : fetched
      return initPromise
    },
    refresh() {
      if (!initOpts) return Promise.resolve()
      refreshPromise = fetchAndApply(initOpts, false, 'refresh')
      return refreshPromise
    },
    async get() {
      if (initPromise) {
        try {
          await initPromise
        } catch {}
      }
      for (let awaited = refreshPromise; awaited; awaited = refreshPromise) {
        await awaited
        if (awaited === refreshPromise) break
      }
      return cached
    },
    _resetForTest() {
      cached = fallback
      initPromise = null
      initOpts = null
      refreshPromise = null
      generation += 1
    }
  }
}
