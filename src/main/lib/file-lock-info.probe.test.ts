// @vitest-environment node
import { execFile, type ExecFileException } from 'child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('child_process', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, execFile: vi.fn() }
})

import { findLockingProcesses } from './file-lock-info'

const mockedExecFile = vi.mocked(execFile)

/**
 * `execFile` reports every outcome - success, a plain non-zero exit, a timeout
 * kill and a spawn failure - through the same callback, so the shape of `err`
 * is the only thing separating them. Drive that callback directly: the real
 * `lsof` cannot be made to time out on demand without a sleep, and this repo
 * does not tolerate a test that is a race against a 10s cap.
 */
function mockProbe(err: ExecFileException | null, stdout: string): void {
  mockedExecFile.mockImplementation(((
    _cmd: string,
    _args: string[],
    _options: Record<string, unknown>,
    callback: (err: ExecFileException | null, stdout: string, stderr: string) => void
  ) => callback(err, stdout, '')) as never)
}

/** The args `execFile` was last called with. */
function lastExecArgs(): string[] {
  return (mockedExecFile.mock.calls.at(-1)?.[1] ?? []) as string[]
}

/**
 * `findLockingProcesses` branches on `process.platform` at call time, so the
 * Windows path is reachable from this host. Returns a restore function.
 */
function asPlatform(platform: string): () => void {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')!
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  return () => Object.defineProperty(process, 'platform', original)
}

/** The token the Windows script prints when a Restart Manager call fails. */
const RM_FAILED = '__RM_QUERY_FAILED__'

/** How Node reports a child killed by the `timeout` option. */
function timeoutError(): ExecFileException {
  return Object.assign(new Error('spawn lsof ETIMEDOUT'), {
    killed: true,
    signal: 'SIGTERM' as const,
    code: undefined
  })
}

/** How Node reports a binary that is not on PATH. */
function spawnError(): ExecFileException {
  return Object.assign(new Error('spawn lsof ENOENT'), {
    killed: false,
    code: 'ENOENT',
    errno: -2,
    syscall: 'spawn lsof'
  })
}

/** How `lsof` reports "I ran fine and matched nothing": exit status 1. */
function noMatchError(): ExecFileException {
  return Object.assign(new Error('Command failed: lsof'), {
    killed: false,
    code: 1
  })
}

// `findLockingProcesses` dispatches on `process.platform`, so without pinning
// it these lsof-shaped fixtures would route to the Restart Manager parser on a
// Windows machine and every assertion here would fail for the wrong reason.
describe('findLockingProcesses probe outcomes (unix)', () => {
  let restore: () => void

  beforeEach(() => {
    mockedExecFile.mockReset()
    restore = asPlatform('linux')
  })

  afterEach(() => restore())

  it('runs lsof, not the Windows probe', () => {
    mockProbe(null, '')
    void findLockingProcesses('/some/path')
    expect(mockedExecFile.mock.calls.at(-1)?.[0]).toBe('lsof')
  })

  it('reports a timeout as a failure, not as an empty result', async () => {
    mockProbe(timeoutError(), '')
    expect(await findLockingProcesses('/some/path')).toEqual({ ok: false, reason: 'timeout' })
  })

  it('does not pass off a partial scan as the full answer when it times out', async () => {
    // The cap killed `lsof` mid-walk, so these names are whatever it had got
    // to - not the holder set. Reporting them would swap one half-truth for
    // another.
    mockProbe(timeoutError(), 'p111\ncchrome\n')
    expect(await findLockingProcesses('/some/path')).toEqual({ ok: false, reason: 'timeout' })
  })

  it('reports a missing platform tool as a failure', async () => {
    mockProbe(spawnError(), '')
    expect(await findLockingProcesses('/some/path')).toEqual({ ok: false, reason: 'unavailable' })
  })

  it('treats exit status 1 with no output as a determined, empty answer', async () => {
    // This is the ordinary unlocked-file path: `lsof` exits 1 when it matches
    // nothing. Folding it in with the failures would make every successful
    // delete claim the lock check broke.
    mockProbe(noMatchError(), '')
    expect(await findLockingProcesses('/some/path')).toEqual({ ok: true, processes: [] })
  })

  it('parses holders from a successful probe', async () => {
    mockProbe(null, 'p101\ncComfyUI\np202\nccode\n')
    expect(await findLockingProcesses('/some/path')).toEqual({
      ok: true,
      processes: [
        { pid: 101, name: 'ComfyUI' },
        { pid: 202, name: 'code' }
      ]
    })
  })

  it('keeps a holder that exits non-zero but still printed results', async () => {
    // `lsof` exits 1 on partial errors (an unreadable mount, say) while still
    // reporting what it did find, so the exit status alone must not discard
    // real names.
    mockProbe(noMatchError(), 'p303\ncpython\n')
    expect(await findLockingProcesses('/some/path')).toEqual({
      ok: true,
      processes: [{ pid: 303, name: 'python' }]
    })
  })

  it('deduplicates a process holding the same file through several fds', async () => {
    mockProbe(null, 'p404\ncComfyUI\ncComfyUI\np505\ncnode\n')
    expect(await findLockingProcesses('/some/path')).toEqual({
      ok: true,
      processes: [
        { pid: 404, name: 'ComfyUI' },
        { pid: 505, name: 'node' }
      ]
    })
  })

  it('does not file a maxBuffer overflow under the timeout cap', async () => {
    // It arrives `killed: true` like our own cap does, but the cause is a
    // flood of output, and the reason is what the caller logs.
    mockProbe(
      Object.assign(new Error('stdout maxBuffer length exceeded'), {
        killed: true,
        code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
      }),
      ''
    )
    expect(await findLockingProcesses('/some/path')).toEqual({
      ok: false,
      reason: 'unavailable'
    })
  })

  it('treats an unexplained exit status with no output as a failure', async () => {
    // `lsof` uses 1 for "matched nothing"; nothing else is a documented empty
    // answer, so assuming emptiness is the conflation this module removes.
    mockProbe(Object.assign(new Error('Command failed: lsof'), { killed: false, code: 2 }), '')
    expect(await findLockingProcesses('/some/path')).toEqual({ ok: false, reason: 'unavailable' })
  })

  it('still reports holders named by an unexplained exit status', async () => {
    // It named a real process; the odd status does not make that untrue.
    mockProbe(
      Object.assign(new Error('Command failed: lsof'), { killed: false, code: 2 }),
      'p707\ncblender\n'
    )
    expect(await findLockingProcesses('/some/path')).toEqual({
      ok: true,
      processes: [{ pid: 707, name: 'blender' }]
    })
  })
})

