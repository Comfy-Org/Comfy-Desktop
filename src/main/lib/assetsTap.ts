/**
 * Assets event-log tap.
 *
 * ComfyUI's assets system logs structured, privacy-safe records next to its
 * human-readable lines: `[assets-event] <event> key=value ...` on the INFO
 * channel (`app/assets/event_log.py`). Each accepted record is forwarded as
 * `comfy.desktop.comfyui.assets.<event>`. The parsing, validation order, rate
 * cap and no-throw contract live in `eventLogTap`; this module holds the
 * assets vocabulary, which on the core side sits behind an AST discipline.
 */
import type { TelemetryValue } from './telemetry'
import { createEventLogTap, isSafeString } from './eventLogTap'
import type { EventLogTap, EventLogTapOptions } from './eventLogTap'

/**
 * The logfmt line grammar. This is a CROSS-REPO CONTRACT: ComfyUI holds the
 * equivalent regex as `EVENT_LINE_PATTERN` in its assets event-log tests, and
 * `__fixtures__/assets-event-lines.txt` is a byte-identical copy of that repo's
 * `tests-unit/assets_test/fixtures/assets_event_lines.txt`. Neither side may
 * change without the other.
 */
export const ASSETS_EVENT_LINE =
  /^\[assets-event\] ([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*)((?: [a-z_]+=[^ =]+)*)$/

/**
 * Every event name the core call sites emit. An event outside this set is
 * dropped even if it parses, so a future core release cannot start sending
 * events this build has never reviewed.
 */
export const ALLOWED_EVENTS: ReadonlySet<string> = new Set([
  'assets.enabled',
  'seeder.scan_started',
  'seeder.scan_completed',
  'seeder.scan_failed',
  'seeder.scan_cancelled',
  'seeder.marked_missing',
  'seeder.batch_insert_failed',
  'scanner.hash_failed',
  'scanner.enrich_failed',
  'scanner.hash_discarded_modified',
  'scanner.fast_scan_failed',
  'scanner.temp_sync_failed',
  'scanner.mark_missing_failed',
  'scanner.stat_failed'
])

const ROOTS: ReadonlySet<string> = new Set(['models', 'input', 'output', 'user', 'temp'])
const PHASES: ReadonlySet<string> = new Set(['fast', 'enrich', 'full'])
const STAGES: ReadonlySet<string> = new Set([
  'mark_missing',
  'pruning',
  'fast_scan',
  'enrich',
  'finalize'
])
const STAT_SITES: ReadonlySet<string> = new Set(['discovery', 'enrich'])
const INTEGER_FIELDS: ReadonlySet<string> = new Set([
  'elapsed_ms',
  'created',
  'enriched',
  'skipped',
  'hash_failed',
  'enrich_failed',
  'permission_denied',
  'count'
])

/**
 * Mirror of the field names in ComfyUI `app/assets/event_log.py`. Adding a field
 * is a reviewed change on BOTH sides; the vocabulary deliberately holds no
 * file names, paths, asset ids or content hashes.
 */
export const ALLOWED_FIELD_NAMES: ReadonlySet<string> = new Set([
  'root',
  'phase',
  'stage',
  'site',
  'elapsed_ms',
  'created',
  'enriched',
  'skipped',
  'hash_failed',
  'enrich_failed',
  'permission_denied',
  'count',
  'error_type',
  'hashing_enabled'
])

/**
 * Mirror of each field validator in ComfyUI `app/assets/event_log.py`, plus
 * JavaScript's exact transport restriction for integers. Core's integers are
 * signed, but values outside Number's safe range would be silently rounded
 * before telemetry emission, so reject those in addition to Core validation.
 */
function isAllowedFieldValue(key: string, value: unknown): value is TelemetryValue {
  if (INTEGER_FIELDS.has(key)) return typeof value === 'number' && Number.isSafeInteger(value)
  if (key === 'hashing_enabled') return typeof value === 'boolean'
  if (key === 'error_type') return isSafeString(value)
  if (typeof value !== 'string') return false
  if (key === 'root') return ROOTS.has(value)
  if (key === 'phase') return PHASES.has(value)
  if (key === 'stage') return STAGES.has(value)
  if (key === 'site') return STAT_SITES.has(value)
  return false
}

export function createAssetsTap(opts: EventLogTapOptions): EventLogTap {
  return createEventLogTap(
    {
      linePattern: ASSETS_EVENT_LINE,
      eventPrefix: 'comfy.desktop.comfyui.assets.',
      allowedEvents: ALLOWED_EVENTS,
      allowedFieldNames: ALLOWED_FIELD_NAMES,
      isAllowedFieldValue
    },
    opts
  )
}
