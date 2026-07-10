/**
 * Standard error/failure event fields, shared by main + renderer.
 *
 * Every telemetry event that represents a failure carries the SAME four
 * fields so millions of opaque failures become groupable, actionable
 * diagnostics. Build them once here and spread the result at the emit site:
 *
 *   telemetry.emit('comfy.desktop.<area>.error', {
 *     ...baseContext,
 *     ...buildErrorFields(err),
 *   })
 *
 * The four fields:
 *
 *   - `error_class`     Stable, LOCALE-INDEPENDENT type identifier for
 *                       grouping (e.g. `ModuleNotFoundError`, `CUDAError`).
 *                       Derived from the exception class name / a fixed
 *                       English signature dictionary — never from a
 *                       localized OS string, so the same failure groups on
 *                       a Chinese and an English machine alike.
 *   - `error_message`   Human-readable message, PII-scrubbed and capped.
 *   - `error_bucket`    Existing coarse classification (see errorBucket.ts).
 *   - `error_signature` Normalized, PII-stripped key derived from the
 *                       message (paths / ids / numbers redacted) prefixed
 *                       with `error_class`, so the same error groups
 *                       regardless of user-specific paths or values.
 *
 * Process-boot failures also carry `error_tail` (the last N lines of
 * stderr, where tracebacks and the fatal line live) — see `errorTail`.
 *
 * Lives in `src/shared/` (no Electron / Node / DOM deps) so both main and
 * renderer classify identically. Adding a rule here updates every failure
 * event at once.
 */
import { bucketError, type ErrorBucket } from './errorBucket'
import { scrubAll } from './piiScrub'

/** Human-readable message cap (~2 KB). */
export const ERROR_MESSAGE_MAX = 2048
/** Normalized signature cap. */
export const ERROR_SIGNATURE_MAX = 200
/** stderr tail cap: last N lines (tracebacks + fatal line live at the tail). */
export const ERROR_TAIL_LINES = 40
/** stderr tail hard character cap (~4 KB) as a belt-and-braces bound. */
export const ERROR_TAIL_MAX = 4096

export interface ErrorFields {
  error_class: string
  error_message: string
  error_bucket: ErrorBucket
  error_signature: string
}

/**
 * Final exception line of a Python traceback, e.g.
 * `ModuleNotFoundError: No module named 'torch'`. Anchored so the class is
 * the leading token. Matches the shape `executionTap` uses.
 */
const EXCEPTION_LINE = /^([A-Za-z_][A-Za-z0-9_.]*(?:Error|Exception|Warning|Interrupt))\b\s*:?/

/**
 * Fixed, English, locale-independent signatures that are NOT a Python class
 * name but are stable enough to group on. Order matters: more specific first.
 * Keys are lowercased substrings; the value is the canonical `error_class`.
 */
const SIGNATURE_CLASSES: [needle: string, className: string][] = [
  ['no kernel image is available', 'CUDANoKernelImage'],
  ['no cuda-capable device', 'CUDANoDevice'],
  ['cuda out of memory', 'CUDAOutOfMemory'],
  ['out of memory', 'OutOfMemory'],
  ['device-side assert', 'CUDADeviceAssert'],
  ['cuda error', 'CUDAError'],
  ['cuda runtime error', 'CUDAError'],
  ['cuda not available', 'CUDANotAvailable'],
]

function messageOf(input: unknown): string {
  if (input instanceof Error) return input.message || input.name || ''
  if (typeof input === 'string') return input
  if (input == null) return ''
  return String(input)
}

/**
 * The final Python exception line in a (possibly multi-line) text, e.g.
 * `ModuleNotFoundError: No module named 'torch'`. Scans line by line and
 * returns the LAST match — the final exception of a chained traceback is the
 * user-facing one. `null` when the text has no exception line (a plain JS
 * error message, a launch string, etc.).
 */
function findExceptionLine(text: string): string | null {
  let found: string | null = null
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (EXCEPTION_LINE.test(line)) found = line
  }
  return found
}

/**
 * Extract a locale-independent `error_class`. Priority:
 *   1. A Python exception class token anywhere in the text (last match wins —
 *      the final exception in a chained traceback is the user-facing one).
 *   2. A fixed English signature (CUDA / OOM) that isn't a class name.
 *   3. A meaningful JS `Error.name` (not the generic `Error`).
 *   4. `unknown`.
 *
 * Intentionally does NOT fall back to the localized message text, so the
 * same failure groups across locales.
 */
