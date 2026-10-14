/**
 * Where a remote payload may point Desktop for code it will run: a campaign's pinned frontend
 * runs inside ComfyUI's page with the user's session, so a payload's sha256 only proves the file is
 * the one the payload named, not that the payload is honest. Each pattern names only what the
 * owner alone publishes: on GitHub, release assets (a repo's file and raw URLs also serve fork
 * pull-request commits); a caller narrows PyPI's shared host further (`frontendCache.ts`).
 * Redirects from these (GitHub's release CDN) are followed.
 */
const TRUSTED_ARTIFACT_URLS: readonly RegExp[] = [
  /^https:\/\/files\.pythonhosted\.org\//,
  /^https:\/\/github\.com\/Comfy-Org\/[^/]+\/releases\/download\//
]

export function isTrustedArtifactUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  // Matched on the normalized form, so `..` segments, host case and userinfo can't step outside.
  return TRUSTED_ARTIFACT_URLS.some((pattern) => pattern.test(parsed.href))
}
