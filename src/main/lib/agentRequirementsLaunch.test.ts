import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mirrors = { pypiMirror: 'https://mirror.example/simple/', useChineseMirrors: false }

vi.mock('../settings', () => ({
  getMirrorConfig: () => mirrors
}))

vi.mock('./pip', () => ({
  installFilteredRequirementsDetailed: vi.fn(async () => ({ code: 0, output: '' }))
}))

/** Observes the force-stop path: process discovery and, on Windows, the kill. */
const execCalls: { cmd: string; args: string[] }[] = []
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcessModule>()
  const execFile = vi.fn(
    (
      cmd: string,
      args: string[],
      _opts: unknown,
      cb: (e: unknown, o: string, s: string) => void
    ) => {
      execCalls.push({ cmd, args })
      const discovery = cmd === 'pgrep' || cmd === 'powershell.exe'
      cb(null, discovery ? '4242\n' : '', '')
      return {}
    }
  )
  return { ...actual, execFile, default: { ...actual, execFile } }
})

import {
  agentInstallStatus,
  installAgentRequirements,
  planAgentRequirementsInstall
} from './agentRequirementsLaunch'
import type { AgentInstallStatus } from './agentRequirementsLaunch'
import { installFilteredRequirementsDetailed } from './pip'
import { getUvPath, getVenvPythonPath, getLegacyVenvUvPath } from './pythonEnv'
import type { InstallationRecord } from '../installations'
import type * as ChildProcessModule from 'child_process'

const mockInstall = vi.mocked(installFilteredRequirementsDetailed)

let installDir = ''

/** Create a file (and its parents) the way the real layout has it on disk. */
function touch(target: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, '')
}

/** A standalone install: `standalone-env` uv + the managed `ComfyUI/.venv`. */
function managedInstall(): InstallationRecord {
  touch(getUvPath(installDir))
  touch(getVenvPythonPath(installDir))
  return { installPath: installDir } as unknown as InstallationRecord
}

function writeAgentRequirements(): string {
  const reqPath = path.join(installDir, 'ComfyUI', 'agent_requirements.txt')
  fs.mkdirSync(path.dirname(reqPath), { recursive: true })
  fs.writeFileSync(reqPath, 'comfyui-agent==1.0.0\n')
  return reqPath
}

describe('planAgentRequirementsInstall', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-reqs-'))
    fs.mkdirSync(path.join(installDir, 'ComfyUI'), { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(installDir, { recursive: true, force: true })
  })

  it('plans the install when the user typed the flag by hand', () => {
    const reqPath = writeAgentRequirements()
    const inst = managedInstall()

    expect(
      planAgentRequirementsInstall(inst, ['-s', 'main.py', '--enable-agent', '--listen'])
    ).toEqual({
      reqPath,
      uvPath: getUvPath(installDir),
      pythonPath: getVenvPythonPath(installDir),
      installPath: installDir
    })
  })

  it('plans the install when a beta grant added the flag', () => {
    // A grant reaches the final args ahead of the user's own, which is the only
    // difference from the hand-typed case - the args are all this reads.
    const reqPath = writeAgentRequirements()
    const inst = managedInstall()

    const plan = planAgentRequirementsInstall(inst, [
      '-s',
      'main.py',
      '--feature-flag',
      'show_signin_button=true',
      '--enable-agent',
      '--listen'
    ])

    expect(plan?.reqPath).toBe(reqPath)
  })

  it('plans nothing when the flag is absent', () => {
    writeAgentRequirements()
    const inst = managedInstall()

    expect(planAgentRequirementsInstall(inst, ['-s', 'main.py', '--listen'])).toBeNull()
  })

  it('plans nothing when core ships no agent requirements file', () => {
    const inst = managedInstall()

    expect(planAgentRequirementsInstall(inst, ['--enable-agent'])).toBeNull()
  })

  it('plans nothing for an install with no Desktop-managed Python environment', () => {
    // Portable, git and build installs: the requirements file may well be there,
    // but there is no uv/venv pair to install it into.
    writeAgentRequirements()
    const inst = { installPath: installDir } as unknown as InstallationRecord

    expect(planAgentRequirementsInstall(inst, ['--enable-agent'])).toBeNull()
  })

  it('plans nothing when uv is missing from an otherwise managed install', () => {
    writeAgentRequirements()
    touch(getVenvPythonPath(installDir))
    const inst = { installPath: installDir } as unknown as InstallationRecord

    expect(planAgentRequirementsInstall(inst, ['--enable-agent'])).toBeNull()
  })

  it('targets the legacy venv for an adopted install', () => {
    const reqPath = writeAgentRequirements()
    const adoptedBaseDir = path.join(installDir, 'legacy')
    const adoptedPythonPath = path.join(adoptedBaseDir, '.venv', 'python-for-test')
    touch(getLegacyVenvUvPath(adoptedBaseDir))
    touch(adoptedPythonPath)
    const inst = {
      installPath: installDir,
      adopted: true,
      adoptedBaseDir,
      adoptedPythonPath
    } as unknown as InstallationRecord

    expect(planAgentRequirementsInstall(inst, ['--enable-agent'])).toEqual({
      reqPath,
      uvPath: getLegacyVenvUvPath(adoptedBaseDir),
      pythonPath: adoptedPythonPath,
      installPath: installDir
    })
  })
})

