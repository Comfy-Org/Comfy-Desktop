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
 * ComfyUI's error text additionally goes through `scrubPaths` first: via
 * `buildErrorFields` / `errorTail`, the execution tap's traceback, and the
 * exit event's stderr tail. A path inside the installation stays readable
 * relative to a token, and every other absolute path is redacted. Desktop's own
 * exception forwarders (`forwardDatadogError`, `captureException`) do not use
 * it: their frames are Desktop's bundle, handled by the username pass.
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

/**
 * A directory whose paths may be forwarded relative to a stable token, e.g.
 * the ComfyUI install as `<comfyui>`. Everything under no root is redacted.
 */
export interface PathRoot {
  path: string
  token: string
}

/**
 * The body of an unquoted path: everything up to a line end, a double quote or
 * `<>|`. Spaces are included, because a path's directories and file name may
 * hold them and nothing marks where such a path ends; any prose after an
 * outside path is redacted with it. A colon is included unless a digit or
 * whitespace follows, which keeps `file.py:12: Warning` and `path: message`
 * apart while still covering `A:/x:B:/y` lists and stream names.
 */
const PATH_BODY = `(?:[^\\r\\n"<>|:]|:(?=[^\\d\\s]))*`
/** How a path may start once any quote is removed. */
const PATH_START = `(?:file:\\/\\/|(?:\\\\\\\\\\?\\\\)?[A-Za-z]:[\\\\/]|[\\\\/]{2}|~?\\/)`
/** One path segment name: no separator, no whitespace, no delimiter. */
const SEGMENT = `[^\\s"<>|:\\\\/]`

/**
 * Absolute path candidates, first match wins:
 * 1-2. a quoted string whose content starts like a path, the other quote
 *    character included (`"C:\Users\Sean O'Brien\x.py"`);
 * 3. a `file://` URL;
 * 4. a Windows drive path, optionally with the `\\?\` long-path prefix;
 * 5. a UNC path, including `\\?\UNC\...`;
 * 6. a forward-slash UNC path (`//server/share`), not a URL's `scheme://`;
 * 7. a POSIX or home-relative path. The lookbehind keeps URLs (`https://h/p`),
 *    fractions (`1/2`), relative paths and our own `<token>/rest` output out.
 */
const PATH_CANDIDATE = new RegExp(
  [
    `"(${PATH_START}[^"\\r\\n]*)"`,
    `'(${PATH_START}[^'\\r\\n]*)'`,
    `file:\\/\\/${PATH_BODY}`,
    `(?<![A-Za-z0-9])(?:\\\\\\\\\\?\\\\)?[A-Za-z]:[\\\\/]${PATH_BODY}`,
    `(?<![\\w\\\\/])\\\\\\\\${SEGMENT}+[\\\\/]${PATH_BODY}`,
    `(?<![\\w:/\\\\])\\/\\/${SEGMENT}+\\/${PATH_BODY}`,
    `(?<![\\w.:/\\\\~>-])~?\\/${SEGMENT}${PATH_BODY}`
  ].join('|'),
  'g'
)

/**
 * Trailing text an unquoted match gives back: whitespace, and punctuation that
 * closes the surrounding sentence or bracket rather than the path.
 */
const TRAILING = /[\s)\]},;.'`]+$/

/**
 * Forward slashes, one at a time, no long-path or `file://` prefix, `.` and
 * `..` resolved, no trailing slash. A UNC path keeps its double leading slash.
 */
function normalizePath(value: string): string {
  const unc = /^(?:[\\/]{2}(?:\?[\\/]UNC[\\/])?)(?![\\/?])/i.test(value)
  let flat = value
    .replace(/^file:\/\/(?:localhost)?/i, '')
    .replace(/^[\\/]{2}\?[\\/](?:UNC[\\/])?/i, unc ? '//' : '')
    .replace(/[\\/]+/g, '/')
  // `file:///C:/x` leaves `/C:/x`.
  if (/^\/[A-Za-z]:\//.test(flat)) flat = flat.slice(1)
  const lead = unc ? '//' : flat.startsWith('/') ? '/' : ''
  const resolved: string[] = []
  for (const segment of flat.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') resolved.pop()
    else resolved.push(segment)
  }
  return lead + resolved.join('/')
}

/** Drive and UNC paths compare case-insensitively, as Windows resolves them. */
function isWindowsShaped(normalized: string): boolean {
  return /^[A-Za-z]:(?:\/|$)/.test(normalized) || normalized.startsWith('//')
}

function rewritePath(candidate: string, roots: readonly PathRoot[]): string {
  const normalized = normalizePath(candidate)
  for (const root of roots) {
    const rootPath = normalizePath(root.path)
    if (rootPath.length < 2) continue
    const fold = isWindowsShaped(rootPath)
    const subject = fold ? normalized.toLowerCase() : normalized
    const prefix = fold ? rootPath.toLowerCase() : rootPath
    if (subject === prefix || subject.startsWith(`${prefix}/`)) {
      return `${root.token}${normalized.slice(rootPath.length)}`
    }
  }
  return '<path>'
}

/**
 * Rewrite every absolute path in `text`: a path under one of `roots` becomes
 * that root's token plus the rest of the path (`<comfyui>/custom_nodes/x.py`),
 * and any other path, whether on another drive, a UNC share, a home directory or
 * a `file://` URL, becomes `<path>`. With no roots, every absolute path is
 * redacted.
 *
 * Run it BEFORE `scrubAll`: that pass rewrites the username inside a root,
 * after which the root no longer matches. The output is stable under a second
 * pass with any roots, so layered forwarders may each apply it.
 */
export function scrubPaths(text: string, roots: readonly PathRoot[] = []): string {
  // Longest first, so `<comfyui>` wins over the `<install>` that contains it.
  const ordered = [...roots].sort(
    (left, right) => normalizePath(right.path).length - normalizePath(left.path).length
  )
  return text.replace(
    PATH_CANDIDATE,
    (match: string, doubleQuoted?: string, singleQuoted?: string) => {
      if (doubleQuoted !== undefined) return `"${rewritePath(doubleQuoted, ordered)}"`
      if (singleQuoted !== undefined) return `'${rewritePath(singleQuoted, ordered)}'`
      const trailing = TRAILING.exec(match)?.[0] ?? ''
      return rewritePath(match.slice(0, match.length - trailing.length), ordered) + trailing
    }
  )
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
