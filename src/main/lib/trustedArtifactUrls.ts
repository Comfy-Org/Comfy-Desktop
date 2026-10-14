/**
 * Where a remote payload may point Desktop for code it will run: a campaign's pinned frontend
 * runs inside ComfyUI's page with the user's session, so a payload's sha256 only proves the file is
 * the one the payload named, not that the payload is honest. Each pattern names only what the
 * owner alone publishes: on GitHub, release assets (a repo's file and raw URLs also serve fork
 * pull-request commits); on PyPI, files of the project the caller names.
 * Redirects from these (GitHub's release CDN) are followed.
 */
const PYPI_FILES = 'https://files.pythonhosted.org/'
const GITHUB_RELEASE_ASSET = /^https:\/\/github\.com\/Comfy-Org\/[^/]+\/releases\/download\//

/** PyPI hosts every project's files on one host but accepts a file only from the project it is
 *  named for, so `pypiProject` narrows that host to its own files. */
export function isTrustedArtifactUrl(url: string, pypiProject: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  // Matched on the normalized form, so `..` segments, host case and userinfo can't step outside.
  if (GITHUB_RELEASE_ASSET.test(parsed.href)) return true
  const file = parsed.pathname.slice(parsed.pathname.lastIndexOf('/') + 1)
  return (
    parsed.href.startsWith(PYPI_FILES) && file.startsWith(`${pypiProject.replaceAll('-', '_')}-`)
  )
}
