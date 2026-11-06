export function isOpenablePathString(value: string): boolean {
  const v = value.trim()
  if (!v || v === '—') return false
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return false
  if (/^[^\s/\\@]+@[^\s/\\@]+:/.test(v)) return false
  if (/^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/.test(v)) return false
  return v.includes('/') || v.includes('\\') || v.startsWith('~')
}
