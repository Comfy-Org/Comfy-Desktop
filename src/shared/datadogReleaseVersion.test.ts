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
      'v1.1.4-dce2b8a977d4'
    )
  })

  it('does not collapse different rejected characters onto one release', () => {
    const space = normalizeDatadogVersion('1.1.4 5')
    const atSign = normalizeDatadogVersion('1.1.4@5')

    expect(space).not.toBe(atSign)
    expect(space).not.toBe(normalizeDatadogVersion('1.1.4_5'))
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

  it('truncates at a Unicode code-point boundary', () => {
    const version = normalizeDatadogVersion(`${'a'.repeat(191)}𠀀`)

    expect(version).toMatch(/^a+-h[a-f0-9]{8}$/)
    expect(version).not.toMatch(/[\uD800-\uDFFF]/u)
    expect(isValidPinnedSdkTag(`version:${version}`)).toBe(true)
  })

  it('does not collide when truncation follows different rejected characters', () => {
    expect(normalizeDatadogVersion(`${'a'.repeat(189)}…`)).not.toBe(
      normalizeDatadogVersion(`${'a'.repeat(189)}${String.fromCodePoint(0x2028)}`)
    )
  })

  it('rejects malformed commit identifiers instead of fabricating a SHA', () => {
    expect(() =>
      resolveDatadogReleaseVersion({ npm_package_version: '1.1.4', GITHUB_SHA: 'refs/heads/main' })
    ).toThrow('hexadecimal SHA')
  })

  it('falls back from a whitespace npm version to package metadata', () => {
    expect(
      resolveDatadogReleaseVersion({ npm_package_version: ' ', GITHUB_SHA: 'dce2b8a977d4' })
    ).toBe('v1.1.4-dce2b8a977d4')
  })

  it('reserves room for the commit suffix when the package version is long', () => {
    const version = resolveDatadogReleaseVersion({
      npm_package_version: `release-${'a'.repeat(250)}`,
      GITHUB_SHA: 'dce2b8a977d40ecd25c67f2fecf0a686d1d60961'
    })

    expect(version).toHaveLength(192)
    expect(version).toMatch(/-dce2b8a977d4$/)
    expect(isValidPinnedSdkTag(`version:${version}`)).toBe(true)
  })
})
