import fs from 'fs'
import path from 'path'
import { configDir } from './paths'
import * as mainTelemetry from './telemetry'
import type { FeatureFlagValue } from './telemetry'

const DEFAULT_TIMEOUT_MS = 10_000

export type ExperimentExposureSource = 'cache' | 'remote' | 'fallback'

function cacheFilePath(): string {
  return path.join(configDir(), 'experiment-flags.json')
}

let cached: Record<string, FeatureFlagValue> | null = null
let initPromise: Promise<void> | null = null
const exposedThisSession = new Set<string>()

function isFeatureFlagValue(v: unknown): v is FeatureFlagValue {
  return typeof v === 'string' || typeof v === 'boolean'
}

function readCacheSync(): Record<string, FeatureFlagValue> | null {
  try {
    const raw = fs.readFileSync(cacheFilePath(), 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const sanitised: Record<string, FeatureFlagValue> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (isFeatureFlagValue(value)) sanitised[key] = value
    }
    return sanitised
  } catch {}
  return null
}

function writeCache(flags: Record<string, FeatureFlagValue>): void {
  try {
    fs.mkdirSync(path.dirname(cacheFilePath()), { recursive: true })
    fs.writeFileSync(cacheFilePath(), JSON.stringify(flags))
  } catch {}
}

function backfillSessionCache(flags: Record<string, FeatureFlagValue>): void {
  if (!cached) cached = {}
  for (const [key, value] of Object.entries(flags)) {
    if (!(key in cached)) cached[key] = value
  }
}

export function initExperiments(opts: {
  distinctId: string
  personProperties: Record<string, string>
  timeoutMs?: number
}): Promise<void> {
  if (initPromise) return initPromise
  cached = readCacheSync() ?? {}
  initPromise = mainTelemetry
    .loadFeatureFlagsImmediate(
      opts.distinctId,
      opts.personProperties,
      opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
    )
    .then((flags) => {
      if (Object.keys(flags).length === 0) return
      writeCache(flags)
      backfillSessionCache(flags)
    })
    .catch(() => {})
  return initPromise
}

export function getFlag(key: string): FeatureFlagValue | undefined {
  return cached?.[key]
}

export async function getFlagAsync(key: string): Promise<FeatureFlagValue | undefined> {
  if (initPromise) {
    try {
      await initPromise
    } catch {}
  }
  return cached?.[key]
}

export function recordExposure(
  experimentKey: string,
  variant: string,
  source: ExperimentExposureSource
): void {
  const dedupKey = `${experimentKey}:${variant}`
  if (exposedThisSession.has(dedupKey)) return
  exposedThisSession.add(dedupKey)
  mainTelemetry.capture('comfy.desktop.experiment.exposed', {
    experiment_key: experimentKey,
    variant,
    source
  })
}

export function _resetForTest(): void {
  cached = null
  initPromise = null
  exposedThisSession.clear()
}
