import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  getPipFallbackIndexArgs,
  getPipIndexArgs,
  installFilteredRequirementsDetailed,
  parsePipFreeze,
  runUvPip,
  runUvPipDetailed,
  uvEnv,
  PYPI_INDEX_URL,
  PYPI_MIRROR_URLS
} from './pip'
import { killProcTree } from './process'
import type * as ChildProcessModule from 'child_process'
import type * as ProcessModule from './process'

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcessModule>()
  const spawn = vi.fn()
  return { ...actual, spawn, default: { ...actual, spawn } }
})
vi.mock('./process', async (importOriginal) => {
  const actual = await importOriginal<typeof ProcessModule>()
  return { ...actual, killProcTree: vi.fn(actual.killProcTree) }
})

function getIndexUrl(args: string[]): string | undefined {
  const i = args.indexOf('--index-url')
  return i >= 0 ? args[i + 1] : undefined
}

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

describe('getPipFallbackIndexArgs', () => {
  const MIRROR = 'https://custom.mirror.example/simple/'

  it('is null without a mirror, so there is nothing to fall back to', () => {
    expect(getPipFallbackIndexArgs()).toBeNull()
    expect(getPipFallbackIndexArgs('  ')).toBeNull()
    expect(getPipFallbackIndexArgs('https://pypi.org/simple')).toBeNull()
  })

  it('asks the mirrors first, configured mirror then the Chinese mirrors, and pypi.org last', () => {
    expect(
      getPipFallbackIndexArgs(MIRROR),
      'uv asks every --extra-index-url, in order, before --index-url'
    ).toEqual(['--index-url', PYPI_INDEX_URL, '--extra-index-url', MIRROR])
    expect(getPipFallbackIndexArgs(MIRROR, true)).toEqual([
      '--index-url',
      PYPI_INDEX_URL,
      '--extra-index-url',
      MIRROR,
      ...PYPI_MIRROR_URLS.flatMap((url) => ['--extra-index-url', url])
    ])
  })

  it('lists a mirror that repeats pypi.org or a Chinese mirror once', () => {
    expect(getPipFallbackIndexArgs(`${PYPI_MIRROR_URLS[0]!.slice(0, -1)}`, true)).toEqual([
      '--index-url',
      PYPI_INDEX_URL,
      '--extra-index-url',
      PYPI_MIRROR_URLS[0]!.slice(0, -1),
      ...PYPI_MIRROR_URLS.slice(1).flatMap((url) => ['--extra-index-url', url])
    ])
    expect(getPipFallbackIndexArgs('https://pypi.org/simple', true)).toEqual([
      '--index-url',
      PYPI_INDEX_URL,
      ...PYPI_MIRROR_URLS.flatMap((url) => ['--extra-index-url', url])
    ])
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

  it("passes an install's extra environment through to uv, over the uv environment", async () => {
    const proc = fakeUv()
    spawnMock.mockReturnValueOnce(proc as never)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pip-env-'))
    try {
      const reqPath = path.join(dir, 'reqs.txt')
      fs.writeFileSync(reqPath, 'comfy-agent==0.2.0\n')

      const running = installFilteredRequirementsDetailed(
        reqPath,
        'uv',
        '/py',
        dir,
        'filtered.txt',
        () => {},
        undefined,
        undefined,
        undefined,
        undefined,
        { UV_CONCURRENT_DOWNLOADS: '1', NO_COLOR: 'caller' }
      )
      await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled())
      proc.emit('close', 0)
      await running

      const env = (spawnMock.mock.calls[0]![2] as { env: Record<string, string> }).env
      expect(env).toMatchObject({ UV_CONCURRENT_DOWNLOADS: '1', NO_COLOR: 'caller' })
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('compiles the filtered copy instead of installing it, with every other argument kept', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pip-compile-'))
    try {
      const reqPath = path.join(dir, 'reqs.txt')
      fs.writeFileSync(reqPath, 'torch\ncomfy-agent==0.2.0\n')
      const argsFor = async (subcommand?: 'install' | 'compile'): Promise<string[]> => {
        const proc = fakeUv()
        spawnMock.mockReturnValueOnce(proc as never)
        const running = installFilteredRequirementsDetailed(
          reqPath,
          'uv',
          '/py',
          dir,
          'filtered.txt',
          () => {},
          undefined,
          undefined,
          ['-o', 'out.txt'],
          undefined,
          undefined,
          subcommand
        )
        await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled())
        const filtered = fs.readFileSync(path.join(dir, 'filtered.txt'), 'utf-8')
        proc.emit('close', 0)
        await running
        const args = spawnMock.mock.calls[0]![1] as string[]
        spawnMock.mockClear()
        expect(filtered, 'torch is filtered out of a compile too').toBe('comfy-agent==0.2.0\n')
        return args.map((arg) => (arg === path.join(dir, 'filtered.txt') ? '<filtered>' : arg))
      }

      const installed = await argsFor()
      const compiled = await argsFor('compile')

      expect(installed.slice(0, 4)).toEqual(['pip', 'install', '-r', '<filtered>'])
      expect(compiled.slice(0, 3), 'uv pip compile takes its source file positionally').toEqual([
        'pip',
        'compile',
        '<filtered>'
      ])
      expect(compiled.slice(3), 'python, index and extra arguments are unchanged').toEqual(
        installed.slice(4)
      )
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("passes a caller's extra environment to uv, over the uv environment", async () => {
    const proc = fakeUv()
    spawnMock.mockReturnValueOnce(proc as never)

    const running = runUvPipDetailed(
      'uv',
      ['pip', 'install'],
      '/inst',
      () => {},
      undefined,
      undefined,
      {
        UV_CONCURRENT_DOWNLOADS: '1'
      }
    )
    proc.emit('close', 0)
    await running

    const env = (spawnMock.mock.calls[0]![2] as { env: Record<string, string> }).env
    expect(env).toMatchObject({ UV_CONCURRENT_DOWNLOADS: '1', NO_COLOR: '1' })
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

describe('runUvPipDetailed mirror fallback', () => {
  const MIRROR = 'https://custom.mirror.example/simple/'
  const spawnMock = vi.mocked(spawn)

  function uvExiting(...codes: number[]): void {
    let n = 0
    spawnMock.mockImplementation((() => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter
        stderr: EventEmitter
        pid: undefined
        kill: () => boolean
      }
      proc.stdout = new EventEmitter()
      proc.stderr = new EventEmitter()
      proc.pid = undefined
      proc.kill = () => true
      const i = n++
      setImmediate(() => {
        proc.stderr.emit('data', Buffer.from(`out${i}\n`))
        proc.emit('close', codes[i] ?? 0)
      })
      return proc
    }) as never)
  }
  const indexArgsOf = (call: number): string[] =>
    (spawnMock.mock.calls[call]![1] as string[]).slice(2)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reruns a failed install once with the mirrors first, and returns the rerun', async () => {
    uvExiting(1, 0)
    const output: string[] = []
    const result = await runUvPipDetailed(
      'uv',
      ['pip', 'install'],
      '/inst',
      (t) => output.push(t),
      undefined,
      undefined,
      undefined,
      { pypiMirror: MIRROR }
    )

    expect(spawnMock).toHaveBeenCalledTimes(2)
    expect(indexArgsOf(0)).toEqual(getPipIndexArgs(MIRROR))
    expect(indexArgsOf(1)).toEqual(getPipFallbackIndexArgs(MIRROR))
    expect(result).toEqual({ code: 0, output: 'out1\n' })
    expect(output.join('')).toContain('Retrying with the mirrors ahead of pypi.org')
  })

  it("returns the pypi.org-first failure when both orders fail: the mirror's reflects the mirror", async () => {
    uvExiting(1, 2)
    const result = await runUvPipDetailed(
      'uv',
      ['pip', 'install'],
      '/inst',
      () => {},
      undefined,
      undefined,
      undefined,
      { useChineseMirrors: true }
    )
    expect(spawnMock).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ code: 1, output: 'out0\n' })
  })

  it('runs once when the pypi.org-first install succeeds', async () => {
    uvExiting(0)
    const result = await runUvPipDetailed(
      'uv',
      ['pip', 'install'],
      '/inst',
      () => {},
      undefined,
      undefined,
      undefined,
      { pypiMirror: MIRROR, useChineseMirrors: true }
    )
    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(result.code).toBe(0)
  })

  it('runs once, against pypi.org alone, when no mirror is set', async () => {
    uvExiting(1, 0)
    const result = await runUvPipDetailed(
      'uv',
      ['pip', 'install'],
      '/inst',
      () => {},
      undefined,
      undefined,
      undefined,
      { pypiMirror: '', useChineseMirrors: false }
    )
    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(indexArgsOf(0)).toEqual(['--index-url', PYPI_INDEX_URL])
    expect(result.code).toBe(1)
  })

  it('does not rerun after the caller aborts', async () => {
    uvExiting(1, 0)
    const abort = new AbortController()
    const output: string[] = []
    await runUvPipDetailed(
      'uv',
      ['pip', 'install'],
      '/inst',
      (t) => output.push(t),
      abort.signal,
      () => abort.abort(),
      undefined,
      { pypiMirror: MIRROR }
    )
    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(output.join(''), 'no retry is announced for a stopped install').not.toContain('Retrying')
  })

  it('forwards the mirrors through runUvPip: pypi.org first, then the mirrors first', async () => {
    uvExiting(1, 0)
    const code = await runUvPip('uv', ['pip', 'install'], '/inst', () => {}, undefined, {
      pypiMirror: MIRROR
    })
    expect(code).toBe(0)
    expect(indexArgsOf(0)).toEqual(getPipIndexArgs(MIRROR))
    expect(indexArgsOf(1)).toEqual(getPipFallbackIndexArgs(MIRROR))
  })

  it.each([
    ['the pypi.org-first run', 0],
    ['the mirror-first retry', 1]
  ])('stops the running uv when cancelled during %s', async (_label, attempt) => {
    const abort = new AbortController()
    const procs: EventEmitter[] = []
    spawnMock.mockImplementation((() => {
      const proc = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        pid: undefined,
        kill: () => true
      })
      const i = procs.push(proc) - 1
      setImmediate(() => (i < attempt ? proc.emit('close', 1) : abort.abort()))
      return proc
    }) as never)
    vi.mocked(killProcTree).mockImplementationOnce((proc) => {
      ;(proc as unknown as EventEmitter).emit('close', null)
    })

    await runUvPipDetailed(
      'uv',
      ['pip', 'install'],
      '/inst',
      () => {},
      abort.signal,
      undefined,
      undefined,
      { pypiMirror: MIRROR }
    )

    expect(procs).toHaveLength(attempt + 1)
    expect(killProcTree).toHaveBeenCalledWith(procs[attempt])
  })

  it('adds no index args for a caller that passes no mirror config', async () => {
    uvExiting(1)
    await runUvPipDetailed('uv', ['pip', 'list'], '/inst', () => {})
    expect(spawnMock.mock.calls[0]![1]).toEqual(['pip', 'list'])
  })

  it('pins pypi.org alone for a filtered requirements install with no mirror config', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pip-nomirror-'))
    try {
      const reqPath = path.join(dir, 'reqs.txt')
      fs.writeFileSync(reqPath, 'comfy-agent==0.2.0\n')
      uvExiting(1)
      await installFilteredRequirementsDetailed(reqPath, 'uv', '/py', dir, 'filtered.txt', () => {})
      expect(spawnMock).toHaveBeenCalledTimes(1)
      expect((spawnMock.mock.calls[0]![1] as string[]).slice(-2)).toEqual([
        '--index-url',
        PYPI_INDEX_URL
      ])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('falls back for a filtered requirements install, compile included', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pip-fallback-'))
    try {
      const reqPath = path.join(dir, 'reqs.txt')
      fs.writeFileSync(reqPath, 'comfy-agent==0.2.0\n')
      uvExiting(1, 0)
      const result = await installFilteredRequirementsDetailed(
        reqPath,
        'uv',
        '/py',
        dir,
        'filtered.txt',
        () => {},
        undefined,
        { pypiMirror: MIRROR },
        ['-o', 'out.txt'],
        undefined,
        undefined,
        'compile'
      )
      expect(result.code).toBe(0)
      expect(spawnMock).toHaveBeenCalledTimes(2)
      expect((spawnMock.mock.calls[1]![1] as string[]).slice(-4)).toEqual(
        getPipFallbackIndexArgs(MIRROR)
      )
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
