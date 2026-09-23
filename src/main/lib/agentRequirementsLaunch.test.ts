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

import { installAgentRequirements, planAgentRequirementsInstall } from './agentRequirementsLaunch'
import { installFilteredRequirementsDetailed } from './pip'
import { getUvPath, getVenvPythonPath, getLegacyVenvUvPath } from './pythonEnv'
import type { InstallationRecord } from '../installations'

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
      mirrors
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
