/**
 * Shared guard for "is this string safe to open in the OS file manager?".
 *
 * Used by the readonly path displays so that only real local filesystem paths
 * become clickable open-folder targets — never URLs, SSH/Git remotes, or dates
 * that merely contain slashes.
 *
 * Windows notes: drive paths (`C:\…`, `C:/…`) and UNC paths (`\\server\share`)
 * are openable. A bare drive-relative value like `C:foo` (no separator) is not
 * recognised as a path and stays non-clickable.
 */
export function isOpenablePathString(value: string): boolean {
  const v = value.trim()
  if (!v || v === '—') return false
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return false // URL scheme: http://, file://, …
  if (/^[^\s/\\@]+@[^\s/\\@]+:/.test(v)) return false // scp/SSH remote: git@github.com:owner/repo
  if (/^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/.test(v)) return false // bare date-ish value only: 2024/01/02, 01-02-2024
  return v.includes('/') || v.includes('\\') || v.startsWith('~')
}
