import { describe, it, expect } from 'vitest'
import { getPipIndexArgs, parsePipFreeze, uvEnv, PYPI_INDEX_URL, PYPI_MIRROR_URLS } from './pip'

/** Extract --index-url value from args. */
function getIndexUrl(args: string[]): string | undefined {
  const i = args.indexOf('--index-url')
  return i >= 0 ? args[i + 1] : undefined
}

/** Extract all --extra-index-url values from args. */
function getExtras(args: string[]): string[] {
  const extras: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--extra-index-url') extras.push(args[i + 1]!)
  }
  return extras
}

describe('getPipIndexArgs', () => {
  it('uses pypi.org as --index-url when no mirrors configured', () => {
    const args = getPipIndexArgs()
    expect(getIndexUrl(args)).toBe(PYPI_INDEX_URL)
    expect(getExtras(args)).toEqual([])
  })

  it('does not include Chinese mirrors when useChineseMirrors is false or unset', () => {
    const args = getPipIndexArgs()
    for (const url of PYPI_MIRROR_URLS) {
      expect(args).not.toContain(url)
    }
    expect(getExtras(args)).toHaveLength(0)
  })

  // uv consults --extra-index-url entries before the default --index-url and
  // stops at the first index carrying the package (#1660), so a mirror only
  // actually wins when it occupies an EXTRA slot while pypi.org stays the
  // --index-url fallback.
  it('puts every Chinese mirror ahead of pypi.org in --extra-index-url when useChineseMirrors is true', () => {
    const args = getPipIndexArgs(undefined, true)
    expect(getIndexUrl(args)).toBe(PYPI_INDEX_URL)
    expect(getExtras(args)).toEqual(PYPI_MIRROR_URLS)
  })

  it('does not include --index-strategy', () => {
    const noMirror = getPipIndexArgs()
    expect(noMirror).not.toContain('--index-strategy')

    const withMirror = getPipIndexArgs('https://custom.mirror.example/simple/')
    expect(withMirror).not.toContain('--index-strategy')
  })

  it('puts the user mirror ahead of pypi.org in --extra-index-url when provided', () => {
    const mirror = 'https://custom.mirror.example/simple/'
    const args = getPipIndexArgs(mirror)
    expect(getIndexUrl(args)).toBe(PYPI_INDEX_URL)
    expect(getExtras(args)).toEqual([mirror])
  })

  it('keeps pypi.org as the --index-url fallback for a user mirror', () => {
    const mirror = 'https://custom.mirror.example/simple/'
    const args = getPipIndexArgs(mirror, false)
    expect(getIndexUrl(args)).toBe(PYPI_INDEX_URL)
    expect(getExtras(args)).toEqual([mirror])
  })

  it('orders extras user mirror first, then Chinese mirrors', () => {
    const mirror = 'https://custom.mirror.example/simple/'
    const args = getPipIndexArgs(mirror, true)
    expect(getIndexUrl(args)).toBe(PYPI_INDEX_URL)
    expect(getExtras(args)).toEqual([mirror, ...PYPI_MIRROR_URLS])
  })

  it('deduplicates when user mirror matches pypi.org', () => {
    const args = getPipIndexArgs('https://pypi.org/simple/', true)
    expect(getIndexUrl(args)).toBe('https://pypi.org/simple/')
    const extras = getExtras(args)
    expect(extras).not.toContain('https://pypi.org/simple/')
    expect(extras).toEqual(PYPI_MIRROR_URLS)
  })

  it('deduplicates when user mirror matches pypi.org without trailing slash', () => {
    const args = getPipIndexArgs('https://pypi.org/simple', true)
    const extras = getExtras(args)
    expect(extras).toEqual(PYPI_MIRROR_URLS)
  })

  it('deduplicates when user mirror is one of the Chinese mirrors', () => {
    const mirror = PYPI_MIRROR_URLS[0]!
    const args = getPipIndexArgs(mirror, true)
    expect(getIndexUrl(args)).toBe(PYPI_INDEX_URL)
    // The mirror enters once (as the user mirror) and the loop does not add
    // it a second time.
    const extras = getExtras(args)
    expect(extras.filter((u) => u === mirror)).toHaveLength(1)
    expect(extras).toEqual([mirror, ...PYPI_MIRROR_URLS.slice(1)])
  })

  it('treats empty string as no mirror', () => {
    const args = getPipIndexArgs('')
    expect(args).toEqual(getPipIndexArgs())
  })

  it('treats whitespace-only string as no mirror', () => {
    const args = getPipIndexArgs('   ')
    expect(args).toEqual(getPipIndexArgs())
  })

  it('trims whitespace from mirror URL', () => {
    const mirror = '  https://custom.mirror.example/simple/  '
    const args = getPipIndexArgs(mirror)
    expect(getExtras(args)).toEqual(['https://custom.mirror.example/simple/'])
  })

  it('passes undefined the same as no argument', () => {
    expect(getPipIndexArgs(undefined)).toEqual(getPipIndexArgs())
  })
})

