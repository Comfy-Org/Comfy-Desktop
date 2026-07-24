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

/**
 * PostHog ingestion refuses to merge these IDs: adopting one would pool
 * unrelated installs and silently reject the `$anon_distinct_id` merge.
 */
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
