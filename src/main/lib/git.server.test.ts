// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('child_process', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, execFile: vi.fn(), spawn: vi.fn() }
})

import { execFile, spawn } from 'child_process'
import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import {
  configurePygit2,
  countCommitsAhead,
  fetchTags,
  findNearestTag,
  getPygit2Status,
  resetPygit2State,
  withoutPygit2Breaker
} from './git'

const mockedExecFile = vi.mocked(execFile)
const mockedSpawn = vi.mocked(spawn)

type Reply = { code?: number; stdout?: string; stderr?: string } | 'hang' | 'crash'

/** A stand-in for `git_operations.py serve`: answers each JSON request line via `answer`. */
class FakeServer extends EventEmitter {
  stdin = new PassThrough()
  stdout = new PassThrough()
  stderr = new PassThrough()
  requests: string[][] = []
  killed = false

  constructor(answer: (args: string[]) => Reply) {
    super()
    let buffered = ''
    this.stdin.on('data', (chunk: Buffer) => {
      buffered += chunk.toString()
      let newline: number
      while ((newline = buffered.indexOf('\n')) >= 0) {
        const request = JSON.parse(buffered.slice(0, newline)) as { id: number; args: string[] }
        buffered = buffered.slice(newline + 1)
        this.requests.push(request.args)
        const reply = answer(request.args)
        if (reply === 'hang') continue
        if (reply === 'crash') {
          setImmediate(() => this.emit('exit', 1, null))
          continue
        }
        setImmediate(() =>
          this.stdout.write(
            JSON.stringify({ id: request.id, code: 0, stdout: '', stderr: '', ...reply }) + '\n'
          )
        )
      }
    })
  }

  kill(): boolean {
    this.killed = true
    setImmediate(() => this.emit('exit', null, 'SIGTERM'))
    return true
  }
}

let servers: FakeServer[] = []

function serveWith(answer: (args: string[]) => Reply): void {
  mockedSpawn.mockImplementation(((_cmd: string, args: string[]) => {
    expect(args.at(-1)).toBe('serve')
    const server = new FakeServer(answer)
    servers.push(server)
    return server
  }) as never)
}

/** One-shot fallback: execFile answers every subcommand with `stdout`. */
function oneShotReturns(stdout: string): void {
  mockedExecFile.mockImplementation(((
    _cmd: string,
    _args: string[],
    _opts: unknown,
    cb: (err: Error | null, out: string, errOut: string) => void
  ) => setImmediate(() => cb(null, stdout, ''))) as never)
}

const failures = (): number => {
  const status = getPygit2Status()
  return status.status === 'healthy' ? status.failures : -1
}

beforeEach(() => {
  vi.resetAllMocks()
  servers = []
  resetPygit2State()
  configurePygit2('/usr/bin/python3', '/path/to/git_operations.py', { server: true })
})

afterEach(() => {
  vi.useRealTimers()
  resetPygit2State()
})

