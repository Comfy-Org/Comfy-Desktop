import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mirrors = { pypiMirror: 'https://mirror.example/simple/', useChineseMirrors: false }

vi.mock('../settings', () => ({
  getMirrorConfig: () => mirrors
}))

vi.mock('./pip', () => ({
  installFilteredRequirementsDetailed: vi.fn(async () => ({ code: 0, output: '' })),
  runUvPipDetailed: vi.fn(async () => ({ code: 0, output: '[]' }))
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
import { installFilteredRequirementsDetailed, runUvPipDetailed } from './pip'
import { getUvPath, getVenvPythonPath, getLegacyVenvUvPath } from './pythonEnv'
import type { InstallationRecord } from '../installations'
import type * as ChildProcessModule from 'child_process'

const mockInstall = vi.mocked(installFilteredRequirementsDetailed)
const mockUvPip = vi.mocked(runUvPipDetailed)

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

describe('installAgentRequirements with a version override', () => {
  const CORE_FILE = 'comfy-agent==0.2.0\ncomfy-cli==1.21.0\n'
  const INSTALLED = JSON.stringify([
    { name: 'comfy-agent', version: '0.2.0' },
    { name: 'comfy-cli', version: '1.21.0' },
    { name: 'requests', version: '2.32.0' }
  ])
  let plan: { reqPath: string; uvPath: string; pythonPath: string; installPath: string }
  let calls: { content: string; constraints: string | null; timeoutAt?: number }[] = []
  let respond: (call: { content: string; constraints: string | null }) => {
    code: number
    output: string
  }

  beforeEach(() => {
    vi.clearAllMocks()
    installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-override-'))
    const reqPath = path.join(installDir, 'ComfyUI', 'agent_requirements.txt')
    fs.mkdirSync(path.dirname(reqPath), { recursive: true })
    fs.writeFileSync(reqPath, CORE_FILE)
    plan = { reqPath, uvPath: '/uv', pythonPath: '/py', installPath: installDir }
    calls = []
    respond = () => ({ code: 0, output: '' })
    mockUvPip.mockResolvedValue({
      code: 0,
      output: `Using Python 3.12 environment at: .venv\n${INSTALLED}`
    })
    mockInstall.mockImplementation(async (file, ...rest) => {
      const extraArgs = rest[7] as string[] | undefined
      const at = extraArgs?.indexOf('--constraint') ?? -1
      const call = {
        content: fs.readFileSync(file, 'utf-8'),
        constraints:
          at >= 0 ? fs.readFileSync(path.join(installDir, extraArgs![at + 1]!), 'utf-8') : null
      }
      calls.push(call)
      return respond(call)
    })
  })

  afterEach(() => {
    mockInstall.mockReset()
    mockInstall.mockResolvedValue({ code: 0, output: '' })
    fs.rmSync(installDir, { recursive: true, force: true })
  })

  const OVERRIDE = { 'comfy-agent': '0.2.3' }

  it('installs the overridden file once, holding every other installed package where it is', async () => {
    const decision = await installAgentRequirements(plan, vi.fn(), undefined, undefined, OVERRIDE)

    expect(decision).toEqual({ decision: 'applied', pins: new Map([['comfy-agent', '0.2.3']]) })
    expect(calls).toEqual([
      { content: 'comfy-agent==0.2.3\ncomfy-cli==1.21.0\n', constraints: 'requests==2.32.0\n' }
    ])
  })

  it("passes the constraints relative to the install dir, which is uv's cwd", async () => {
    await installAgentRequirements(plan, vi.fn(), undefined, undefined, OVERRIDE)

    const extraArgs = mockInstall.mock.calls[0]![8] as string[]
    const constraint = extraArgs[extraArgs.indexOf('--constraint') + 1]!
    expect(path.isAbsolute(constraint), 'uv splits an absolute --constraint on spaces').toBe(false)
    expect(mockInstall.mock.calls[0]![3]).toBe(installDir)
  })

  it('leaves no overridden copy or constraints behind', async () => {
    await installAgentRequirements(plan, vi.fn(), undefined, undefined, OVERRIDE)

    expect(fs.readdirSync(installDir)).toEqual(['ComfyUI'])
  })

  it('installs core file alone, exactly as before, when there is no override', async () => {
    const decision = await installAgentRequirements(plan, vi.fn())

    expect(decision).toBeUndefined()
    expect(calls).toEqual([{ content: CORE_FILE, constraints: null }])
    expect(mockUvPip).not.toHaveBeenCalled()
  })

  it('refuses an invalid payload and installs core file', async () => {
    const decision = await installAgentRequirements(plan, vi.fn(), undefined, undefined, {
      'comfy-agent': '0.2.3 --index-url https://evil.example/simple'
    })

    expect(decision).toEqual({ decision: 'refused', reason: 'bad_version' })
    expect(calls).toEqual([{ content: CORE_FILE, constraints: null }])
  })

  it('refuses an override of a package core does not pin exactly', async () => {
    fs.writeFileSync(plan.reqPath, 'comfy-agent\ncomfy-cli==1.21.0\n')

    const decision = await installAgentRequirements(plan, vi.fn(), undefined, undefined, OVERRIDE)

    expect(decision).toMatchObject({ decision: 'refused', reason: 'unsupported_line' })
    expect(calls.map((c) => c.content)).toEqual(['comfy-agent\ncomfy-cli==1.21.0\n'])
  })

  it('refuses when the installed packages cannot be listed', async () => {
    for (const listed of [
      { code: 2, output: 'error: no virtual environment found' },
      { code: 0, output: 'not json' }
    ]) {
      calls = []
      mockUvPip.mockResolvedValueOnce(listed)

      const decision = await installAgentRequirements(plan, vi.fn(), undefined, undefined, OVERRIDE)

      expect(decision).toMatchObject({ decision: 'refused', reason: 'check_failed' })
      expect(calls).toEqual([{ content: CORE_FILE, constraints: null }])
    }
  })

  it('falls back to core file when the override cannot install without moving another package', async () => {
    respond = ({ constraints }) => (constraints ? { code: 1, output: '' } : { code: 0, output: '' })
    const statuses: AgentInstallStatus[] = []

    const decision = await installAgentRequirements(
      plan,
      vi.fn(),
      undefined,
      (status) => statuses.push(status),
      OVERRIDE
    )

    expect(decision).toMatchObject({ decision: 'reverted', reason: 'install_failed' })
    expect(calls.map((c) => c.constraints === null)).toEqual([false, true])
    expect(calls[1]!.content).toBe(CORE_FILE)
    expect(statuses.at(-1), "the fallback clears the failed override's row status").toEqual({
      kind: 'installing'
    })
  })

  it('installs core file for a version this install already gave up on', async () => {
    const state = { signature: 'comfy-agent==0.2.3', failures: 2 }

    const decision = await installAgentRequirements(
      plan,
      vi.fn(),
      undefined,
      undefined,
      OVERRIDE,
      state
    )

    expect(decision).toMatchObject({ decision: 'reverted', reason: 'start_failed' })
    expect(calls).toEqual([{ content: CORE_FILE, constraints: null }])
  })

  it('tries a new version even after an earlier one was reverted', async () => {
    const state = { signature: 'comfy-agent==0.2.3', failures: 2 }

    const decision = await installAgentRequirements(
      plan,
      vi.fn(),
      undefined,
      undefined,
      { 'comfy-agent': '0.2.4' },
      state
    )

    expect(decision?.decision).toBe('applied')
  })

  describe('the time budget', () => {
    beforeEach(() => {
      waiting = 0
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    let waiting = 0

    const hangUntilAborted = (startedAt: number) =>
      mockInstall.mockImplementation(async (file, ...rest) => {
        const signal = rest[5] as AbortSignal
        const extraArgs = rest[7] as string[] | undefined
        calls.push({
          content: fs.readFileSync(file, 'utf-8'),
          constraints: extraArgs ? 'yes' : null
        })
        waiting++
        return new Promise((resolve) =>
          signal.addEventListener('abort', () => {
            waiting--
            calls.at(-1)!.timeoutAt = Date.now() - startedAt
            resolve({ code: 1, output: '' })
          })
        )
      })

    const settle = async <T>(pending: Promise<T>): Promise<T> => {
      let done = false
      void pending.then(() => (done = true))
      while (!done) {
        await new Promise((resolve) => setImmediate(resolve))
        if (waiting > 0) await vi.advanceTimersToNextTimerAsync()
      }
      return pending
    }

    it('stops the override at 90 s and gives core file the rest of the 120 s ceiling', async () => {
      hangUntilAborted(Date.now())

      const decision = await settle(
        installAgentRequirements(plan, vi.fn(), undefined, undefined, OVERRIDE)
      )

      expect(decision).toMatchObject({ decision: 'reverted', reason: 'install_failed' })
      expect(calls.map((c) => [c.constraints !== null, c.timeoutAt])).toEqual([
        [true, 90_000],
        [false, 120_000]
      ])
    })

    it('gives core file its full ceiling when there is no override', async () => {
      hangUntilAborted(Date.now())

      await settle(installAgentRequirements(plan, vi.fn()))

      expect(calls.map((c) => c.timeoutAt)).toEqual([120_000])
    })

    it("clears the override's files when uv ignores the stop and is abandoned", async () => {
      const filtered = path.join(installDir, '.launch-agent-reqs-override.txt')
      mockInstall.mockImplementation(async (_file, ...rest) => {
        const extraArgs = rest[7] as string[] | undefined
        if (extraArgs) {
          fs.writeFileSync(filtered, '')
          waiting++
          return new Promise(() => {})
        }
        return { code: 0, output: '' }
      })

      await settle(installAgentRequirements(plan, vi.fn(), undefined, undefined, OVERRIDE))

      expect(fs.readdirSync(installDir)).toEqual(['ComfyUI'])
    })
  })
})
