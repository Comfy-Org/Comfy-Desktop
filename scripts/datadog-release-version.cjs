/* eslint-disable @typescript-eslint/no-require-imports */
const { execSync } = require('node:child_process')
const { readFileSync } = require('node:fs')
const path = require('node:path')

const repoRoot = path.resolve(__dirname, '..')

function readPackageVersion() {
  try {
    const raw = readFileSync(path.join(repoRoot, 'package.json'), 'utf8')
    const parsed = JSON.parse(raw)
    if (typeof parsed.version === 'string' && parsed.version.trim().length > 0) {
      return parsed.version.trim()
    }
  } catch {}

  return ''
}

function readGitSha() {
  try {
    return execSync('git rev-parse --short=12 HEAD', {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2_000
    }).trim()
  } catch {
    return ''
  }
}

/** Datadog unified-service tag values must begin with a lowercase or uncased letter and
 * may only contain those letters, numbers, underscores, minuses, colons, periods, and
 * forward slashes. Keep release and sourcemap versions identical by normalizing once at
 * their shared source. Reserve eight characters for the `version:` tag prefix. */
function normalizeDatadogVersion(value, maxLength = 192) {
  const normalized = Array.from(
    String(value || '')
      .trim()
      .toLowerCase()
  )
    .map((character) => {
      if (/^[\p{Ll}\p{Lo}0-9_.:/-]$/u.test(character)) return character
      // A plus commonly joins SemVer build metadata to its commit and is equivalent to the
      // hyphen used by our self-resolved path. Encode every other rejected code point so
      // different source versions do not silently collapse onto one release.
      if (character === '+') return '-'
      return `_u${character.codePointAt(0).toString(16)}_`
    })
    .join('')
  if (!normalized) return 'v0.0.0'
  const withLeadingLetter = /^[\p{Ll}\p{Lo}]/u.test(normalized) ? normalized : `v${normalized}`
  let truncated = ''
  for (const character of withLeadingLetter) {
    if (truncated.length + character.length > maxLength) break
    truncated += character
  }
  return truncated
}

function resolveDatadogReleaseVersion(env = process.env) {
  const explicitVersion = String(env.VITE_DATADOG_RUM_VERSION || '').trim()
  if (explicitVersion) return normalizeDatadogVersion(explicitVersion)

  const packageVersion = String(env.npm_package_version || readPackageVersion()).trim()
  const commitSha = String(env.GITHUB_SHA || env.VITE_GIT_SHA || readGitSha()).trim()

  if (!packageVersion) {
    throw new Error('Unable to resolve a Datadog release version from npm or package.json')
  }

  if (!commitSha) return normalizeDatadogVersion(packageVersion)

  const normalizedSha = commitSha
    .toLowerCase()
    .replace(/[^a-f0-9]/g, '')
    .slice(0, 12)
  if (!normalizedSha) return normalizeDatadogVersion(packageVersion)
  const suffix = `-${normalizedSha}`
  return `${normalizeDatadogVersion(packageVersion, 192 - suffix.length)}${suffix}`
}

module.exports = {
  normalizeDatadogVersion,
  resolveDatadogReleaseVersion
}

if (require.main === module) {
  process.stdout.write(resolveDatadogReleaseVersion())
}
