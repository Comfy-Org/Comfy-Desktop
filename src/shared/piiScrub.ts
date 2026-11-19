const ESCAPED_SEP_NAME = String.raw`((?:\\\\)+|(?:\\?\/)+|[\\/]{2,})(?:\\u[0-9a-fA-F]{4}|\\x[89a-fA-F][0-9a-fA-F]|[^\\/"\r\n])+`
const RAW_SEP_NAME = String.raw`(\\)[^\\/"\r\n]+`
const SHARE_HOST = String.raw`[^\\/\s"']+`
const PII_PATH_PATTERNS: RegExp[] = [
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
].map((root) => new RegExp(`${root}(?:${ESCAPED_SEP_NAME}|${RAW_SEP_NAME})`, 'gi'))

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

function usernameSpans(text: string): [number, number][] {
  const spans: [number, number][] = []
  for (const pattern of PII_PATH_PATTERNS) {
    pattern.lastIndex = 0
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
      const [whole, root = '', escapedSep, rawSep = ''] = match
      const nameStart = match.index + root.length + (escapedSep ?? rawSep).length
      spans.push([nameStart, match.index + whole.length])
      pattern.lastIndex = match.index + 1
    }
  }
  return spans.sort(([a], [b]) => a - b)
}

function redactUsernames(text: string): string {
  let redacted = ''
  let cursor = 0
  for (const [start, end] of usernameSpans(text)) {
    if (start > cursor) redacted += `${text.slice(cursor, start)}[REDACTED]`
    cursor = Math.max(cursor, end)
  }
  return redacted + text.slice(cursor)
}

export function scrubPII(value: string): string {
  let scrubbed = value
  for (let previous = ''; previous !== scrubbed;) {
    previous = scrubbed
    scrubbed = redactUsernames(previous)
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
