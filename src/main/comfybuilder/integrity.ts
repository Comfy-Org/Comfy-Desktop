/** Normalize a manifest hash for comparison: strip an optional `sha256:` prefix,
 * trim, and lowercase. Returns an empty string when there is no usable hash. */
export function normalizeSha256(raw: string | undefined): string {
  return (
    raw
      ?.replace(/^sha256:/i, '')
      .trim()
      .toLowerCase() ?? ''
  )
}

export function isSecureDownloadUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    if (url.protocol === 'https:') return true
    return url.protocol === 'http:' && ['127.0.0.1', '::1', 'localhost'].includes(url.hostname)
  } catch {
    return false
  }
}
