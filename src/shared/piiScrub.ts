const ESCAPED_NAME = String.raw`(?:\\u[0-9a-fA-F]{4}|\\x[89a-fA-F][0-9a-fA-F]|[^\\/"\r\n])+`
const ESCAPED_SEP_NAME = String.raw`((?:\\\\)+|(?:\\?\/)+)${ESCAPED_NAME}`
const MIXED_SEP_NAME = String.raw`((?:\\\\)+|(?:\\?\/)+|[\\/]{2,})${ESCAPED_NAME}`
const RAW_SEP_NAME = String.raw`(\\)[^\\/"\r\n]+`
const SHARE_HOST = String.raw`[^\\/\s"']+`
const USER_PATH_ROOTS = [
  String.raw`([A-Za-z]:[\\/]+Users)`,
  String.raw`(\\\\(?:wsl\$|wsl\.localhost)[\\/]+${SHARE_HOST}[\\/]+(?:home|mnt[\\/]+[A-Za-z][\\/]+Users))`,
  String.raw`(\\\\tsclient[\\/]+[A-Za-z][\\/]+Users)`,
  String.raw`(\\\\${SHARE_HOST}[\\/]+(?:Users|home))`,
  String.raw`(\\\\${SHARE_HOST}[\\/]+[A-Za-z]\$[\\/]+Users)`,
  String.raw`(\\\\[?.][\\/]+UNC[\\/]+${SHARE_HOST}(?:[\\/]+[A-Za-z]\$)?[\\/]+Users)`,
  String.raw`([\\/]Device[\\/]+[^\\/]+[\\/]+Users)`,
  String.raw`((?<![\w.~$\\/-])\\+Users)`,
  String.raw`(\/Users)`,
  String.raw`(\/home)`
]
const USERS_AFTER_ESCAPED_BREAK = String.raw`((?<=\\(?-i:[nrt]))\\+Users)`

const userPathPatterns = (roots: string[], escapedSepName: string): RegExp[] =>
  roots.map((root) => new RegExp(`${root}(?:${escapedSepName}|${RAW_SEP_NAME})`, 'gi'))
const SEQUENTIAL_USER_PATH_PATTERNS = userPathPatterns(USER_PATH_ROOTS, ESCAPED_SEP_NAME)
const EVERY_START_USER_PATH_PATTERNS = userPathPatterns(
  [...USER_PATH_ROOTS, USERS_AFTER_ESCAPED_BREAK],
  MIXED_SEP_NAME
)

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

const URL_SCHEME = /(?:https?|data):/i

type Span = [start: number, end: number]

function nameSpansFromEveryStart(pattern: RegExp, text: string): Span[] {
  const spans: Span[] = []
  pattern.lastIndex = 0
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const [whole, root = '', escapedSep, rawSep = ''] = match
    const nameStart = match.index + root.length + (escapedSep ?? rawSep).length
    const name = text.slice(nameStart, match.index + whole.length)
    const schemeAt = name.search(URL_SCHEME)
    if (schemeAt !== 0)
      spans.push([nameStart, schemeAt < 0 ? nameStart + name.length : nameStart + schemeAt])
    pattern.lastIndex = match.index + 1
  }
  return spans
}

function sequentialNameSpans(text: string): Span[] {
  const spans: Span[] = []
  let masked = text
  for (const pattern of SEQUENTIAL_USER_PATH_PATTERNS) {
    masked = masked.replace(
      pattern,
      (whole: string, root: string, escapedSep: string | undefined, rawSep: string, at: number) => {
        const nameStart = root.length + (escapedSep ?? rawSep).length
        spans.push([at + nameStart, at + whole.length])
        return whole.slice(0, nameStart).padEnd(whole.length, '\0')
      }
    )
  }
  return spans
}

export function scrubPII(value: string): string {
  const everyStart = EVERY_START_USER_PATH_PATTERNS.flatMap((pattern) =>
    nameSpansFromEveryStart(pattern, value)
  )
  const spans = [...sequentialNameSpans(value), ...everyStart].sort(([a], [b]) => a - b)
  let redacted = ''
  let cursor = 0
  for (const [start, end] of spans) {
    if (start > cursor) redacted += `${value.slice(cursor, start)}[REDACTED]`
    cursor = Math.max(cursor, end)
  }
  return (redacted + value.slice(cursor)).replace(EMAIL_PATTERN, '[REDACTED]')
}

export function scrubSecrets(value: string): string {
  let scrubbed = value
  for (const [pattern, replacement] of SECRET_REPLACEMENTS) {
    scrubbed = scrubbed.replace(pattern, replacement as string)
  }
  return scrubbed
}

export function scrubAll(value: string): string {
  return scrubPII(scrubSecrets(value))
}

export type SafeTelemetryValue = boolean | number | string | null

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