export function extractErrorClass(input: unknown): string {
  const text = messageOf(input)

  // (1) Python exception class from the final exception line.
  const exceptionLine = findExceptionLine(text)
  if (exceptionLine) {
    const m = exceptionLine.match(EXCEPTION_LINE)
    if (m) return m[1]!
  }

  // (2) Fixed English signatures.
  const lower = text.toLowerCase()
  for (const [needle, className] of SIGNATURE_CLASSES) {
    if (lower.includes(needle)) return className
  }

  // (3) Meaningful JS Error subclass name.
  if (input instanceof Error && input.name && input.name !== 'Error') {
    return input.name
  }

  return 'unknown'
}

/**
 * Normalize a message into a stable grouping key: lowercase, strip
 * user-specific values (paths, quoted strings, uuids, hex, numbers), collapse
 * whitespace. The input is already PII-scrubbed by `buildErrorFields`, so this
 * is purely about grouping stability. Prefixed with `error_class` by
 * `buildErrorFields` so the final signature is `class + shape`.
 */
export function normalizeSignature(message: string): string {
  return (
    message
      .toLowerCase()
      // Quoted strings collapse first so their contents don't leak into the
      // other rules (e.g. a quoted path or number).
      .replace(/'[^']*'/g, '<str>')
      .replace(/"[^"]*"/g, '<str>')
      // File paths (windows drive or unix, at least one separator).
      .replace(/(?:[a-z]:)?(?:[\\/][^\s'":<>|?*]+)+/gi, '<path>')
      // UUIDs.
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>')
      // Hex / pointers.
      .replace(/0x[0-9a-f]+/g, '0x#')
      // Bare numbers (versions, ports, sizes, line numbers).
      .replace(/\d+/g, '#')
      // Collapse whitespace.
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, ERROR_SIGNATURE_MAX)
  )
}

/**
 * Build the standard `{ error_class, error_message, error_bucket,
 * error_signature }` fields from any error input (an `Error`, a string, or
 * unknown). PII is scrubbed from `error_message`; `error_bucket` runs on the
 * RAW text (its regexes want the un-redacted string), while the wire-bound
 * message is scrubbed and capped.
 */
export function buildErrorFields(
  input: unknown,
  opts: { messageCap?: number; errorClass?: string } = {}
): ErrorFields {
  const raw = messageOf(input)
  const messageCap = opts.messageCap ?? ERROR_MESSAGE_MAX
  // A caller that has already classified the failure (e.g. a parser that knows
  // this is `validation_failed`) can pin the class; otherwise derive it.
  const errorClass = opts.errorClass ?? extractErrorClass(input)
  // Prefer the final exception line as the human-readable message: for a
  // multi-line traceback (e.g. a boot stderr tail) the fatal line is the
  // signal, not the node-load noise that precedes it. Fall back to the raw
  // text for plain errors that have no traceback shape.
  const primary = findExceptionLine(raw) ?? raw
  const scrubbedMessage = scrubAll(primary).slice(0, messageCap)
  return {
    error_class: errorClass,
    error_message: scrubbedMessage,
    // Bucket on raw text: its patterns don't care about user paths and would
    // otherwise miss matches hidden inside a `[REDACTED]` substitution.
    error_bucket: bucketError(raw),
    error_signature: `${errorClass}|${normalizeSignature(scrubbedMessage)}`,
  }
}

/**
 * The last N lines of stderr, PII-scrubbed and length-capped, for
 * process-boot failures. Prefers the TAIL (where tracebacks and the fatal
 * error print) over the head (dominated by node-load noise). Returns `null`
 * for empty input so the field is explicitly absent rather than `''`.
 */
export function errorTail(
  stderr: string | null | undefined,
  opts: { lines?: number; maxChars?: number } = {}
): string | null {
  if (!stderr) return null
  const lines = opts.lines ?? ERROR_TAIL_LINES
  const maxChars = opts.maxChars ?? ERROR_TAIL_MAX
  const scrubbed = scrubAll(stderr)
  const tail = scrubbed.split('\n').slice(-lines).join('\n')
  const bounded = tail.length > maxChars ? tail.slice(-maxChars) : tail
  const trimmed = bounded.trim()
  return trimmed.length > 0 ? trimmed : null
}
