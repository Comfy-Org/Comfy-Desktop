/**
 * Where a remote payload may point Desktop for code it will run: a campaign's pinned frontend
 * runs inside ComfyUI's page with the user's session, so a payload's sha256 only proves the file is
 * the one the payload named, not that the payload is honest. Prefixes include the path where the
 * host serves more than one owner; a caller narrows a shared host further (PyPI: `frontendCache.ts`).
 * Redirects from these (GitHub's release CDN) are followed.
 */
const TRUSTED_ARTIFACT_PREFIXES: readonly string[] = [
  'https://files.pythonhosted.org/',
  'https://github.com/Comfy-Org/'
]

export function isTrustedArtifactUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  // Compared on the normalized form, so `..` segments, host case and userinfo can't step outside
  // a prefix.
  return TRUSTED_ARTIFACT_PREFIXES.some((prefix) => parsed.href.startsWith(prefix))
}