describe('pygit2 server', () => {
  it('answers read-only queries from one process, one query at a time', async () => {
    let inFlight = 0
    let peak = 0
    serveWith((args) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      setImmediate(() => inFlight--)
      return { stdout: args[0] === 'describe-tags' ? 'v0.17.0\r\n' : '12\r\n' }
    })

    const [tag, ahead, again] = await Promise.all([
      findNearestTag('/repo', 'abc'),
      countCommitsAhead('/repo', 'v0.17.0', 'abc'),
      findNearestTag('/repo', 'def')
    ])

    expect([tag, ahead, again]).toEqual(['v0.17.0', 12, 'v0.17.0'])
    expect(mockedSpawn).toHaveBeenCalledTimes(1)
    expect(mockedExecFile).not.toHaveBeenCalled()
    expect(servers[0]!.requests).toEqual([
      ['describe-tags', '/repo', 'abc'],
      ['rev-list-count', '/repo', 'v0.17.0', 'abc'],
      ['describe-tags', '/repo', 'def']
    ])
    expect(peak).toBe(1)
  })

  it('passes non-zero exit codes through as the process would', async () => {
    serveWith(() => ({ code: 1, stderr: 'Error: no ancestor tag found' }))
    expect(await findNearestTag('/repo')).toBeUndefined()
    expect(failures()).toBe(0)
  })

  it('keeps network subcommands in a process of their own', async () => {
    serveWith(() => ({ stdout: '' }))
    oneShotReturns('')
    await fetchTags('/repo')
    expect(mockedSpawn).not.toHaveBeenCalled()
    expect(mockedExecFile).toHaveBeenCalledTimes(1)
    expect((mockedExecFile.mock.calls[0]![1] as string[]).slice(3)).toEqual(['fetch-tags', '/repo'])
  })

  it('is not used unless configured with server: true', async () => {
    configurePygit2('/usr/bin/python3', '/path/to/git_operations.py')
    oneShotReturns('v0.17.0\n')
    expect(await findNearestTag('/repo')).toBe('v0.17.0')
    expect(mockedSpawn).not.toHaveBeenCalled()
  })

  it('times a stuck query out like a process, counts it, and starts a fresh server', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let first = true
    serveWith(() => {
      if (first) {
        first = false
        return 'hang'
      }
      return { stdout: 'v0.17.0\n' }
    })

    const stuck = findNearestTag('/repo', 'abc')
    await vi.waitFor(() => expect(servers[0]?.requests.length).toBe(1))
    await vi.advanceTimersByTimeAsync(5_000)

    expect(await stuck).toBeUndefined()
    expect(failures()).toBe(1)
    expect(servers[0]!.killed).toBe(true)

    expect(await findNearestTag('/repo', 'def')).toBe('v0.17.0')
    expect(servers).toHaveLength(2)
    expect(failures(), 'a reply resets the count, as a process success does').toBe(0)
  })

  it('keeps a timeout inside withoutPygit2Breaker out of the count', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    serveWith(() => 'hang')

    const stuck = withoutPygit2Breaker(() => findNearestTag('/repo'))
    await vi.waitFor(() => expect(servers[0]?.requests.length).toBe(1))
    await vi.advanceTimersByTimeAsync(5_000)

    expect(await stuck).toBeUndefined()
    expect(failures()).toBe(0)
  })

  it('reruns the query in its own process when the server dies mid-query', async () => {
    serveWith(() => 'crash')
    oneShotReturns('v0.16.0\n')

    expect(await findNearestTag('/repo')).toBe('v0.16.0')
    expect(mockedExecFile).toHaveBeenCalledTimes(1)
    expect((mockedExecFile.mock.calls[0]![1] as string[]).slice(3)).toEqual([
      'describe-tags',
      '/repo',
      'HEAD'
    ])
  })

  it('stops starting servers after repeated crashes', async () => {
    serveWith(() => 'crash')
    oneShotReturns('v0.16.0\n')

    for (let i = 0; i < 3; i++) await findNearestTag('/repo')
    expect(servers).toHaveLength(3)

    await findNearestTag('/repo')
    expect(servers).toHaveLength(3)
    expect(mockedExecFile).toHaveBeenCalledTimes(4)
  })

  it('falls back when the interpreter cannot be launched', async () => {
    mockedSpawn.mockImplementation((() => {
      const server = new FakeServer(() => 'hang')
      setImmediate(() => server.emit('error', new Error('spawn ENOENT')))
      return server
    }) as never)
    oneShotReturns('v0.16.0\n')

    expect(await findNearestTag('/repo')).toBe('v0.16.0')
  })

  it('exits after sitting idle and starts again on the next query', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    serveWith(() => ({ stdout: 'v0.17.0\n' }))

    expect(await findNearestTag('/repo')).toBe('v0.17.0')
    await vi.advanceTimersByTimeAsync(59_000)
    expect(servers[0]!.killed).toBe(false)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(servers[0]!.killed).toBe(true)

    expect(await findNearestTag('/repo')).toBe('v0.17.0')
    expect(servers).toHaveLength(2)
  })

  it('stops the server when pygit2 is reconfigured', async () => {
    serveWith(() => ({ stdout: 'v0.17.0\n' }))
    await findNearestTag('/repo')
    configurePygit2('/other/python', '/path/to/git_operations.py', { server: true })
    expect(servers[0]!.killed).toBe(true)

    await findNearestTag('/repo')
    expect(mockedSpawn.mock.calls[1]![0]).toBe('/other/python')
  })
})
