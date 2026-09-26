/**
 * Core event-log tap.
 *
 * ComfyUI core logs structured, privacy-safe records next to its
 * human-readable lines, on two tags:
 *
 * - `[assets-event] <event> key=value ...` from the assets system
 *   (`app/assets/event_log.py`), always on. Forwarded as
 *   `comfy.desktop.comfyui.assets.<event>`.
 * - `[comfy-event] <ns>.<event> key=value ...` from `comfy/diagnostics`, only
 *   when the launcher passes the `structured_log_events` feature flag.
 *   Forwarded as `comfy.desktop.comfyui.<ns>.<event>`.
 *
 * We tail that output, already piped through `proc.stdout` / `proc.stderr` in
 * `sessionActions/launch.ts` (the same stream `hardwareTap` and `executionTap`
 * consume) and forward each accepted record through `telemetry.emit`, which is
 * consent-gated and PII-scrubbed centrally.
 *
 * Unlike the hardware tap, which matches known prose, this one parses a single
 * grammar. That makes core's stdout UNTRUSTED INPUT: anything writing to the
 * process's stdout can emit a tagged line, so the tap carries its own closed
 * contract per namespace (`coreEventContracts.ts`): an event allowlist, a
 * field-name allowlist, a safety tier and validator per field, and rejection
 * of any key colliding with the trusted base context. Ordinary unknown fields
 * are omitted for version skew, as is an extensible enum value outside its
 * enum that still has an enum value's shape. Other invalid known values and
 * malformed or spoofing keys drop the whole line silently: reporting the
 * rejection would put the untrusted content back into a signal we forward.
 *
 * THREAT MODEL: this validation catches ACCIDENTAL leakage (a path riding
 * along in a field). It is not a boundary against deliberately encoded
 * exfiltration — the closed vocabulary plus the AST discipline on the core
 * side is the primary guarantee.
 */
import * as telemetry from './telemetry'
import type { TelemetryValue } from './telemetry'
import { createStreamLineBuffer, stripAnsi, stripLogLevelPrefix } from './stderrTail'
import {
  ASSETS_CONTRACT,
  COMFY_EVENT_CONTRACTS,
  ENUM_VALUE,
  isAllowedFieldValue,
  isSafeString
} from './coreEventContracts'
import type { NamespaceContract } from './coreEventContracts'

/**
 * The assets logfmt line grammar. This is a CROSS-REPO CONTRACT: ComfyUI holds
 * the equivalent regex as `EVENT_LINE_PATTERN` in its assets event-log tests,
 * and `__fixtures__/assets-event-lines.txt` is a byte-identical copy of that
 * repo's `tests-unit/assets_test/fixtures/assets_event_lines.txt`. Neither side
 * may change without the other.
 */