describe('parsePipFreeze', () => {
  it('parses a plain freeze', () => {
    expect(parsePipFreeze('aiohttp==3.9.5\nnumpy==1.26.4\n')).toEqual({
      aiohttp: '3.9.5',
      numpy: '1.26.4'
    })
  })

  // #1514: uv honours FORCE_COLOR/CLICOLOR_FORCE even into a pipe, so the
  // freeze can arrive as `ESC[1mname ESC[0m==version`. A name carrying those
  // bytes matches nothing in the snapshot and is rejected by `uv pip
  // uninstall` — which is what tipped a no-op restore into a destructive one.
  it('parses a colourised freeze to the same result as a plain one', () => {
    const colourised =
      '\u001B[1maiohttp\u001B[0m==3.9.5\n' +
      '\u001B[1mnumpy\u001B[0m==1.26.4\n' +
      '\u001B[1mtorch\u001B[0m==2.4.1+cu121\n'
    const parsed = parsePipFreeze(colourised)
    expect(parsed).toEqual({ aiohttp: '3.9.5', numpy: '1.26.4', torch: '2.4.1+cu121' })
    for (const name of Object.keys(parsed)) {
      expect(name).not.toContain('\u001B')
    }
  })

  it('strips colour from editable installs and PEP 508 direct references', () => {
    const output =
      '-e \u001B[1mgit+https://github.com/x/y@abc#egg=ynode\u001B[0m\n' +
      '\u001B[1mmypkg\u001B[0m @ \u001B[2mfile:///tmp/mypkg\u001B[0m\n'
    const parsed = parsePipFreeze(output)
    expect(Object.keys(parsed)).toEqual(['ynode', 'mypkg'])
    expect(parsed.mypkg).toBe('file:///tmp/mypkg')
    expect(parsed.ynode).not.toContain('\u001B')
  })

  it('ignores blank lines, comments, and uv status chatter', () => {
    expect(
      parsePipFreeze('\n# a comment\nUsing Python 3.12.4 environment at: .venv\nnumpy==1.26.4\n')
    ).toEqual({ numpy: '1.26.4' })
  })
})

describe('uvEnv', () => {
  it('forces colour off, overriding an inherited FORCE_COLOR/CLICOLOR_FORCE', () => {
    const env = uvEnv({ PATH: '/usr/bin', FORCE_COLOR: '1', CLICOLOR_FORCE: '1' })
    expect(env.NO_COLOR).toBe('1')
    expect('FORCE_COLOR' in env).toBe(false)
    expect('CLICOLOR_FORCE' in env).toBe(false)
    expect(env.PATH).toBe('/usr/bin')
  })

  // Windows environment names are case-insensitive, so `Force_Color` reaches
  // the child exactly as `FORCE_COLOR` would — and Windows is the platform
  // this guard most needs to cover.
  it.each([
    ['Force_Color', 'clicolor_force'],
    ['force_color', 'CliColor_Force']
  ])('drops colour-forcing vars whatever their case (%s, %s)', (a, b) => {
    const env = uvEnv({ [a]: '1', [b]: '1', PATH: '/usr/bin' })
    const names = Object.keys(env).map((k) => k.toUpperCase())
    expect(names).not.toContain('FORCE_COLOR')
    expect(names).not.toContain('CLICOLOR_FORCE')
    expect(env.NO_COLOR).toBe('1')
    expect(env.PATH).toBe('/usr/bin')
  })

  it('does not mutate the environment it is given', () => {
    const base = { FORCE_COLOR: '1' }
    uvEnv(base)
    expect(base.FORCE_COLOR).toBe('1')
  })
})

describe('parsePipFreeze hardening', () => {
  // These keys become argv for `uv pip uninstall`, so an option-shaped token
  // must never survive parsing.
  it('drops names that are not valid distribution names', () => {
    const parsed = parsePipFreeze(
      ['-e git+https://x/y@abc#egg=--python=/other/env', '--upgrade==1.0', 'good-pkg==1.0'].join(
        '\n'
      )
    )
    expect(Object.keys(parsed)).toEqual(['good-pkg'])
  })

  it('trims a name whose styling enclosed trailing whitespace', () => {
    expect(parsePipFreeze('\u001B[1maiohttp \u001B[0m==3.9.5')).toEqual({ aiohttp: '3.9.5' })
  })

  it('does not inherit Object.prototype members as installed packages', () => {
    const parsed = parsePipFreeze('good-pkg==1.0')
    expect('constructor' in parsed).toBe(false)
    expect('toString' in parsed).toBe(false)
  })

  it('parses a real distribution named like a prototype member', () => {
    expect(parsePipFreeze('constructor==1.2.3')).toEqual({ constructor: '1.2.3' })
  })
})
