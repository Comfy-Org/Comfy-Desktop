import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { spawn } from 'child_process'
import {
  getPipIndexArgs,
  parsePipFreeze,
  runUvPipDetailed,
  uvEnv,
  PYPI_INDEX_URL,
  PYPI_MIRROR_URLS
} from './pip'
import type * as ChildProcessModule from 'child_process'

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcessModule>()
  const spawn = vi.fn()
  return { ...actual, spawn, default: { ...actual, spawn } }
})

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
  const MIRROR = 'https://custom.mirror.example/simple/'

  it('uses pypi.org alone when no mirrors are configured', () => {
    expect(getPipIndexArgs()).toEqual(['--index-url', PYPI_INDEX_URL])
  })

  it('treats an empty or blank mirror as no mirror', () => {
    expect(getPipIndexArgs('')).toEqual(getPipIndexArgs())
    expect(getPipIndexArgs('   ')).toEqual(getPipIndexArgs())
  })

  // uv asks every --extra-index-url, in order, before --index-url. A mirror passed as --index-url
  // is therefore asked after pypi.org, and an unreachable pypi.org fails the install outright.
  const argv = (extras: string[]): string[] => [
    '--index-url',
    PYPI_INDEX_URL,
    ...extras.flatMap((url) => ['--extra-index-url', url])
  ]

  it('puts a configured mirror ahead of pypi.org, as the first index uv asks', () => {
    expect(getPipIndexArgs(MIRROR)).toEqual(argv([MIRROR]))
  })

  it('passes a padded mirror to uv trimmed', () => {
    expect(getPipIndexArgs(`  ${MIRROR}  `)).toEqual(argv([MIRROR]))
  })

  it('puts the Chinese mirrors ahead of pypi.org, in their order', () => {
    expect(getPipIndexArgs(undefined, true)).toEqual(argv(PYPI_MIRROR_URLS))
  })

  it('asks a configured mirror before the Chinese mirrors, and pypi.org last', () => {
    expect(getPipIndexArgs(MIRROR, true)).toEqual(argv([MIRROR, ...PYPI_MIRROR_URLS]))
  })

  it('leaves the Chinese mirrors out when they are off', () => {
    for (const off of [undefined, false]) {
      const args = getPipIndexArgs(MIRROR, off)
      for (const url of PYPI_MIRROR_URLS) expect(args).not.toContain(url)
    }
  })

  it('names pypi.org once when the configured mirror is pypi.org, with or without its slash', () => {
    for (const mirror of [
      'https://pypi.org/simple/',
      'https://pypi.org/simple',
      ' https://pypi.org/simple/ '
    ]) {
      expect(getPipIndexArgs(mirror, true)).toEqual([
        '--index-url',
        PYPI_INDEX_URL,
        ...PYPI_MIRROR_URLS.flatMap((url) => ['--extra-index-url', url])
      ])
    }
  })

  it('names a Chinese mirror once when it is also the configured mirror, keeping it first', () => {
    const chinese = PYPI_MIRROR_URLS[1]!
    for (const mirror of [chinese, chinese.replace(/\/$/, '')]) {
      expect(getPipIndexArgs(mirror, true), 'with or without its slash').toEqual(
        argv([mirror, ...PYPI_MIRROR_URLS.filter((url) => url !== chinese)])
      )
    }
  })

  it('adds no --index-strategy: a mirror that lacks a package falls through to the next index', () => {
    expect(getPipIndexArgs(MIRROR, true)).not.toContain('--index-strategy')
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

describe('runUvPipDetailed onSpawn', () => {
  /** Minimal stand-in for uv: the streams the runner attaches to and a pid. */
  function fakeUv(pid = 4242): EventEmitter & { stdout: EventEmitter; stderr: EventEmitter } {
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
      pid: number
      killed: boolean
      kill: () => boolean
    }
    proc.stdout = new EventEmitter()
    proc.stderr = new EventEmitter()
    proc.pid = pid
    proc.killed = false
    proc.kill = () => true
    return proc
  }

  const spawnMock = vi.mocked(spawn)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('hands the caller the process it spawned', async () => {
    const proc = fakeUv()
    spawnMock.mockReturnValueOnce(proc as never)
    let delivered: unknown = null

    const running = runUvPipDetailed(
      'uv',
      ['pip', 'install'],
      '/inst',
      () => {},
      undefined,
      (p) => {
        delivered = p
      }
    )
    proc.emit('close', 0)

    await expect(running).resolves.toEqual({ code: 0, output: '' })
    expect(delivered).toBe(proc)
  })

  it('behaves exactly as before for a caller that passes no callback', async () => {
    // The seam is additive: every existing call site omits it and must be
    // indistinguishable from the code before it existed.
    const proc = fakeUv()
    spawnMock.mockReturnValueOnce(proc as never)

    const running = runUvPipDetailed('uv', ['pip', 'install'], '/inst', () => {})
    proc.stdout.emit('data', Buffer.from('Installed 1 package\n'))
    proc.emit('close', 3)

    await expect(running).resolves.toEqual({ code: 3, output: 'Installed 1 package\n' })
  })

  it('does not let a throwing callback take down the install', async () => {
    const proc = fakeUv()
    spawnMock.mockReturnValueOnce(proc as never)

    const running = runUvPipDetailed(
      'uv',
      ['pip', 'install'],
      '/inst',
      () => {},
      undefined,
      () => {
        throw new Error('caller bookkeeping blew up')
      }
    )
    proc.emit('close', 0)

    await expect(running).resolves.toEqual({ code: 0, output: '' })
  })
})
