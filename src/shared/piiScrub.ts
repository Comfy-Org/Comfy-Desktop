/**
 * Best-effort PII and secret scrubbing for telemetry payloads.
 *
 * Strips usernames out of Windows / macOS / Linux home directory paths and
 * redacts well-known credential shapes (Bearer tokens, OpenAI / Hugging Face
 * keys, basic-auth in URLs, `*KEY=…` / `*SECRET=…` env-style assignments) so
 * tracebacks and error messages can be safely forwarded to Datadog and
 * PostHog.
 *
 * Centralized so that every telemetry / off-box forwarder — the
 * main-process `forwardDatadogError`, the `executionTap` traceback emitter,
 * and the renderer-side `scrubTelemetryContext` safety net — applies
 * identical rules. Adding a pattern here updates every call site at once.
 *
 * Not applied to logs displayed locally to the user (e.g. the crashed-state
 * lifecycle view or the console modal) — those need to be readable for
 * debugging and never leave the user's machine.
 *
 * Lives in `src/shared/` because both main and renderer import it; the
 * file has no runtime dependencies on Electron, Node, or the DOM so it
 * is safe to bundle into either side.
 */

const PII_PATH_PATTERNS: RegExp[] = [
  /([A-Za-z]:[\\/]Users[\\/])[^\\/]+?(?=[\\/]|$)/gi,
  /(\\\\(?:wsl\$|wsl\.localhost)[\\/][^\\/]+[\\/]home[\\/])[^\\/]+?(?=[\\/]|$)/gi,
  /(\\\\[^\\/]+[\\/](?:Users|home)[\\/])[^\\/]+?(?=[\\/]|$)/gi,
  /(\/Users\/)[^\\/]+?(?=\/|$)/gi,
  /(\/home\/)[^\\/]+?(?=\/|$)/gi,
  /(\/mnt\/wsl\/[^/]+\/home\/)[^/]+?(?=\/|$)/gi
]

const SECRET_REPLACEMENTS: [RegExp, string | ((...args: string[]) => string)][] = [
  [/sk-[A-Za-z0-9_-]{20,}/g, '[REDACTED]'],
  [/hf_[A-Za-z0-9]{20,}/g, '[REDACTED]'],
  [/(Authorization\s*[:=]\s*(?:Basic|Bearer|token)\s+)[^\s,;]+/gi, '$1[REDACTED]'],
  [/(?:github_pat_|ghp_|glpat-|npm_)[A-Za-z0-9_-]{12,}/g, '[REDACTED]'],
  [/Bearer\s+[A-Za-z0-9._\-/+]{12,}/g, 'Bearer [REDACTED]'],
  [/\/\/[^\s@/]*:[^\s@/]*@/g, '//[REDACTED]@'],
  [
    /(["']?\b(?:[a-z0-9_-]+[_-])?(?:api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|passwd)\b["']?\s*[:=]\s*)(?!\[REDACTED\])(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;\]}]+)/gi,
    '$1[REDACTED]'
  ],
  [
    /([?&](?:api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|passwd)=)[^&#\s]*/gi,
    '$1[REDACTED]'
  ]
]

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi

export function scrubPII(value: string): string {
  let scrubbed = value
  for (const pattern of PII_PATH_PATTERNS) {
    scrubbed = scrubbed.replace(pattern, (_match, prefix: string) => `${prefix}[REDACTED]`)
  }
  return scrubbed.replace(EMAIL_PATTERN, '[REDACTED]')
}

export function scrubSecrets(value: string): string {
  let scrubbed = value
  for (const [pattern, replacement] of SECRET_REPLACEMENTS) {
    scrubbed = scrubbed.replace(pattern, replacement as string)
  }
  return scrubbed
}

/**
 * Apply every scrubber in one pass. Use this for any text leaving the
 * process boundary (telemetry, error reports, log forwarding) — it is the
 * single source of truth for "what gets redacted before going off-box".
 */
export function scrubAll(value: string): string {
  // Credentials embedded in URLs can resemble email addresses, so redact
  // secrets before the broader email/path PII pass.
  return scrubPII(scrubSecrets(value))
}

export type SafeTelemetryValue = boolean | number | string | null

/** Normalize untrusted exception metadata before it reaches a telemetry SDK. */
export function normalizeExceptionContext(
  context: Record<string, unknown>,
  limits: { maxKeys?: number; maxArrayItems?: number; maxStringLength?: number } = {}
): Record<string, SafeTelemetryValue | SafeTelemetryValue[]> {
  const maxKeys = limits.maxKeys ?? 64
  const maxArrayItems = limits.maxArrayItems ?? 32
  const maxStringLength = limits.maxStringLength ?? 16 * 1024
  const normalized: Record<string, SafeTelemetryValue | SafeTelemetryValue[]> = {}

  for (const [rawKey, value] of Object.entries(context).slice(0, maxKeys)) {
    const key = scrubAll(rawKey).slice(0, 128)
    if (!key) continue
    if (typeof value === 'string') {
      normalized[key] = scrubAll(value).slice(0, maxStringLength)
    } else if (typeof value === 'boolean' || typeof value === 'number' || value === null) {
      normalized[key] = value
    } else if (Array.isArray(value)) {
      normalized[key] = value.slice(0, maxArrayItems).flatMap((entry) => {
        if (typeof entry === 'string') return [scrubAll(entry).slice(0, maxStringLength)]
        if (typeof entry === 'boolean' || typeof entry === 'number' || entry === null)
          return [entry]
        return []
      })
    }
  }

  return normalized
}
