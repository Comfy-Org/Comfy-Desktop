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
