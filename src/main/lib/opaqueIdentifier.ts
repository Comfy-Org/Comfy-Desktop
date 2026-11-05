const CASE_INSENSITIVE_ILLEGAL_DISTINCT_IDS: ReadonlySet<string> = new Set([
  'anonymous',
  'guest',
  'distinctid',
  'distinct_id',
  'id',
  'not_authenticated',
  'email',
  'undefined',
  'true',
  'false'
])
const CASE_SENSITIVE_ILLEGAL_DISTINCT_IDS: ReadonlySet<string> = new Set([
  '[object Object]',
  'NaN',
  'None',
  'none',
  'null',
  '0'
])

export function isIllegalPostHogDistinctId(value: string): boolean {
  return (
    value.trim().length === 0 ||
    CASE_INSENSITIVE_ILLEGAL_DISTINCT_IDS.has(value.toLowerCase()) ||
    CASE_SENSITIVE_ILLEGAL_DISTINCT_IDS.has(value)
  )
}

export function normalizeOpaqueIdentifier(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (!normalized || normalized.length > maxLength) return null
  for (let index = 0; index < normalized.length; index++) {
    const code = normalized.charCodeAt(index)
    if (code <= 31 || code === 127) return null
  }
  return normalized
}

export function normalizePostHogUserId(value: unknown): string | null {
  const normalized = normalizeOpaqueIdentifier(value, 256)
  return normalized !== null && !isIllegalPostHogDistinctId(normalized) ? normalized : null
}