describe('installAgentRequirements', () => {
  const plan = {
    reqPath: '/inst/ComfyUI/agent_requirements.txt',
    uvPath: '/inst/standalone-env/bin/uv',
    pythonPath: '/inst/ComfyUI/.venv/bin/python3',
    installPath: '/inst'
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('installs the planned file through the shared uv helper', async () => {
    const sendOutput = vi.fn()

    await installAgentRequirements(plan, sendOutput)

    expect(mockInstall).toHaveBeenCalledWith(
      plan.reqPath,
      plan.uvPath,
      plan.pythonPath,
      plan.installPath,
      '.launch-agent-reqs.txt',
      sendOutput,
      expect.any(AbortSignal),
      mirrors,
      undefined,
      expect.any(Function)
    )
    expect(sendOutput.mock.calls.join('')).toContain('Installing agent requirements')
  })

  it('reports a failed install and resolves so the launch continues', async () => {
    mockInstall.mockResolvedValueOnce({ code: 2, output: 'No solution found\n' })
    const sendOutput = vi.fn()

    await expect(installAgentRequirements(plan, sendOutput)).resolves.toBeUndefined()

    expect(sendOutput.mock.calls.join('')).toContain('exited with code 2')
  })

  it('does not reprint uv output it already streamed', async () => {
    // The shared helper streams into the same sink it captures from, so
    // appending the captured tail to the failure line put uv's error in the
    // log twice - seen on a real Windows run of a failing install.
    mockInstall.mockImplementationOnce(
      async (...args: Parameters<typeof installFilteredRequirementsDetailed>) => {
        const stream = args[5]
        stream('ERROR: No solution found for comfyui-agent\n')
        return { code: 1, output: 'ERROR: No solution found for comfyui-agent\n' }
      }
    )
    const sendOutput = vi.fn()

    await installAgentRequirements(plan, sendOutput)

    const reported = sendOutput.mock.calls.join('')
    expect(reported.match(/No solution found/g)).toHaveLength(1)
    expect(reported).toContain('exited with code 1')
  })

  it('reports a thrown install and resolves so the launch continues', async () => {
    mockInstall.mockRejectedValueOnce(new Error('EACCES: permission denied'))
    const sendOutput = vi.fn()

    await expect(installAgentRequirements(plan, sendOutput)).resolves.toBeUndefined()

    expect(sendOutput.mock.calls.join('')).toContain('EACCES: permission denied')
  })

  it('abandons an install that outlives the ceiling and lets the launch continue', async () => {
    // The whole point of the bound: a stalled uv must not hold the user at the
    // launcher. Core starts with the flag and disables the agent itself.
    vi.useFakeTimers()
    try {
      let uvSignal: AbortSignal | undefined
      mockInstall.mockImplementationOnce(
        async (...args: Parameters<typeof installFilteredRequirementsDetailed>) => {
          uvSignal = args[6]
          // Resolve only once something aborts uv, the way the real helper does.
          return new Promise((resolve) => {
            uvSignal!.addEventListener('abort', () => resolve({ code: 1, output: '' }), {
              once: true
            })
          })
        }
      )
      const sendOutput = vi.fn()

      const pending = installAgentRequirements(plan, sendOutput)
      await vi.advanceTimersByTimeAsync(120_000)
      await expect(pending).resolves.toBeUndefined()

      expect(uvSignal?.aborted).toBe(true)
      expect(sendOutput.mock.calls.join('')).toContain('starting ComfyUI without it')
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops waiting for a uv that never exits after being killed', async () => {
    // The ceiling only asks uv to stop: killProcTree sends SIGTERM and does not
    // wait, and the helper settles on the child's exit, so a uv that ignores the
    // signal would hold the launch open past the bound meant to prevent exactly
    // that. The wait has to end on its own.
    vi.useFakeTimers()
    try {
      mockInstall.mockImplementationOnce(
        // Never settles, however it is signalled.
        () => new Promise<never>(() => {})
      )
      const sendOutput = vi.fn()

      const pending = installAgentRequirements(plan, sendOutput)
      await vi.advanceTimersByTimeAsync(120_000)
      await vi.advanceTimersByTimeAsync(10_000)

      await expect(pending).resolves.toBeUndefined()
      expect(sendOutput.mock.calls.join('')).toContain('uv did not stop')
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps waiting while uv is still within the grace period', async () => {
    // The grace must not cut short a uv that is on its way out, or the warning
    // would fire on every ordinary cancellation.
    vi.useFakeTimers()
    try {
      mockInstall.mockImplementationOnce(
        async (...args: Parameters<typeof installFilteredRequirementsDetailed>) => {
          const uvSignal = args[6]!
          return new Promise((resolve) => {
            uvSignal.addEventListener(
              'abort',
              () => setTimeout(() => resolve({ code: 1, output: '' }), 2_000),
              { once: true }
            )
          })
        }
      )
      const sendOutput = vi.fn()

      const pending = installAgentRequirements(plan, sendOutput)
      await vi.advanceTimersByTimeAsync(120_000)
      await vi.advanceTimersByTimeAsync(2_000)
      await pending

      const reported = sendOutput.mock.calls.join('')
      expect(reported).toContain('starting ComfyUI without it')
      expect(reported).not.toContain('uv did not stop')
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports success for an install that finishes inside the grace period', async () => {
    // The ceiling can fire while uv is already on its way out with a zero exit.
    // Reporting that from the timer rather than the exit code would tell the
    // user the agent was skipped on a launch that actually installed it.
    vi.useFakeTimers()
    try {
      mockInstall.mockImplementationOnce(
        async (...args: Parameters<typeof installFilteredRequirementsDetailed>) => {
          const uvSignal = args[6]!
          return new Promise((resolve) => {
            uvSignal.addEventListener(
              'abort',
              () => setTimeout(() => resolve({ code: 0, output: '' }), 1_000),
              { once: true }
            )
          })
        }
      )
      const sendOutput = vi.fn()

      const pending = installAgentRequirements(plan, sendOutput)
      await vi.advanceTimersByTimeAsync(120_000)
      await vi.advanceTimersByTimeAsync(1_000)
      await pending

      const reported = sendOutput.mock.calls.join('')
      expect(reported).not.toContain('without it')
      expect(reported).not.toContain('uv did not stop')
      expect(reported).not.toContain('exited with code')
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not cancel the launch when the ceiling fires', async () => {
    // The deadline aborts a controller this module owns, never the launch's own
    // signal - the launch must proceed, not report itself cancelled.
    vi.useFakeTimers()
    try {
      const launchAbort = new AbortController()
      mockInstall.mockImplementationOnce(
        async (...args: Parameters<typeof installFilteredRequirementsDetailed>) => {
          const uvSignal = args[6]!
          return new Promise((resolve) => {
            uvSignal.addEventListener('abort', () => resolve({ code: 1, output: '' }), {
              once: true
            })
          })
        }
      )

      const pending = installAgentRequirements(plan, vi.fn(), launchAbort.signal)
      await vi.advanceTimersByTimeAsync(120_000)
      await pending

      expect(launchAbort.signal.aborted).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('leaves the deadline behind no timer once the install finishes', async () => {
    vi.useFakeTimers()
    try {
      await installAgentRequirements(plan, vi.fn())
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('kills uv when the launch itself is cancelled', async () => {
    const launchAbort = new AbortController()
    let uvSignal: AbortSignal | undefined
    mockInstall.mockImplementationOnce(
      async (...args: Parameters<typeof installFilteredRequirementsDetailed>) => {
        uvSignal = args[6]
        launchAbort.abort()
        return { code: 1, output: '' }
      }
    )

    await installAgentRequirements(plan, vi.fn(), launchAbort.signal)

    expect(uvSignal?.aborted).toBe(true)
  })

  it('stays quiet about a thrown install when the launch was cancelled', async () => {
    const launchAbort = new AbortController()
    mockInstall.mockImplementationOnce(async () => {
      launchAbort.abort()
      throw new Error('EIO')
    })
    const sendOutput = vi.fn()

    await installAgentRequirements(plan, sendOutput, launchAbort.signal)

    expect(sendOutput.mock.calls.join('')).not.toContain('EIO')
  })

  it('stays quiet about the exit code when the launch was cancelled mid-install', async () => {
    // Cancelling kills uv, so its non-zero exit IS the cancellation; reporting it
    // would put a spurious failure in the output of a launch the user stopped.
    const abort = new AbortController()
    mockInstall.mockImplementationOnce(async () => {
      abort.abort()
      return { code: 1, output: '' }
    })
    const sendOutput = vi.fn()

    await installAgentRequirements(plan, sendOutput, abort.signal)

    expect(sendOutput.mock.calls.join('')).not.toContain('exited with code')
  })
})

describe('agentInstallStatus', () => {
  it('reads the package and size out of uv download lines', () => {
    // uv's real form has no space before the unit; the spaced form is accepted
    // too rather than pinning the test to one version's formatting.
    expect(agentInstallStatus('Downloading numpy (15.3MiB)')).toEqual({
      kind: 'downloading',
      name: 'numpy',
      size: '15.3MiB'
    })
    expect(agentInstallStatus('Downloading comfy-agent (36.0 MiB)')).toEqual({
      kind: 'downloading',
      name: 'comfy-agent',
      size: '36.0 MiB'
    })
  })

  it("treats uv's own handover lines as the install phase", () => {
    expect(agentInstallStatus('Prepared 2 packages in 838ms')).toEqual({ kind: 'installing' })
    expect(agentInstallStatus('Installed 2 packages in 17ms')).toEqual({ kind: 'installing' })
  })

  it('leaves the status alone for anything it does not recognise', () => {
    // Returning null is what keeps the row from flickering through uv's
    // resolution counts and per-package acknowledgements.
    for (const line of [
      'Resolved 2 packages in 286ms',
      ' Downloaded numpy',
      'Using CPython 3.12.13 environment at: .venv',
      'warning: some warning',
      ''
    ]) {
      expect(agentInstallStatus(line)).toBeNull()
    }
  })
})

describe('installAgentRequirements status reporting', () => {
  const plan = {
    reqPath: '/inst/ComfyUI/agent_requirements.txt',
    uvPath: '/inst/standalone-env/bin/uv',
    pythonPath: '/inst/ComfyUI/.venv/bin/python3',
    installPath: '/inst'
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("drives the row from uv's stream, across chunk boundaries", () => {
    const seen: AgentInstallStatus[] = []
    mockInstall.mockImplementationOnce(
      async (...args: Parameters<typeof installFilteredRequirementsDetailed>) => {
        const stream = args[5]
        // A milestone split mid-line: the helper forwards raw chunks.
        stream('Resolved 1 package in 12ms\nDownloading comfy-ag')
        stream('ent (36.0 MiB)\n')
        stream('Installed 1 package in 9ms\n')
        return { code: 0, output: '' }
      }
    )

    return installAgentRequirements(plan, vi.fn(), undefined, (s) => seen.push(s)).then(() => {
      expect(seen).toEqual([
        { kind: 'downloading', name: 'comfy-agent', size: '36.0 MiB' },
        { kind: 'installing' }
      ])
    })
  })

  it('reports a failed install as a terminal row status', async () => {
    const seen: AgentInstallStatus[] = []
    mockInstall.mockResolvedValueOnce({ code: 1, output: '' })

    await installAgentRequirements(plan, vi.fn(), undefined, (s) => seen.push(s))

    expect(seen).toEqual([{ kind: 'failed' }])
  })

  it('reports a thrown install as a terminal row status', async () => {
    const seen: AgentInstallStatus[] = []
    mockInstall.mockRejectedValueOnce(new Error('EACCES'))

    await installAgentRequirements(plan, vi.fn(), undefined, (s) => seen.push(s))

    expect(seen).toEqual([{ kind: 'failed' }])
  })

  it('reports a timed-out install as a terminal row status', async () => {
    vi.useFakeTimers()
    try {
      const seen: AgentInstallStatus[] = []
      mockInstall.mockImplementationOnce(
        async (...args: Parameters<typeof installFilteredRequirementsDetailed>) => {
          const uvSignal = args[6]!
          return new Promise((resolve) => {
            uvSignal.addEventListener('abort', () => resolve({ code: 1, output: '' }), {
              once: true
            })
          })
        }
      )

      const pending = installAgentRequirements(plan, vi.fn(), undefined, (s) => seen.push(s))
      await vi.advanceTimersByTimeAsync(120_000)
      await pending

      expect(seen).toEqual([{ kind: 'failed' }])
    } finally {
      vi.useRealTimers()
    }
  })

  it('says nothing terminal when the install succeeds', async () => {
    const seen: AgentInstallStatus[] = []
    mockInstall.mockResolvedValueOnce({ code: 0, output: '' })

    await installAgentRequirements(plan, vi.fn(), undefined, (s) => seen.push(s))

    expect(seen).toEqual([])
  })
})

describe('force-stopping an abandoned install', () => {
  let installDir = ''
  const planFor = (dir: string) => ({
    reqPath: path.join(dir, 'ComfyUI', 'agent_requirements.txt'),
    uvPath: path.join(dir, 'standalone-env', 'bin', 'uv'),
    pythonPath: path.join(dir, 'ComfyUI', '.venv', 'bin', 'python3'),
    installPath: dir
  })

  /** Stand-in for the helper: delivers a handle, then never settles, which is
   *  what a uv that ignored the SIGTERM looks like from here. */
  const deliverThenHang = (pid: number): void => {
    mockInstall.mockImplementationOnce(
      (...args: Parameters<typeof installFilteredRequirementsDetailed>) => {
        args[9]?.({ pid } as never)
        return new Promise<never>(() => {})
      }
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    execCalls.length = 0
    installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-force-stop-'))
  })

  afterEach(() => {
    fs.rmSync(installDir, { recursive: true, force: true })
  })

  it('kills the delivered process and nothing else, and clears its temp file', async () => {
    vi.useFakeTimers()
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    try {
      const filtered = path.join(installDir, '.launch-agent-reqs.txt')
      fs.writeFileSync(filtered, 'comfyui-agent==1.0.0\n')
      deliverThenHang(4242)
      const sendOutput = vi.fn()

      const pending = installAgentRequirements(planFor(installDir), sendOutput)
      await vi.advanceTimersByTimeAsync(120_000)
      await vi.advanceTimersByTimeAsync(10_000)
      await expect(pending).resolves.toBeUndefined()

      if (process.platform === 'win32') {
        expect(execCalls).toEqual([{ cmd: 'taskkill', args: ['/F', '/T', '/PID', '4242'] }])
      } else {
        // Negated pid: the helper spawns detached, so the group is the tree.
        expect(kill).toHaveBeenCalledWith(-4242, 'SIGKILL')
        expect(kill).toHaveBeenCalledTimes(1)
        // Nothing is searched for: no process enumeration of any kind.
        expect(execCalls).toEqual([])
      }
      expect(fs.existsSync(filtered)).toBe(false)
      expect(sendOutput.mock.calls.join('')).toContain('hard-stopped it')
    } finally {
      kill.mockRestore()
      vi.useRealTimers()
    }
  })

  it('kills nothing when the helper never delivered a handle', async () => {
    vi.useFakeTimers()
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    try {
      mockInstall.mockImplementationOnce(() => new Promise<never>(() => {}))

      const pending = installAgentRequirements(planFor(installDir), vi.fn())
      await vi.advanceTimersByTimeAsync(120_000)
      await vi.advanceTimersByTimeAsync(10_000)
      await pending

      expect(kill).not.toHaveBeenCalled()
      expect(execCalls).toEqual([])
    } finally {
      kill.mockRestore()
      vi.useRealTimers()
    }
  })

  it('does not touch the process when the install exits normally', async () => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    try {
      mockInstall.mockImplementationOnce(
        (...args: Parameters<typeof installFilteredRequirementsDetailed>) => {
          args[9]?.({ pid: 4242 } as never)
          return Promise.resolve({ code: 0, output: '' })
        }
      )

      await installAgentRequirements(planFor(installDir), vi.fn())

      expect(kill).not.toHaveBeenCalled()
      expect(execCalls).toEqual([])
    } finally {
      kill.mockRestore()
    }
  })
})
