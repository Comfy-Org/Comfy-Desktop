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

  return '0.0.0'
}

function readGitSha() {
  try {
    return execSync('git rev-parse --short=12 HEAD', {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

/** Datadog unified-service tag values must begin with a letter and may only contain
 * letters, numbers, underscores, minuses, colons, periods, and forward slashes. Keep
 * release and sourcemap versions identical by normalizing once at their shared source. */
function normalizeDatadogVersion(value) {
  const normalized = String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9_.:/-]+/g, '_')
  if (!normalized) return 'v0.0.0'
  const withLeadingLetter = /^[A-Za-z]/.test(normalized) ? normalized : `v${normalized}`
  return withLeadingLetter.slice(0, 200)
}

function resolveDatadogReleaseVersion(env = process.env) {
  const explicitVersion = String(env.VITE_DATADOG_RUM_VERSION || '').trim()
  if (explicitVersion) return normalizeDatadogVersion(explicitVersion)

  const packageVersion = String(env.npm_package_version || readPackageVersion()).trim() || '0.0.0'
  const commitSha = String(env.GITHUB_SHA || env.VITE_GIT_SHA || readGitSha()).trim()

  return normalizeDatadogVersion(
    commitSha ? `${packageVersion}-${commitSha.slice(0, 12)}` : packageVersion,
  )
}

module.exports = {
  normalizeDatadogVersion,
  resolveDatadogReleaseVersion,
}

if (require.main === module) {
  process.stdout.write(resolveDatadogReleaseVersion())
}
