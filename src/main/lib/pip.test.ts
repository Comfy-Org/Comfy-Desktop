import { describe, it, expect } from 'vitest'
import {
  getPipIndexArgs,
  parsePipFreeze,
  stripAnsi,
  uvEnv,
  PYPI_INDEX_URL,
  PYPI_MIRROR_URLS
} from './pip'

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

  it('uses first Chinese mirror as --index-url when useChineseMirrors is true', () => {
    const args = getPipIndexArgs(undefined, true)
    expect(getIndexUrl(args)).toBe(PYPI_MIRROR_URLS[0])
  })

  it('demotes pypi.org to --extra-index-url when useChineseMirrors is true', () => {
    const args = getPipIndexArgs(undefined, true)
    const extras = getExtras(args)
    expect(extras).toContain(PYPI_INDEX_URL)
  })

  it('includes remaining Chinese mirrors as --extra-index-url when useChineseMirrors is true', () => {
    const args = getPipIndexArgs(undefined, true)
    const extras = getExtras(args)
    const expectedExtras = [PYPI_INDEX_URL, ...PYPI_MIRROR_URLS.slice(1)]
    expect(extras).toEqual(expectedExtras)
  })

  it('does not include --index-strategy', () => {
    const noMirror = getPipIndexArgs()
    expect(noMirror).not.toContain('--index-strategy')

    const withMirror = getPipIndexArgs('https://custom.mirror.example/simple/')
    expect(withMirror).not.toContain('--index-strategy')
  })

  it('uses user mirror as --index-url when provided', () => {
    const mirror = 'https://custom.mirror.example/simple/'
    const args = getPipIndexArgs(mirror)
    expect(getIndexUrl(args)).toBe(mirror)
  })

  it('demotes pypi.org to --extra-index-url when user mirror is provided', () => {
    const mirror = 'https://custom.mirror.example/simple/'
    const args = getPipIndexArgs(mirror)
    const extras = getExtras(args)
    expect(extras).toContain(PYPI_INDEX_URL)
  })

  it('adds user mirror without Chinese mirrors when useChineseMirrors is false', () => {
    const mirror = 'https://custom.mirror.example/simple/'
    const args = getPipIndexArgs(mirror, false)
    expect(getIndexUrl(args)).toBe(mirror)
    const extras = getExtras(args)
    expect(extras).toEqual([PYPI_INDEX_URL])
  })

  it('uses user mirror as --index-url with Chinese mirrors and pypi.org as extras', () => {
    const mirror = 'https://custom.mirror.example/simple/'
    const args = getPipIndexArgs(mirror, true)
    expect(getIndexUrl(args)).toBe(mirror)
    const extras = getExtras(args)
    expect(extras).toContain(PYPI_INDEX_URL)
    for (const url of PYPI_MIRROR_URLS) {
      expect(extras).toContain(url)
    }
    expect(extras).toHaveLength(1 + PYPI_MIRROR_URLS.length)
  })

  it('deduplicates when user mirror matches pypi.org', () => {
    const args = getPipIndexArgs('https://pypi.org/simple/', true)
    expect(getIndexUrl(args)).toBe('https://pypi.org/simple/')
    const extras = getExtras(args)
    expect(extras).not.toContain('https://pypi.org/simple/')
    expect(extras).toHaveLength(PYPI_MIRROR_URLS.length)
  })

  it('deduplicates when user mirror matches pypi.org without trailing slash', () => {
    const args = getPipIndexArgs('https://pypi.org/simple', true)
    const extras = getExtras(args)
    expect(extras).toHaveLength(PYPI_MIRROR_URLS.length)
  })

  it('deduplicates when user mirror is one of the Chinese mirrors', () => {
    const mirror = PYPI_MIRROR_URLS[0]!
    const args = getPipIndexArgs(mirror, true)
    expect(getIndexUrl(args)).toBe(mirror)
    const extras = getExtras(args)
    expect(extras.filter((u) => u === mirror)).toHaveLength(0)
    expect(extras).toHaveLength(1 + PYPI_MIRROR_URLS.length - 1)
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
    expect(getIndexUrl(args)).toBe('https://custom.mirror.example/simple/')
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

describe('stripAnsi', () => {
  it('removes SGR sequences and leaves plain text untouched', () => {
    expect(stripAnsi('\u001B[1mbold\u001B[0m plain')).toBe('bold plain')
    expect(stripAnsi('plain')).toBe('plain')
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

  it('does not mutate the environment it is given', () => {
    const base = { FORCE_COLOR: '1' }
    uvEnv(base)
    expect(base.FORCE_COLOR).toBe('1')
  })
})