export const ASSETS_EVENT_LINE =
  /^\[assets-event\] ([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*)((?: [a-z_]+=[^ =]+)*)$/

/**
 * The core-wide grammar, also a CROSS-REPO CONTRACT with ComfyUI
 * `comfy/diagnostics/events.py`. `__fixtures__/core-event-lines.txt` is a
 * byte-identical copy of that repo's
 * `tests-unit/diagnostics_test/fixtures/core_event_lines.txt`.
 * It differs from the assets grammar in three ways: the tag, an event that is
 * exactly `<ns>.<event>`, and field names that may hold digits (`p95_ms`).
 */
export const COMFY_EVENT_LINE =
  /^\[comfy-event\] ([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)((?: [a-z][a-z0-9_]*=[^ =]+)*)$/

const EVENT_PREFIX = 'comfy.desktop.comfyui.'
const ASSETS_NAMESPACE = 'assets'

/**
 * Cheap first-pass filters on field names, one per grammar. Checked again per
 * pair because the grammar alone would let a crafted tail through a `split`.
 */
const ASSETS_FIELD_NAME = /^[a-z_]+$/
const COMFY_FIELD_NAME = /^[a-z][a-z0-9_]*$/

/**
 * Emitted by the tap itself, never parsed from a line, and never in any
 * namespace's event allowlist, so a crafted log line cannot forge one. Each is
 * per namespace: `comfy.desktop.comfyui.<ns>.<counter>`.
 */
const UNKNOWN_EVENTS_DROPPED = 'unknown_events_dropped'
const UNKNOWN_ENUM_VALUES_OMITTED = 'unknown_enum_values_omitted'
const CARDINALITY_OVERFLOW = 'cardinality_overflow'
/** A `[comfy-event]` line whose namespace this build does not know. Never named. */
const UNKNOWN_NAMESPACE_DROPPED = 'core_event.unknown_namespace_dropped'

/**
 * Distinct values one open-tier field may take per session. Past that, the
 * value is replaced with `overflow`, so PostHog property cardinality stays
 * bounded even if core misbehaves.
 */
const MAX_DISTINCT_VALUES_PER_FIELD = 64
const OVERFLOW_VALUE = 'overflow'

/**
 * Per-event budget on top of the telemetry module's own rate limit, in fixed
 * windows per event name so one chatty event cannot starve the others.
 */
const RATE_WINDOW_MS = 60 * 60_000
/**
 * Novelty keys remembered per event per window. The first line with a new key
 * passes even after the cap is spent, but only this many times, so one event
 * forwards at most `hourlyCap + MAX_NOVEL_KEYS_PER_WINDOW - 1` lines per window
 * (the window's first line always takes a novelty slot or a cap slot).
 */
const MAX_NOVEL_KEYS_PER_WINDOW = 64
/** Each tap-emitted counter spends its own budget, like an event. */
const COUNTER_HOURLY_CAP = 60

interface ParsedLine {
  namespace: string
  contract: NamespaceContract
  event: string
  tail: string
  fieldName: RegExp
}

/** Match either grammar. `null` for anything else; `'unknown-namespace'` is counted. */
function matchLine(line: string): ParsedLine | 'unknown-namespace' | null {
  // Strip ANSI then a leading `[LEVEL] ` tag (Desktop's bundled build) so the
  // anchored grammars match both the prefixed and bare log formats.
  const clean = stripLogLevelPrefix(stripAnsi(line).trim())
  const assets = clean.match(ASSETS_EVENT_LINE)
  if (assets) {
    const [, event, tail] = assets
    if (!event || tail === undefined) return null
    return {
      namespace: ASSETS_NAMESPACE,
      contract: ASSETS_CONTRACT,
      event,
      tail,
      fieldName: ASSETS_FIELD_NAME
    }
  }
  const comfy = clean.match(COMFY_EVENT_LINE)
  if (!comfy) return null
  const [, namespace, event, tail] = comfy
  if (!namespace || !event || tail === undefined) return null
  const contract = COMFY_EVENT_CONTRACTS.get(namespace)
  if (!contract) return 'unknown-namespace'
  return { namespace, contract, event, tail, fieldName: COMFY_FIELD_NAME }
}

/**
 * Parse the logfmt tail into forwardable fields, omitting ordinary unknown
 * fields and unknown-but-well-shaped extensible enum values. Other invalid
 * known values and malformed, duplicate or spoofing keys reject the whole line.
 */
function parseFields(
  { contract, tail, fieldName }: ParsedLine,
  baseKeys: ReadonlySet<string>
): { fields: Record<string, TelemetryValue>; omittedEnumValues: number } | null {
  const fields: Record<string, TelemetryValue> = {}
  let omittedEnumValues = 0
  // Separate from `fields`, which omits some keys, so a repeat is still caught.
  const seenKeys = new Set<string>()
  const pairs = tail ? tail.slice(1).split(' ') : []
  for (const pair of pairs) {
    const separatorIndex = pair.indexOf('=')
    const key = pair.slice(0, separatorIndex)
    const rawValue = pair.slice(separatorIndex + 1)
    if (!fieldName.test(key)) return null
    // A field named like a base-context property would be a context-spoofing
    // attempt, even though the merge order already makes it ineffective.
    if (baseKeys.has(key)) return null
    if (!contract.fields.has(key)) {
      // Prototype keys clear the lowercase field-name filter but are never a
      // plausible core field, so they stay whole-line rejects.
      if (Object.hasOwn(Object.prototype, key)) return null
      // Anything else is a newer core emitting a field this build predates;
      // rejecting the line would delete an existing metric instead.
      continue
    }
    if (seenKeys.has(key)) return null
    seenKeys.add(key)
    const spec = contract.specs.get(key)
    if (!spec) return null
    const value: TelemetryValue =
      spec.tier === 'open' && spec.digitString
        ? rawValue
        : /^-?\d+$/.test(rawValue)
          ? Number(rawValue)
          : rawValue === 'true'
            ? true
            : rawValue === 'false'
              ? false
              : rawValue
    if (
      spec.tier === 'closed' &&
      spec.extensible &&
      spec.values !== 'boolean' &&
      typeof value === 'string' &&
      !spec.values.has(value) &&
      isSafeString(value) &&
      ENUM_VALUE.test(value)
    ) {
      // A newer core's enum value omits just this field, so a new failure
      // reason cannot silently drop the failure events (and their Datadog
      // alerting copies) that carry it.
      omittedEnumValues++
      continue
    }
    if (!isAllowedFieldValue(spec, value)) return null
    fields[key] = value
  }
  return { fields, omittedEnumValues }
}

/**
 * The key novelty-first admission tracks: a failure's classification, or a
 * timing's operation and outcome. `null` for events with neither, which are
 * capped plainly.
 */
function noveltyKey(fields: Readonly<Record<string, TelemetryValue>>): string | null {
  if ('reason' in fields) {
    return JSON.stringify([fields.site ?? null, fields.reason, fields.exc_fp ?? null])
  }
  if ('op' in fields) return JSON.stringify([fields.op, fields.outcome ?? null])
  return null
}

export function createCoreEventTap(opts: {
  installationId: string
  variant?: string | null
  release?: string | null
  coreBetaFlags?: readonly string[]
}): {
  ingest: (chunk: string, source: 'stdout' | 'stderr') => void
  beginBoot: () => void
  flushSummary: () => void
} {
  const baseContext = {
    installation_id: opts.installationId,
    variant: opts.variant ?? null,
    release: opts.release ?? null,
    core_beta_flags: [...(opts.coreBetaFlags ?? [])]
  }
  const baseKeys: ReadonlySet<string> = new Set(Object.keys(baseContext))

  // Keyed by the forwarded name's suffix (`<ns>.<event>`). Deliberately NOT
  // reset by beginBoot: a tap is reused across core restarts within one
  // session, and a restart loop is exactly when the cap earns its keep.
  const rateBuckets = new Map<
    string,
    { windowStart: number; count: number; novelKeys: Set<string> }
  >()

  // Per-session, keyed `<ns>.<field>`. Also survives beginBoot.
  const distinctValues = new Map<string, Set<string>>()

  // Per namespace; flushed by flushSummary.
  const counters = new Map<string, number>()
  const bump = (name: string, by = 1): void => {
    if (by > 0) counters.set(name, (counters.get(name) ?? 0) + by)
  }

  /**
   * Novelty-first: the first line with a given classification in a window
   * always passes, even after the cap is spent, so a new failure class is
   * never starved by a flood of an old one. Repeats (and lines with no novelty
   * key) spend the cap. A novel admission counts toward the cap too.
   */
  function admit(name: string, cap: number, key: string | null): boolean {
    const now = Date.now()
    let bucket = rateBuckets.get(name)
    if (!bucket || now - bucket.windowStart >= RATE_WINDOW_MS) {
      bucket = { windowStart: now, count: 0, novelKeys: new Set() }
      rateBuckets.set(name, bucket)
    }
    if (
      key !== null &&
      !bucket.novelKeys.has(key) &&
      bucket.novelKeys.size < MAX_NOVEL_KEYS_PER_WINDOW
    ) {
      bucket.novelKeys.add(key)
      bucket.count++
      return true
    }
    if (bucket.count >= cap) return false
    bucket.count++
    return true
  }

  /** Replace an open-tier value past the per-field distinct limit with `overflow`. */
  function guardCardinality(
    { namespace, contract }: ParsedLine,
    fields: Record<string, TelemetryValue>
  ): void {
    for (const [key, value] of Object.entries(fields)) {
      if (contract.specs.get(key)?.tier !== 'open' || typeof value !== 'string') continue
      const slot = `${namespace}.${key}`
      let seen = distinctValues.get(slot)
      if (!seen) {
        seen = new Set()
        distinctValues.set(slot, seen)
      }
      if (seen.has(value)) continue
      if (seen.size < MAX_DISTINCT_VALUES_PER_FIELD) {
        seen.add(value)
        continue
      }
      fields[key] = OVERFLOW_VALUE
      bump(`${namespace}.${CARDINALITY_OVERFLOW}`)
    }
  }

  function handleLine(line: string): void {
    const matched = matchLine(line)
    if (matched === null) return
    if (matched === 'unknown-namespace') {
      bump(UNKNOWN_NAMESPACE_DROPPED)
      return
    }
    const { namespace, contract, event } = matched
    if (!contract.events.has(event)) {
      // Counted, never named: the name is untrusted input, so carrying it in a
      // payload would reintroduce the cardinality blow-up the allow-list exists
      // to prevent. A bare count still answers "is this build behind core?".
      bump(`${namespace}.${UNKNOWN_EVENTS_DROPPED}`)
      return
    }
    const parsed = parseFields(matched, baseKeys)
    if (!parsed) return
    const { fields } = parsed
    // Counted like unknown events, and for the same reason: it says this build
    // is behind core's vocabulary without naming the untrusted value.
    bump(`${namespace}.${UNKNOWN_ENUM_VALUES_OMITTED}`, parsed.omittedEnumValues)
    const name = `${namespace}.${event}`
    if (!admit(name, contract.hourlyCap, noveltyKey(fields))) return
    guardCardinality(matched, fields)
    try {
      // Base context merged LAST so parsed fields can never override it.
      telemetry.emit(`${EVENT_PREFIX}${name}`, { ...fields, ...baseContext })
    } catch {
      // ignore - telemetry side effect, and the next line must still parse
    }
  }

  const lineBuffer = createStreamLineBuffer()

  return {
    ingest(chunk: string, source: 'stdout' | 'stderr'): void {
      // Hard guarantee: this runs inside the launch stdout/stderr handler with
      // no enclosing catch. A throw here would break log streaming and boot
      // detection. Telemetry must never break the app.
      try {
        for (const line of lineBuffer.append(source, chunk)) {
          // Per-line isolation: one line that throws must not discard the
          // rest of a chunk that has already been split off the buffer.
          try {
            handleLine(line)
          } catch {
            // ignore - telemetry side effect, not user-visible
          }
        }
      } catch {
        // ignore - telemetry side effect, not user-visible
      }
    },
    /**
     * Drop incomplete lines from the previous (now-dead) process streams. A
     * single launch can restart ComfyUI several times, each reusing this tap.
     * The rate buckets and distinct-value sets deliberately survive.
     */
    beginBoot(): void {
      lineBuffer.reset()
    },
    flushSummary(): void {
      try {
        // Process complete-but-unterminated final lines so a trailing record
        // isn't dropped when the process exits without a newline.
        for (const source of ['stdout', 'stderr'] as const) {
          const pending = lineBuffer.takePending(source)
          // Per-source isolation: a throwing stdout tail must not skip stderr's.
          try {
            if (pending.trim()) handleLine(pending)
          } catch {
            // ignore - telemetry side effect, not user-visible
          }
        }
        for (const [name, count] of counters) {
          if (!admit(name, COUNTER_HOURLY_CAP, null)) continue
          counters.delete(name)
          telemetry.emit(`${EVENT_PREFIX}${name}`, { count, ...baseContext })
        }
      } catch {
        // ignore - telemetry side effect, not user-visible
      }
    }
  }
}
