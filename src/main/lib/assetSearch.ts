const MAX_SEARCH_LENGTH = 200

export function searchTerm(value: unknown): string | undefined | null {
  if (value === undefined) return undefined
  if (typeof value !== 'string') return null
  const term = value.trim()
  if (term.length === 0) return undefined
  return [...term].length <= MAX_SEARCH_LENGTH ? term : null
}

export function sinceTime(value: unknown): string | undefined | null {
  if (value === undefined) return undefined
  if (typeof value !== 'string') return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toISOString() : null
}

export function madeSince(since: string): (made: { createdAt: string | null }) => boolean {
  const from = Date.parse(since)
  return ({ createdAt }) => createdAt !== null && Date.parse(createdAt) >= from
}
