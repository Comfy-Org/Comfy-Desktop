const CASE_INSENSITIVE_BARE_ILLEGAL_DISTINCT_IDS = [
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
] as const
const CASE_SENSITIVE_BARE_ILLEGAL_DISTINCT_IDS = [
  '[object Object]',
  'NaN',
  'None',
  'none',
  'null',
  'undefined',
  '0'
] as const

function withQuotedVariants(values: readonly string[]): string[] {
  return values.flatMap((value) => [value, `'${value}'`, `"${value}"`])
}

const CASE_INSENSITIVE_ILLEGAL_DISTINCT_IDS: ReadonlySet<string> = new Set(
  withQuotedVariants(CASE_INSENSITIVE_BARE_ILLEGAL_DISTINCT_IDS)
)
const CASE_SENSITIVE_ILLEGAL_DISTINCT_IDS: ReadonlySet<string> = new Set(
  withQuotedVariants(CASE_SENSITIVE_BARE_ILLEGAL_DISTINCT_IDS)
)

export const MAX_POSTHOG_DISTINCT_ID_CODE_POINTS = 200

/**
 * PostHog ingestion refuses to merge these distinct IDs. Adopting one as an
 * identity would pool unrelated installs into a shared bucket and leave the
 * identify(`$anon_distinct_id`) merge silently rejected — the pre-login
 * history would never join the Firebase person.
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

export function normalizePostHogDistinctId(value: unknown): string | null {
  const normalized = normalizeOpaqueIdentifier(value, Number.MAX_SAFE_INTEGER)
  if (!normalized || Array.from(normalized).length > MAX_POSTHOG_DISTINCT_ID_CODE_POINTS) return null
  return isIllegalPostHogDistinctId(normalized) ? null : normalized
}
