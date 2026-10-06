/* eslint-disable @typescript-eslint/no-require-imports */
const { execSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { readFileSync } = require('node:fs')
const path = require('node:path')

const repoRoot = path.resolve(__dirname, '..')
const DATADOG_VERSION_MAX_LENGTH = 192

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
function normalizeDatadogVersion(value, maxLength = DATADOG_VERSION_MAX_LENGTH) {
  if (maxLength < 12) throw new Error('Datadog version length budget is too small')
  const source = String(value || '').trim()
  if (!source) throw new Error('Datadog release version cannot be empty')
  const raw = source.toLowerCase()

  // A SemVer build-metadata suffix containing a commit is the same release spelling used by
  // our self-resolved path. Other lossy changes receive a deterministic hash suffix below.
  const canonical = raw.replace(/\+([a-f0-9]{7,40})$/i, '-$1')
  let normalized = ''
  let changed = raw !== source || canonical !== raw
  for (const character of canonical) {
    const replacement = /^[\p{Ll}\p{Lo}0-9_.:/-]$/u.test(character) ? character : '_'
    if (replacement !== character) changed = true
    if (normalized.length <= maxLength) normalized += replacement
  }
  if (!/^[\p{Ll}\p{Lo}]/u.test(normalized)) {
    normalized = `v${normalized}`
    changed = true
  }

  const truncate = (input, budget) => {
    let output = ''
    for (const character of input) {
      if (output.length + character.length > budget) break
      output += character
    }
    return output
  }
  const truncated = truncate(normalized, maxLength)
  if (!changed && truncated === normalized) return truncated

  const suffix = `-h${createHash('sha256').update(source).digest('hex').slice(0, 8)}`
  return `${truncate(normalized, maxLength - suffix.length)}${suffix}`
}

function resolveDatadogReleaseVersion(env = process.env) {
  const explicitVersion = String(env.VITE_DATADOG_RUM_VERSION || '').trim()
  if (explicitVersion) return normalizeDatadogVersion(explicitVersion)

  const envPackageVersion = String(env.npm_package_version || '').trim()
  const packageVersion = envPackageVersion || readPackageVersion()
  const commitSha = String(env.GITHUB_SHA || env.VITE_GIT_SHA || readGitSha()).trim()

  if (!packageVersion) {
    throw new Error('Unable to resolve a Datadog release version from npm or package.json')
  }

  if (!commitSha) return normalizeDatadogVersion(packageVersion)

  if (!/^[a-f0-9]{7,64}$/i.test(commitSha)) return normalizeDatadogVersion(packageVersion)
  const normalizedSha = commitSha.toLowerCase().slice(0, 12)
  return normalizeDatadogVersion(`${packageVersion}+${normalizedSha}`)
}

module.exports = {
  normalizeDatadogVersion,
  resolveDatadogReleaseVersion
}

if (require.main === module) {
  process.stdout.write(resolveDatadogReleaseVersion())
}
