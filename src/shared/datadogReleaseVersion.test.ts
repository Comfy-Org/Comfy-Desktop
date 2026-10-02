import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { normalizeDatadogVersion, resolveDatadogReleaseVersion } =
  require('../../scripts/datadog-release-version.cjs') as {
    normalizeDatadogVersion: (value: string) => string
    resolveDatadogReleaseVersion: (env: NodeJS.ProcessEnv) => string
  }

describe('Datadog release version', () => {
  it('creates a valid version tag from the package version and commit', () => {
    expect(
      resolveDatadogReleaseVersion({
        npm_package_version: '1.1.4',
        GITHUB_SHA: 'dce2b8a977d40ecd25c67f2fecf0a686d1d60961'
      })
    ).toBe('v1.1.4-dce2b8a977d4')
  })

  it('normalizes explicit versions used by renderer builds and sourcemap uploads', () => {
    expect(resolveDatadogReleaseVersion({ VITE_DATADOG_RUM_VERSION: '1.1.4+dce2b8a977d4' })).toBe(
      'v1.1.4_dce2b8a977d4'
    )
  })

  it('preserves already-valid version tags', () => {
    expect(normalizeDatadogVersion('release/1.1.4-rc.1')).toBe('release/1.1.4-rc.1')
  })

  it("caps tags at Datadog's 200-character limit", () => {
    expect(normalizeDatadogVersion(`release-${'a'.repeat(250)}`)).toHaveLength(200)
  })
})
