const MAX_SEARCH_LENGTH = 200

export function searchTerm(value: unknown): string | undefined | null {
  if (value === undefined) return undefined
  if (typeof value !== 'string') return null
  const term = value.trim()
  return term.length > 0 && term.length <= MAX_SEARCH_LENGTH ? term : null
}
