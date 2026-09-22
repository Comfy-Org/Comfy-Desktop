// @vitest-environment node
import { execFile, type ExecFileException } from 'child_process'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

describe('findLockingProcesses probe outcomes', () => {
  beforeEach(() => {
    mockedExecFile.mockReset()
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
})