describe('findLockingProcesses on Windows', () => {
  let restore: () => void

  beforeEach(() => {
    mockedExecFile.mockReset()
    restore = asPlatform('win32')
  })

  afterEach(() => restore())

  it('runs the Windows probe, not lsof', () => {
    mockProbe(null, '')
    void findLockingProcesses('C:\\some\\path')
    expect(mockedExecFile.mock.calls.at(-1)?.[0]).toBe('powershell.exe')
  })

  it('embeds the failure token literally in the script', () => {
    // The token is interpolated into the PowerShell source from the TS
    // constant. If that interpolation ever breaks, the script prints something
    // the callback does not recognise and every failure silently reads as a
    // clean answer again - on a platform no test here can otherwise reach.
    mockProbe(null, '')
    void findLockingProcesses('C:\\some\\path')
    const script = lastExecArgs().at(-1) ?? ''
    expect(script).toContain(`const string FAILED = "${RM_FAILED}"`)
    expect(script).not.toContain('${')
  })

  it('reports a Restart Manager failure rather than a clean answer', async () => {
    // PowerShell itself succeeded, so no exit status can catch this one.
    mockProbe(null, `${RM_FAILED}\n`)
    expect(await findLockingProcesses('C:\\some\\path')).toEqual({
      ok: false,
      reason: 'unavailable'
    })
  })

  it('treats any nonzero exit as a failure, numeric included', async () => {
    // Unlike `lsof`, PowerShell has no "found nothing" status - a probe that
    // ran exits 0 and says so in its output.
    mockProbe(Object.assign(new Error('script error'), { killed: false, code: 1 }), '')
    expect(await findLockingProcesses('C:\\some\\path')).toEqual({
      ok: false,
      reason: 'unavailable'
    })
  })

  it('reports a timeout as a timeout', async () => {
    mockProbe(
      Object.assign(new Error('timed out'), { killed: true, signal: 'SIGTERM' as const }),
      ''
    )
    expect(await findLockingProcesses('C:\\some\\path')).toEqual({
      ok: false,
      reason: 'timeout'
    })
  })

  it('reads empty output from a clean exit as a determined, empty answer', async () => {
    mockProbe(null, '')
    expect(await findLockingProcesses('C:\\some\\path')).toEqual({ ok: true, processes: [] })
  })

  it('parses holders from a successful probe', async () => {
    mockProbe(null, '4321\tComfyUI\n8765\texplorer\n')
    expect(await findLockingProcesses('C:\\some\\path')).toEqual({
      ok: true,
      processes: [
        { pid: 4321, name: 'ComfyUI' },
        { pid: 8765, name: 'explorer' }
      ]
    })
  })
})
