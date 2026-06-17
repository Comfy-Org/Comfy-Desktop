/**
 * A/B experiment foundation.
 *
 * Owns the on-disk flag cache, a synchronous `getFlag(key)` accessor,
 * the boot-time background refresh, and the `experiment.exposed` event
 * helper (with per-session dedup).
 *
 * Architecture: every renderer flag query is cache-first via
 * `getFlag()`. The cache lives at `<configDir>/experiment-flags.json`
 * and is refreshed in the background after boot. The current process
 * keeps the variant it loaded synchronously for any already-cached key,
 * but a settled fetch back-fills keys that were ABSENT at boot (so a
 * fresh-boot session isn't stuck on control); the full result also lands
 * on disk for the NEXT boot. This keeps boot fast (no network on the
 * critical path) while still assigning new experiments on first run.
 *
 * The previous in-tree experiment-flag system was deliberately removed
 * (the old `feature-flags.ts` plus a sample-rate dial). This module
 * brings back only the experiment-evaluation subset, not the
 * kill-switch grab-bag.
 *
 * Consent: `loadFeatureFlagsImmediate` is already suppressed unless
 * consent is `'granted'`, so the boot refresh never ships a network
 * call pre-consent. Cached flags from a prior consented session WILL
 * still drive variant assignment if the user later revokes consent —
 * acceptable, because (a) no event ships pre-consent so no analysis
 * happens, and (b) the cache is wiped on the user's next reinstall.
 */
import fs from 'fs'
import path from 'path'
import { configDir } from './paths'
import * as mainTelemetry from './telemetry'
import type { FeatureFlagValue } from './telemetry'

const DEFAULT_TIMEOUT_MS = 1500

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

/**
 * Filter a parsed cache object to only `FeatureFlagValue` entries.
 * The cache file is user-writable JSON on disk — a corrupted entry like
 * `{ "flag.a": 42 }` would otherwise flow through `getFlag()` → exposure
 * events with `variant: 42` and renderer code that branches on
 * `value === 'treatment'` silently picks control. Per-key filter drops
 * the bad entries rather than rejecting the whole cache.
 */
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
  } catch {
    // file missing or unreadable; treat as no cache
  }
  return null
}

function writeCache(flags: Record<string, FeatureFlagValue>): void {
  try {
    fs.mkdirSync(path.dirname(cacheFilePath()), { recursive: true })
    fs.writeFileSync(cacheFilePath(), JSON.stringify(flags))
  } catch {
    // best effort — cache is a perf optimization, not correctness
  }
}

/**
 * Merge a fresh fetch into the in-memory cache for the current session,
 * filling ONLY keys that were absent at boot. Lets a fresh-boot session
 * (empty disk cache) see its real variant instead of defaulting to control,
 * while never flipping a key the process already committed to this boot —
 * so a settled fetch can't change an experiment arm mid-session.
 */
function backfillSessionCache(flags: Record<string, FeatureFlagValue>): void {
  if (!cached) cached = {}
  for (const [key, value] of Object.entries(flags)) {
    if (!(key in cached)) cached[key] = value
  }
}

/**
 * Initialise the experiments module. Synchronously loads the on-disk
 * cache so `getFlag()` is usable immediately, then kicks off a background
 * fetch (does NOT await) that refreshes the on-disk cache for the next boot
 * and back-fills any boot-absent keys into the current session (see
 * `backfillSessionCache`).
 *
 * The returned promise is cached so `getFlagAsync()` can await it — a
 * renderer query landing before the fetch settles then sees the resolved
 * value instead of falling back to control (mirrors `cloudCapacity`).
 *
 * Idempotent within a process.
 */
export function initExperiments(opts: {
  distinctId: string
  personProperties: Record<string, string>
  timeoutMs?: number
}): Promise<void> {
  // Idempotent within a process: repeated calls return the same in-flight
  // promise without re-running the cache load or fetch. The `opts.distinctId`
  // and `opts.personProperties` of subsequent calls are intentionally ignored
  // — identity changes mid-session (e.g. after `bindUserId`) do not
  // re-evaluate experiments. Variant stability for an installation is a
  // property we want; rotating variants when a user logs in would
  // contaminate the experiment population.
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
    .catch(() => {
      /* fail closed: keep current cache on disk and in memory */
    })
  return initPromise
}

/**
 * Synchronous flag accessor. Returns the cached value, or `undefined` if
 * the flag is not present in the cache. Callers should default to the
 * control branch when the result is undefined.
 *
 * Must only be called after `initExperiments` has been invoked at boot
 * (subsequent calls before the background fetch settles return the
 * synchronously-loaded cache values, which is intended).
 */
export function getFlag(key: string): FeatureFlagValue | undefined {
  return cached?.[key]
}

/**
 * Awaitable flag accessor. Awaits the in-flight boot fetch (if any) before
 * reading, so a query landing before the fetch settles sees the resolved
 * value rather than falling back to control. Prefer this from IPC handlers;
 * `getFlag()` stays for hot sync reads. Mirrors `getCloudCapacityStatusAsync`.
 */
export async function getFlagAsync(key: string): Promise<FeatureFlagValue | undefined> {
  if (initPromise) {
    try {
      await initPromise
    } catch {
      /* keep whatever loaded from the on-disk cache */
    }
  }
  return cached?.[key]
}

/**
 * Record an exposure event for a given experiment / variant.
 *
 * Per-session dedup: the same `(experimentKey, variant)` pair fires at
 * most one `comfy.desktop.experiment.exposed` event per process lifetime.
 * Reset on next boot.
 *
 * `source` tells dashboards how the assignment was obtained:
 * - `'cache'` — from the on-disk cache (most common)
 * - `'remote'` — from a fresh fetch (rare, happens if the renderer
 * queries between cache load and refresh)
 * - `'fallback'` — control branch picked because no value was cached
 * AND no fresh value was available (first-ever boot
 * with no network)
 */
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

/** @internal — exposed for tests. */
export function _resetForTest(): void {
  cached = null
  initPromise = null
  exposedThisSession.clear()
}
