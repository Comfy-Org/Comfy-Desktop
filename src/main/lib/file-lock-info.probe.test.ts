import { execFile, type ExecFileException } from 'child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('child_process', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, execFile: vi.fn() }
})

import { findLockingProcesses } from './file-lock-info'

const mockedExecFile = vi.mocked(execFile)

function mockProbe(err: ExecFileException | null, stdout: string): void {
  mockedExecFile.mockImplementation(((
    _cmd: string,
    _args: string[],
    _options: Record<string, unknown>,
    callback: (err: ExecFileException | null, stdout: string, stderr: string) => void
  ) => callback(err, stdout, '')) as never)
}

function lastExecArgs(): string[] {
  return (mockedExecFile.mock.calls.at(-1)?.[1] ?? []) as string[]
}

function asPlatform(platform: string): () => void {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')!
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  return () => Object.defineProperty(process, 'platform', original)
}

const RM_FAILED = '__RM_QUERY_FAILED__'

function timeoutError(): ExecFileException {
  return Object.assign(new Error('spawn lsof ETIMEDOUT'), {
    killed: true,
    signal: 'SIGTERM' as const,
    code: undefined
  })
}

function spawnError(): ExecFileException {
  return Object.assign(new Error('spawn lsof ENOENT'), {
    killed: false,
    code: 'ENOENT',
    errno: -2,
    syscall: 'spawn lsof'
  })
}

function noMatchError(): ExecFileException {
  return Object.assign(new Error('Command failed: lsof'), {
    killed: false,
    code: 1
  })
}

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
    mockProbe(timeoutError(), 'p111\ncchrome\n')
    expect(await findLockingProcesses('/some/path')).toEqual({ ok: false, reason: 'timeout' })
  })

  it('reports a missing platform tool as a failure', async () => {
    mockProbe(spawnError(), '')
    expect(await findLockingProcesses('/some/path')).toEqual({ ok: false, reason: 'unavailable' })
  })

  it('treats exit status 1 with no output as a determined, empty answer', async () => {
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
    mockProbe(Object.assign(new Error('Command failed: lsof'), { killed: false, code: 2 }), '')
    expect(await findLockingProcesses('/some/path')).toEqual({ ok: false, reason: 'unavailable' })
  })

  it('still reports holders named by an unexplained exit status', async () => {
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
    mockProbe(null, '')
    void findLockingProcesses('C:\\some\\path')
    const script = lastExecArgs().at(-1) ?? ''
    expect(script).toContain(`const string FAILED = "${RM_FAILED}"`)
    expect(script).not.toContain('${')
  })

  it('reports a Restart Manager failure rather than a clean answer', async () => {
    mockProbe(null, `${RM_FAILED}\n`)
    expect(await findLockingProcesses('C:\\some\\path')).toEqual({
      ok: false,
      reason: 'unavailable'
    })
  })

  it('treats any nonzero exit as a failure, numeric included', async () => {
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
