import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { normalizeDatadogVersion, resolveDatadogReleaseVersion } =
  require('../../scripts/datadog-release-version.cjs') as {
    normalizeDatadogVersion: (value: string) => string
    resolveDatadogReleaseVersion: (env: NodeJS.ProcessEnv) => string
  }

describe('Datadog release version', () => {
  const isValidPinnedSdkTag = (tag: string): boolean =>
    tag.length <= 200 && /^[\p{Ll}\p{Lo}][\p{Ll}\p{Lo}0-9_.:/-]*$/u.test(tag)

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

  it('normalizes uppercase versions to the pinned SDK character set', () => {
    const version = normalizeDatadogVersion('release/1.1.4-RC.1')

    expect(version).toBe('release/1.1.4-rc.1')
    expect(isValidPinnedSdkTag(`version:${version}`)).toBe(true)
  })

  it('preserves distinct Unicode release versions', () => {
    expect(normalizeDatadogVersion('版本甲')).toBe('版本甲')
    expect(normalizeDatadogVersion('版本乙')).toBe('版本乙')
    expect(normalizeDatadogVersion('版本甲')).not.toBe(normalizeDatadogVersion('版本乙'))
  })

  it("reserves the version prefix within Datadog's 200-character tag limit", () => {
    const version = normalizeDatadogVersion(`release-${'a'.repeat(250)}`)
    const tag = `version:${version}`

    expect(version).toHaveLength(192)
    expect(tag).toHaveLength(200)
    expect(isValidPinnedSdkTag(tag)).toBe(true)
  })
})
