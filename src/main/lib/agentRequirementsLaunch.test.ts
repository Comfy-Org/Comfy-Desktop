import { EventEmitter } from 'events'
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
const execAnswered: string[] = []
const slowTaskkill = { ms: 0 }
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
      const answer = (): void => {
        execAnswered.push(cmd)
        cb(null, discovery ? '4242\n' : '', '')
      }
      if (slowTaskkill.ms > 0) setTimeout(answer, slowTaskkill.ms)
      else answer()
      return {}
    }
  )
  return { ...actual, execFile, default: { ...actual, execFile } }
})

import {
  installAgentRequirements,
  planAgentRequirementsInstall,
  prefetchAgentRequirements,
  prepareAgentPrefetch,
  _resetAgentPrefetchesForTest,
  holdAgentPrefetch,
  restoreCoreFrontend,
  stopAgentPrefetches,
  uvErrorTail
} from './agentRequirementsLaunch'
import type { PrefetchRequest } from './agentRequirementsLaunch'
import type { PrefetchReport } from './agentRequirementsOverride'
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

  it('plans nothing for a Comfy Cloud entry, which has no local install', () => {
    const cloud = {
      id: 'cloud',
      name: 'Comfy Cloud',
      sourceId: 'cloud'
    } as unknown as InstallationRecord

    expect(planAgentRequirementsInstall(cloud, ['--enable-agent'])).toBeNull()
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
  let plan: PrefetchRequest['plan']
  let dir = ''

  beforeEach(() => {
    vi.clearAllMocks()
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-install-'))
    plan = {
      reqPath: path.join(dir, 'ComfyUI', 'agent_requirements.txt'),
      uvPath: '/inst/standalone-env/bin/uv',
      pythonPath: '/inst/ComfyUI/.venv/bin/python3',
      installPath: dir
    }
    fs.mkdirSync(path.dirname(plan.reqPath), { recursive: true })
    fs.writeFileSync(plan.reqPath, 'comfy-agent==0.2.0\n')
  })

  afterEach(() => {
    mockInstall.mockReset()
    mockInstall.mockResolvedValue({ code: 0, output: '' })
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const online = (
    impl: (...args: Parameters<typeof installFilteredRequirementsDetailed>) => unknown
  ) =>
    mockInstall.mockImplementation(async (...args) =>
      (args[8] as string[]).includes('--offline')
        ? { code: 1, output: '' }
        : (impl(...args) as ReturnType<typeof installFilteredRequirementsDetailed>)
    )

  it("checks uv's cache without writing, then installs the planned file from it through the shared uv helper", async () => {
    const sendOutput = vi.fn()

    await installAgentRequirements(plan, sendOutput)

    expect(
      mockInstall.mock.calls[0]![8],
      "a check takes no lock on a wheel another install's download is fetching"
    ).toEqual(['--offline', '--dry-run'])
    expect(mockInstall).toHaveBeenLastCalledWith(
      plan.reqPath,
      plan.uvPath,
      plan.pythonPath,
      plan.installPath,
      expect.stringMatching(/^\.launch-agent-reqs-[\w-]+\.txt$/),
      expect.any(Function),
      expect.any(AbortSignal),
      mirrors,
      ['--offline'],
      expect.any(Function),
      undefined
    )
    expect(mockInstall, 'a cache hit downloads nothing').toHaveBeenCalledTimes(2)
    expect(sendOutput.mock.calls.join('')).toContain('Installing agent requirements')
  })

  it('downloads the missing wheels in parallel into a scratch target, with the mirrors, when the cache misses', async () => {
    online(async () => ({ code: 0, output: ' + comfy-agent==0.2.0\n' }))

    await installAgentRequirements(plan, vi.fn())

    const [resolve, fetch] = mockInstall.mock.calls.slice(1, 3)
    expect(resolve![7]).toBe(mirrors)
    expect(resolve![8]).toEqual(['--dry-run'])
    expect(fetch![7]).toBe(mirrors)
    expect((fetch![8] as string[]).slice(0, 2)).toEqual(['--no-deps', '--target'])
    expect(fetch![10], 'a launch waits on this, so it downloads in parallel').toBeUndefined()
  })

  it('sweeps what a crashed attempt left an hour ago, and leaves a younger attempt alone', async () => {
    const old = path.join(dir, '.launch-agent-fetch-1-7')
    const young = path.join(dir, '.launch-agent-fetch-1-8')
    for (const target of [old, young]) {
      fs.mkdirSync(path.join(target, 'comfy_agent'), { recursive: true })
      fs.writeFileSync(`${target}-src.txt`, 'comfy-agent==0.2.0\n')
    }
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60_000)
    fs.utimesSync(old, twoHoursAgo, twoHoursAgo)
    fs.utimesSync(`${old}-src.txt`, twoHoursAgo, twoHoursAgo)
    online(async () => ({ code: 0, output: '' }))
    const lstat = vi.spyOn(fs.promises, 'lstat')
    const rm = vi.spyOn(fs.promises, 'rm')
    try {
      await installAgentRequirements(plan, vi.fn())
      const seeded = [old, `${old}-src.txt`, young, `${young}-src.txt`]
      await vi.waitFor(
        () => expect(lstat.mock.calls.map(([at]) => at)).toEqual(expect.arrayContaining(seeded)),
        { timeout: 10_000 }
      )
      await Promise.allSettled(lstat.mock.results.map(({ value }) => value))
      await new Promise((resolve) => setImmediate(resolve))
      await Promise.allSettled(rm.mock.results.map(({ value }) => value))
    } finally {
      lstat.mockRestore()
      rm.mockRestore()
    }

    expect(fs.existsSync(old), 'the stale target dir is gone').toBe(false)
    expect(fs.existsSync(`${old}-src.txt`)).toBe(false)
    expect(fs.existsSync(young), 'a live attempt may still own it').toBe(true)
    expect(fs.existsSync(`${young}-src.txt`)).toBe(true)
  }, 15_000)

  it('clears only its own scratch files, not those of a concurrent attempt whose tag it prefixes', async () => {
    let miss = true
    const resolving: { tag: string; finish: () => void }[] = []
    mockInstall.mockImplementation(async (...args) => {
      if ((args[8] as string[]).includes('--offline')) return { code: miss ? 1 : 0, output: '' }
      const tag = /^(\.launch-agent-fetch-\d+-\d+)-/.exec(String(args[4]))![1]!
      return new Promise((resolve) =>
        resolving.push({ tag, finish: () => resolve({ code: 0, output: '' }) })
      )
    })
    const attempt = (tag: string): number => Number(tag.slice(tag.lastIndexOf('-') + 1))
    const own = (tag: string): string[] =>
      fs.readdirSync(dir).filter((name) => name === tag || name.startsWith(`${tag}-`))

    const first = installAgentRequirements(plan, vi.fn())
    await vi.waitFor(() => expect(resolving).toHaveLength(1))
    const n = attempt(resolving[0]!.tag)
    miss = false
    for (let used = n; used < n * 10 - 2; used++) await installAgentRequirements(plan, vi.fn())
    miss = true
    const second = installAgentRequirements(plan, vi.fn())
    await vi.waitFor(() => expect(resolving).toHaveLength(2))
    const secondTag = resolving[1]!.tag
    expect(secondTag, 'the second tag extends the first').toBe(`${resolving[0]!.tag}0`)
    fs.mkdirSync(path.join(dir, secondTag))
    const secondFiles = own(secondTag)

    resolving[0]!.finish()
    await first

    expect(own(resolving[0]!.tag), 'the first attempt cleared its own').toEqual([])
    expect(own(secondTag), 'and left the running one its files and --target dir').toEqual(
      secondFiles
    )
    expect(secondFiles).toEqual(expect.arrayContaining([secondTag, `${secondTag}-src.txt`]))
    resolving[1]!.finish()
    await second
    expect(own(secondTag)).toEqual([])
  })

  it('reports a failed install and resolves so the launch continues', async () => {
    online(async () => ({ code: 2, output: 'No solution found\n' }))
    const sendOutput = vi.fn()

    await expect(installAgentRequirements(plan, sendOutput)).resolves.toBeUndefined()

    expect(sendOutput.mock.calls.join('')).toContain('exited with code 2')
  })

  it('does not reprint uv output it already streamed', async () => {
    // The shared helper streams into the same sink it captures from, so
    // appending the captured tail to the failure line put uv's error in the
    // log twice - seen on a real Windows run of a failing install.
    online(async (...args: Parameters<typeof installFilteredRequirementsDetailed>) => {
      const stream = args[5]
      stream('ERROR: No solution found for comfyui-agent\n')
      return { code: 1, output: 'ERROR: No solution found for comfyui-agent\n' }
    })
    const sendOutput = vi.fn()

    await installAgentRequirements(plan, sendOutput)

    const reported = sendOutput.mock.calls.join('')
    expect(reported.match(/No solution found/g)).toHaveLength(1)
    expect(reported).toContain('exited with code 1')
  })

  it('reports a thrown install and resolves so the launch continues', async () => {
    online(async () => {
      throw new Error('EACCES: permission denied')
    })
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
      online(async (...args: Parameters<typeof installFilteredRequirementsDetailed>) => {
        uvSignal = args[6]
        return new Promise((resolve) => {
          uvSignal!.addEventListener('abort', () => resolve({ code: 1, output: '' }), {
            once: true
          })
        })
      })
      const sendOutput = vi.fn()

      const pending = installAgentRequirements(plan, sendOutput)
      await vi.waitFor(() => expect(mockInstall).toHaveBeenCalledTimes(2))
      await vi.advanceTimersByTimeAsync(20_000)
      await expect(pending).resolves.toBeUndefined()

      expect(uvSignal?.aborted).toBe(true)
      expect(sendOutput.mock.calls.join('')).toContain('continuing without it')
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
      online(
        // Never settles, however it is signalled.
        () => new Promise<never>(() => {})
      )
      const sendOutput = vi.fn()

      const pending = installAgentRequirements(plan, sendOutput)
      await vi.waitFor(() => expect(mockInstall).toHaveBeenCalledTimes(2))
      await vi.advanceTimersByTimeAsync(20_000)
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
      online(async (...args: Parameters<typeof installFilteredRequirementsDetailed>) => {
        const uvSignal = args[6]!
        return new Promise((resolve) => {
          uvSignal.addEventListener(
            'abort',
            () => setTimeout(() => resolve({ code: 1, output: '' }), 2_000),
            { once: true }
          )
        })
      })
      const sendOutput = vi.fn()

      const pending = installAgentRequirements(plan, sendOutput)
      await vi.waitFor(() => expect(mockInstall).toHaveBeenCalledTimes(2))
      await vi.advanceTimersByTimeAsync(20_000)
      await vi.advanceTimersByTimeAsync(2_000)
      await pending

      const reported = sendOutput.mock.calls.join('')
      expect(reported).toContain('continuing without it')
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
      online(async (...args: Parameters<typeof installFilteredRequirementsDetailed>) => {
        const uvSignal = args[6]!
        return new Promise((resolve) => {
          uvSignal.addEventListener(
            'abort',
            () => setTimeout(() => resolve({ code: 0, output: '' }), 1_000),
            { once: true }
          )
        })
      })
      const sendOutput = vi.fn()

      const pending = installAgentRequirements(plan, sendOutput)
      await vi.waitFor(() => expect(mockInstall).toHaveBeenCalledTimes(2))
      await vi.advanceTimersByTimeAsync(20_000)
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
      online(async (...args: Parameters<typeof installFilteredRequirementsDetailed>) => {
        const uvSignal = args[6]!
        return new Promise((resolve) => {
          uvSignal.addEventListener('abort', () => resolve({ code: 1, output: '' }), {
            once: true
          })
        })
      })

      const pending = installAgentRequirements(plan, vi.fn(), launchAbort.signal)
      await vi.waitFor(() => expect(mockInstall).toHaveBeenCalledTimes(2))
      await vi.advanceTimersByTimeAsync(20_000)
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
    online(async (...args: Parameters<typeof installFilteredRequirementsDetailed>) => {
      uvSignal = args[6]
      launchAbort.abort()
      return { code: 1, output: '' }
    })

    await installAgentRequirements(plan, vi.fn(), launchAbort.signal)

    expect(uvSignal?.aborted).toBe(true)
  })

  it('stays quiet about a thrown install when the launch was cancelled', async () => {
    const launchAbort = new AbortController()
    online(async () => {
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
    online(async () => {
      abort.abort()
      return { code: 1, output: '' }
    })
    const sendOutput = vi.fn()

    await installAgentRequirements(plan, sendOutput, abort.signal)

    expect(sendOutput.mock.calls.join('')).not.toContain('exited with code')
  })
})

describe('installAgentRequirements handing over to the background download', () => {
  let dir = ''
  let plan: PrefetchRequest['plan']

  beforeEach(() => {
    vi.clearAllMocks()
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-handover-'))
    plan = {
      reqPath: path.join(dir, 'agent_requirements.txt'),
      uvPath: '/uv',
      pythonPath: '/py',
      installPath: dir
    }
    fs.writeFileSync(plan.reqPath, 'comfy-agent==0.2.0\n')
  })

  afterEach(() => {
    mockInstall.mockReset()
    mockInstall.mockResolvedValue({ code: 0, output: '' })
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const networkExits = (code: number, output = ''): void => {
    mockInstall.mockImplementation(async (...args) =>
      (args[8] as string[]).includes('--offline') ? { code: 1, output: '' } : { code, output }
    )
  }

  it("hands over core file's text when it does not download in time, and says so", async () => {
    networkExits(2)
    const onDeferred = vi.fn()
    const sendOutput = vi.fn()

    await installAgentRequirements(plan, sendOutput, undefined, undefined, null, onDeferred)

    expect(onDeferred).toHaveBeenCalledWith(
      { plan, steps: [{ text: 'comfy-agent==0.2.0\n' }], signature: 'core' },
      'agent'
    )
    expect(sendOutput.mock.calls.join('')).toContain(
      'Downloading the agent in the background; it starts on the next launch'
    )
  })

  it('hands over nothing for requirements uv proved unsatisfiable', async () => {
    networkExits(1, 'error: No solution found when resolving dependencies\n')
    const onDeferred = vi.fn()
    const sendOutput = vi.fn()

    await installAgentRequirements(plan, sendOutput, undefined, undefined, null, onDeferred)

    expect(onDeferred, 'no download can fix a resolve with no solution').not.toHaveBeenCalled()
    expect(sendOutput.mock.calls.join('')).not.toContain('next launch')
  })

  it('hands over nothing when the launch is cancelled while core file is read', async () => {
    networkExits(2)
    const abort = new AbortController()
    const read = fs.promises.readFile
    vi.spyOn(fs.promises, 'readFile').mockImplementation((async (
      ...args: Parameters<typeof read>
    ) => {
      if (args[0] === plan.reqPath && mockInstall.mock.calls.length >= 2) abort.abort()
      return read(...args)
    }) as typeof read)
    const onDeferred = vi.fn()

    try {
      await installAgentRequirements(plan, vi.fn(), abort.signal, undefined, null, onDeferred)
    } finally {
      vi.mocked(fs.promises.readFile).mockRestore()
    }

    expect(
      mockInstall,
      'the network try ran, so the launch reached its deferral'
    ).toHaveBeenCalledTimes(2)
    expect(onDeferred).not.toHaveBeenCalled()
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
    mockInstall.mockImplementation(
      (...args: Parameters<typeof installFilteredRequirementsDetailed>) => {
        if ((args[8] as string[]).includes('--offline'))
          return Promise.resolve({ code: 1, output: '' })
        args[9]?.(Object.assign(new EventEmitter(), { pid }) as never)
        return new Promise<never>(() => {})
      }
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    execCalls.length = 0
    installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-force-stop-'))
    fs.mkdirSync(path.join(installDir, 'ComfyUI'), { recursive: true })
    fs.writeFileSync(planFor(installDir).reqPath, 'comfyui-agent==1.0.0\n')
  })

  afterEach(() => {
    mockInstall.mockReset()
    mockInstall.mockResolvedValue({ code: 0, output: '' })
    fs.rmSync(installDir, { recursive: true, force: true })
  })

  it('kills the delivered process and nothing else, and clears its temp file', async () => {
    vi.useFakeTimers()
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    try {
      deliverThenHang(4242)
      const sendOutput = vi.fn()

      const pending = installAgentRequirements(planFor(installDir), sendOutput)
      await vi.waitFor(() => expect(mockInstall).toHaveBeenCalled())
      await vi.waitFor(() => expect(mockInstall).toHaveBeenCalledTimes(2))
      const filtered = path.join(installDir, mockInstall.mock.calls[1]![4] as string)
      fs.writeFileSync(filtered, 'comfyui-agent==1.0.0\n')
      await vi.advanceTimersByTimeAsync(20_000)
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

  it('hard-stops a uv that ignores the stop even when the launch itself was cancelled', async () => {
    vi.useFakeTimers()
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    try {
      deliverThenHang(4343)
      const launch = new AbortController()
      const sendOutput = vi.fn()

      const pending = installAgentRequirements(planFor(installDir), sendOutput, launch.signal)
      await vi.waitFor(() => expect(mockInstall).toHaveBeenCalledTimes(2))
      launch.abort()
      await vi.advanceTimersByTimeAsync(10_000)

      expect(await pending, 'a cancelled launch reports no decision').toBeUndefined()
      expect(
        sendOutput.mock.calls.join(''),
        'the kill is the cancellation, not a failure worth showing'
      ).not.toMatch(/hard-stopped|exceeded|exited with code/)

      if (process.platform === 'win32') {
        expect(execCalls).toEqual([{ cmd: 'taskkill', args: ['/F', '/T', '/PID', '4343'] }])
      } else {
        expect(
          kill,
          'a caller waiting on the stop must not outlive a live uv'
        ).toHaveBeenCalledWith(-4343, 'SIGKILL')
      }
    } finally {
      kill.mockRestore()
      vi.useRealTimers()
    }
  })

  it('kills nothing when the helper never delivered a handle', async () => {
    vi.useFakeTimers()
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    try {
      mockInstall.mockImplementation((...args) =>
        (args[8] as string[]).includes('--offline')
          ? Promise.resolve({ code: 1, output: '' })
          : new Promise<never>(() => {})
      )

      const pending = installAgentRequirements(planFor(installDir), vi.fn())
      await vi.waitFor(() => expect(mockInstall).toHaveBeenCalledTimes(2))
      await vi.advanceTimersByTimeAsync(20_000)
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
          args[9]?.(Object.assign(new EventEmitter(), { pid: 4242 }) as never)
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

describe("core file's temporary copy", () => {
  it('is named per attempt, so two sessions of one install cannot remove each other', async () => {
    vi.clearAllMocks()
    const plan = {
      reqPath: '/inst/ComfyUI/agent_requirements.txt',
      uvPath: '/uv',
      pythonPath: '/py',
      installPath: '/inst'
    }

    await installAgentRequirements(plan, vi.fn())
    await installAgentRequirements(plan, vi.fn())

    const names = [...new Set(mockInstall.mock.calls.map((args) => args[4]))]
    expect(names, "each attempt's check and install share one name").toHaveLength(2)
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
  let cached = false
  let offlineTries = 0
  let fetched = new Set<string>()
  let resolved: string | null = null

  beforeEach(() => {
    vi.clearAllMocks()
    cached = false
    offlineTries = 0
    fetched = new Set()
    resolved = null
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
      if (extraArgs?.includes('--target')) {
        if (resolved !== null) fetched.add(resolved)
        return { code: 0, output: '' }
      }
      if (extraArgs?.includes('--offline')) {
        if (!extraArgs.includes('--dry-run')) offlineTries++
        if (cached) return respond(call)
        return fetched.has(call.content) ? { code: 0, output: '' } : { code: 1, output: '' }
      }
      calls.push(call)
      const result = respond(call)
      if (result.code !== 0) return result
      resolved = call.content
      return { ...result, output: `${result.output} + pkg==1\n` }
    })
  })

  it('installs from the cache alone when it holds everything', async () => {
    cached = true

    const decision = await installAgentRequirements(plan, vi.fn(), undefined, OVERRIDE)

    expect(decision).toMatchObject({ decision: 'applied' })
    expect(offlineTries, 'the override, and no core file after an applied one').toBe(1)
    expect(calls, 'nothing went to the network').toEqual([])
  })

  afterEach(() => {
    mockInstall.mockReset()
    mockInstall.mockResolvedValue({ code: 0, output: '' })
    fs.rmSync(installDir, { recursive: true, force: true })
  })

  const OVERRIDE = { 'comfy-agent': '0.2.3' }

  it('installs the overridden file once, holding every other installed package where it is', async () => {
    const decision = await installAgentRequirements(plan, vi.fn(), undefined, OVERRIDE)

    expect(decision).toMatchObject({
      decision: 'applied',
      pins: new Map([['comfy-agent', '0.2.3']])
    })
    expect(calls).toEqual([
      { content: 'comfy-agent==0.2.3\ncomfy-cli==1.21.0\n', constraints: 'requests==2.32.0\n' }
    ])
  })

  it("pins the frontend from ComfyUI's requirements.txt, letting only it move", async () => {
    fs.writeFileSync(
      path.join(installDir, 'ComfyUI', 'requirements.txt'),
      'comfyui-frontend-package==1.55.18\n'
    )
    const frontend = { 'comfyui-frontend-package': '1.55.19' }
    const decision = await installAgentRequirements(plan, vi.fn(), undefined, frontend)

    expect(decision).toMatchObject({
      decision: 'applied',
      pins: new Map([['comfyui-frontend-package', '1.55.19']])
    })
    expect(calls).toEqual([
      {
        content: `${CORE_FILE}comfyui-frontend-package==1.55.19\n`,
        constraints: 'requests==2.32.0\n'
      }
    ])
  })

  it('installs a comfy-agent-go pin on its own line, holding everything else', async () => {
    const sendOutput = vi.fn()
    const go = { 'comfy-agent-go': '0.2.3' }
    const decision = await installAgentRequirements(plan, sendOutput, undefined, go)

    expect(decision).toMatchObject({
      decision: 'applied',
      pins: new Map([['comfy-agent-go', '0.2.3']])
    })
    expect(calls).toEqual([
      {
        content: 'comfy-cli==1.21.0\ncomfy-agent-go==0.2.3\n',
        constraints: 'requests==2.32.0\n'
      }
    ])
    expect(sendOutput.mock.calls.join('')).not.toContain('bundled agent')
  })

  it("keeps a working agent when a Go pin alone meets core's placeholder agent line", async () => {
    fs.writeFileSync(plan.reqPath, 'comfy-agent==0.0.0.dev0\n')
    mockUvPip.mockResolvedValue({
      code: 0,
      output: JSON.stringify([
        { name: 'comfy-agent', version: '0.1.0rc2' },
        { name: 'comfy-agent-go', version: '0.1.0rc2' }
      ])
    })
    const go = { 'comfy-agent-go': '0.1.0rc3' }
    const decision = await installAgentRequirements(plan, vi.fn(), undefined, go)

    expect(decision).toMatchObject({ decision: 'applied' })
    expect(calls).toEqual([{ content: 'comfy-agent-go==0.1.0rc3\n', constraints: '\n' }])
  })

  it('installs a comfy-agent-go pin together with an agent pin', async () => {
    const both = { 'comfy-agent': '0.2.3', 'comfy-agent-go': '0.2.3' }
    const decision = await installAgentRequirements(plan, vi.fn(), undefined, both)

    expect(decision).toMatchObject({ decision: 'applied' })
    expect(calls).toEqual([
      {
        content: 'comfy-agent==0.2.3\ncomfy-cli==1.21.0\ncomfy-agent-go==0.2.3\n',
        constraints: 'requests==2.32.0\n'
      }
    ])
  })

  it('installs a comfy-agent-go older than the agent, saying the agent will run its bundled one', async () => {
    const sendOutput = vi.fn()
    const old = { 'comfy-agent-go': '0.1.9' }
    const decision = await installAgentRequirements(plan, sendOutput, undefined, old)

    expect(decision).toMatchObject({ decision: 'applied' })
    expect(calls[0]!.content).toBe('comfy-cli==1.21.0\ncomfy-agent-go==0.1.9\n')
    expect(sendOutput.mock.calls.join('')).toContain(
      '⚠ comfy-agent-go 0.1.9 is older than comfy-agent 0.2.0; the agent will run its bundled agent, not the Go one'
    )
  })

  it("applies a Go pin on the same launch once core's file is in, and warns once it is", async () => {
    mockUvPip
      .mockResolvedValueOnce({
        code: 0,
        output: JSON.stringify([{ name: 'comfy-agent', version: '0.2.0' }])
      })
      .mockResolvedValueOnce({ code: 0, output: INSTALLED })
    const sendOutput = vi.fn()
    const old = { 'comfy-agent-go': '0.1.9' }
    const decision = await installAgentRequirements(plan, sendOutput, undefined, old)

    expect(decision).toMatchObject({
      decision: 'applied',
      pins: new Map([['comfy-agent-go', '0.1.9']])
    })
    expect(calls).toEqual([
      { content: CORE_FILE, constraints: null },
      {
        content: 'comfy-cli==1.21.0\ncomfy-agent-go==0.1.9\n',
        constraints: 'requests==2.32.0\n'
      }
    ])
    expect(
      sendOutput.mock.calls.join('').split('is older than comfy-agent 0.2.0').length - 1,
      'warned once, after the install, not on the attempt that waited for core'
    ).toBe(1)
  })

  it('says nothing about the Go carrier when the override is not cached yet', async () => {
    respond = ({ constraints }) => ({ code: constraints === null ? 0 : 2, output: '' })
    const sendOutput = vi.fn()
    const old = { 'comfy-agent-go': '0.1.9' }
    const decision = await installAgentRequirements(plan, sendOutput, undefined, old)

    expect(decision).toMatchObject({ decision: 'deferred', reason: 'not_cached' })
    expect(calls.at(-1), "core's file follows").toEqual({ content: CORE_FILE, constraints: null })
    expect(sendOutput.mock.calls.join('')).not.toContain('bundled agent')
  })

  it("lists the install's own environment as JSON, from the install dir", async () => {
    await installAgentRequirements(plan, vi.fn(), undefined, OVERRIDE)

    expect(mockUvPip).toHaveBeenCalledWith(
      '/uv',
      ['pip', 'list', '--format', 'json', '--python', '/py'],
      installDir,
      expect.any(Function),
      expect.any(AbortSignal),
      expect.any(Function)
    )
  })

  it('adds nothing to the override run but the constraints, and keeps the mirrors', async () => {
    await installAgentRequirements(plan, vi.fn(), undefined, OVERRIDE)

    const [offline, resolve] = mockInstall.mock.calls
    expect(offline![8], 'the cache goes first').toEqual([
      '--offline',
      '--dry-run',
      '--constraint',
      expect.stringMatching(/^\.launch-agent-reqs-override-[\w-]+-constraints\.txt$/)
    ])
    expect(resolve![7], "the user's mirror setting still applies").toBe(mirrors)
    expect(resolve![8], 'the network try resolves under the same constraints').toEqual([
      '--dry-run',
      '--constraint',
      expect.stringMatching(/^\.launch-agent-fetch-[\w-]+-constraints\.txt$/)
    ])
  })

  it('stops waiting on the package listing as soon as the launch is cancelled', async () => {
    const abort = new AbortController()
    let listing: AbortSignal | undefined
    mockUvPip.mockImplementationOnce((...args) => {
      listing = args[4]
      queueMicrotask(() => abort.abort())
      return new Promise(() => {})
    })

    await installAgentRequirements(plan, vi.fn(), abort.signal, OVERRIDE)

    expect(calls).toEqual([])
    expect(listing?.aborted, 'the uv pip list process is told to stop too').toBe(true)
  })

  it("leaves a fresh install to core's file, refusing without a failure to count", async () => {
    mockUvPip.mockResolvedValue({
      code: 0,
      output: JSON.stringify([{ name: 'comfy-cli', version: '1.21.0' }])
    })
    const sendOutput = vi.fn()

    const decision = await installAgentRequirements(plan, sendOutput, undefined, OVERRIDE)

    expect(decision).toEqual({
      decision: 'refused',
      reason: 'core_first',
      pins: new Map([['comfy-agent', '0.2.3']])
    })
    expect(calls, 'only core file runs').toEqual([{ content: CORE_FILE, constraints: null }])
    expect(sendOutput.mock.calls.join('')).toContain(
      "refused (core_first); using ComfyUI's versions"
    )
  })

  it("applies the override on the same launch once core's file has installed its packages", async () => {
    mockUvPip
      .mockResolvedValueOnce({
        code: 0,
        output: JSON.stringify([{ name: 'requests', version: '2.32.0' }])
      })
      .mockResolvedValueOnce({ code: 0, output: INSTALLED })

    const decision = await installAgentRequirements(plan, vi.fn(), undefined, OVERRIDE)

    expect(decision).toMatchObject({
      decision: 'applied',
      pins: new Map([['comfy-agent', '0.2.3']])
    })
    expect(calls, "core's file, then the override constrained by what it installed").toEqual([
      { content: CORE_FILE, constraints: null },
      { content: 'comfy-agent==0.2.3\ncomfy-cli==1.21.0\n', constraints: 'requests==2.32.0\n' }
    ])
  })

  it('defers a same-launch override that is not cached, with nothing to put back', async () => {
    mockUvPip
      .mockResolvedValueOnce({
        code: 0,
        output: JSON.stringify([{ name: 'requests', version: '2.32.0' }])
      })
      .mockResolvedValueOnce({ code: 0, output: INSTALLED })
    respond = (call) => ({ code: call.constraints === null ? 0 : 2, output: '' })

    const decision = await installAgentRequirements(plan, vi.fn(), undefined, OVERRIDE)

    expect(decision).toMatchObject({ decision: 'deferred', reason: 'not_cached' })
    expect(
      calls.map((c) => c.constraints !== null),
      'a cache-only install that failed moved nothing, so core file does not run again'
    ).toEqual([false, true])
  })

  it("does not try the override when core's file fails on a fresh install", async () => {
    mockUvPip.mockResolvedValue({
      code: 0,
      output: JSON.stringify([{ name: 'requests', version: '2.32.0' }])
    })
    respond = () => ({ code: 2, output: '' })

    const decision = await installAgentRequirements(plan, vi.fn(), undefined, OVERRIDE)

    expect(decision, 'not counted toward retiring the override').toMatchObject({
      decision: 'refused',
      reason: 'core_first'
    })
    expect(calls).toEqual([{ content: CORE_FILE, constraints: null }])
  })

  it('falls back to core file when the override files cannot be written', async () => {
    plan.installPath = path.join(installDir, 'missing')

    const decision = await installAgentRequirements(plan, vi.fn(), undefined, OVERRIDE)

    expect(decision, 'an install dir that is gone makes the override write fail').toMatchObject({
      decision: 'reverted',
      reason: 'install_failed'
    })
    expect(
      mockInstall.mock.calls.map(([, , , , , , , , extraArgs]) => extraArgs),
      "core file's own cache check still runs, and finds nothing to install"
    ).toEqual([['--offline', '--dry-run']])
    expect(calls, 'the network try cannot write its scratch files there either').toEqual([])
  })

  it('says nothing about a fallback when the launch is cancelled during the override install', async () => {
    const abort = new AbortController()
    const sendOutput = vi.fn()
    respond = ({ constraints }) => {
      if (constraints) abort.abort()
      return { code: 1, output: '' }
    }

    await installAgentRequirements(plan, sendOutput, abort.signal, OVERRIDE)

    expect(sendOutput.mock.calls.join('')).not.toContain('not downloaded yet')
  })

  it("falls back to core file when core's file cannot be read for the override", async () => {
    const read = vi.spyOn(fs.promises, 'readFile').mockRejectedValueOnce(new Error('EIO'))

    const decision = await installAgentRequirements(plan, vi.fn(), undefined, OVERRIDE)
    read.mockRestore()

    expect(decision).toMatchObject({ decision: 'refused', reason: 'check_failed' })
    expect(calls).toEqual([{ content: CORE_FILE, constraints: null }])
  })

  it('gives each attempt its own files, so two sessions of one install cannot collide', async () => {
    const names = (): Set<string> =>
      new Set(
        mockInstall.mock.calls
          .map((args) => args[8] as string[])
          .filter((extraArgs) => extraArgs.includes('--constraint'))
          .map((extraArgs) => extraArgs[extraArgs.indexOf('--constraint') + 1]!)
      )
    await installAgentRequirements(plan, vi.fn(), undefined, OVERRIDE)
    const first = names()
    mockInstall.mockClear()
    fetched.clear()
    await installAgentRequirements(plan, vi.fn(), undefined, OVERRIDE)
    const second = names()

    expect(first.size, "the override's own file, and the network try's").toBe(2)
    expect(second.size).toBe(2)
    expect(
      [...first].filter((name) => second.has(name)),
      'no file is shared'
    ).toEqual([])
  })

  it('lists nothing for a launch that was cancelled before the override began', async () => {
    const abort = new AbortController()
    abort.abort()

    await installAgentRequirements(plan, vi.fn(), abort.signal, OVERRIDE)

    expect(mockUvPip).not.toHaveBeenCalled()
  })

  it('starts no install when the launch is cancelled while the packages are listed', async () => {
    const abort = new AbortController()
    const sendOutput = vi.fn()
    let listed = (): void => {}
    mockUvPip.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          listed = () => resolve({ code: 0, output: INSTALLED })
        })
    )
    const pending = installAgentRequirements(plan, sendOutput, abort.signal, OVERRIDE)
    await vi.waitFor(() => expect(mockUvPip).toHaveBeenCalled())

    abort.abort()
    listed()
    await pending
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(calls, 'a listing that answers after the cancel must not lead to an install').toEqual([])
    expect(sendOutput.mock.calls.join('')).not.toContain('Applying agent version override')
  })

  it("passes the constraints relative to the install dir, which is uv's cwd", async () => {
    await installAgentRequirements(plan, vi.fn(), undefined, OVERRIDE)

    const extraArgs = mockInstall.mock.calls[1]![8] as string[]
    const constraint = extraArgs[extraArgs.indexOf('--constraint') + 1]!
    expect(path.isAbsolute(constraint), 'uv splits an absolute --constraint on spaces').toBe(false)
    expect(mockInstall.mock.calls[0]![3]).toBe(installDir)
  })

  it('leaves no overridden copy or constraints behind', async () => {
    await installAgentRequirements(plan, vi.fn(), undefined, OVERRIDE)

    await vi.waitFor(() => expect(fs.readdirSync(installDir)).toEqual(['ComfyUI']))
  })

  it('installs core file alone, exactly as before, when there is no override', async () => {
    const decision = await installAgentRequirements(plan, vi.fn())

    expect(decision).toBeUndefined()
    expect(calls).toEqual([{ content: CORE_FILE, constraints: null }])
    expect(mockUvPip).not.toHaveBeenCalled()
  })

  it('refuses an invalid payload and installs core file', async () => {
    const decision = await installAgentRequirements(plan, vi.fn(), undefined, {
      'comfy-agent': '0.2.3 --index-url https://evil.example/simple'
    })

    expect(decision).toEqual({ decision: 'refused', reason: 'bad_version' })
    expect(calls).toEqual([{ content: CORE_FILE, constraints: null }])
  })

  it('refuses an override of a package core pins by a range', async () => {
    fs.writeFileSync(plan.reqPath, 'comfy-agent>=0.1\ncomfy-cli==1.21.0\n')

    const decision = await installAgentRequirements(plan, vi.fn(), undefined, OVERRIDE)

    expect(decision).toMatchObject({ decision: 'refused', reason: 'unsupported_line' })
    expect(calls.map((c) => c.content)).toEqual(['comfy-agent>=0.1\ncomfy-cli==1.21.0\n'])
  })

  it('installs the pin in place of a line core left unpinned', async () => {
    fs.writeFileSync(plan.reqPath, 'comfy-agent\ncomfy-cli==1.21.0\n')

    const decision = await installAgentRequirements(plan, vi.fn(), undefined, OVERRIDE)

    expect(decision).toMatchObject({ decision: 'applied' })
    expect(calls.map((c) => c.content)).toEqual(['comfy-agent==0.2.3\ncomfy-cli==1.21.0\n'])
  })

  it('rolls a package core left unpinned back below the installed version', async () => {
    fs.writeFileSync(plan.reqPath, 'comfy-agent\ncomfy-cli==1.21.0\n')

    const decision = await installAgentRequirements(plan, vi.fn(), undefined, {
      'comfy-agent': '0.1.0'
    })

    expect(decision).toMatchObject({ decision: 'applied' })
    expect(calls).toEqual([
      { content: 'comfy-agent==0.1.0\ncomfy-cli==1.21.0\n', constraints: 'requests==2.32.0\n' }
    ])
  })

  it('still waits for core to install a package it left unpinned', async () => {
    fs.writeFileSync(plan.reqPath, 'comfy-agent\ncomfy-cli==1.21.0\n')
    mockUvPip.mockResolvedValue({
      code: 0,
      output: JSON.stringify([{ name: 'comfy-cli', version: '1.21.0' }])
    })

    const decision = await installAgentRequirements(plan, vi.fn(), undefined, OVERRIDE)

    expect(decision).toMatchObject({ decision: 'refused', reason: 'core_first' })
    expect(calls.map((c) => c.content)).toEqual(['comfy-agent\ncomfy-cli==1.21.0\n'])
  })

  it('refuses when the installed packages cannot be listed', async () => {
    for (const listed of [
      { code: 2, output: 'error: no virtual environment found' },
      { code: 0, output: 'not json' }
    ]) {
      calls = []
      fetched.clear()
      mockUvPip.mockResolvedValueOnce(listed)

      const decision = await installAgentRequirements(plan, vi.fn(), undefined, OVERRIDE)

      expect(decision).toMatchObject({ decision: 'refused', reason: 'check_failed' })
      expect(calls).toEqual([{ content: CORE_FILE, constraints: null }])
    }
  })

  it('falls back to core file when an epoch pin is not cached', async () => {
    respond = ({ constraints }) => (constraints ? { code: 2, output: '' } : { code: 0, output: '' })

    const decision = await installAgentRequirements(plan, vi.fn(), undefined, {
      'comfy-agent': '1!0.2.3'
    })

    expect(decision).toMatchObject({
      decision: 'deferred',
      reason: 'not_cached',
      pins: new Map([['comfy-agent', '1!0.2.3']])
    })
    expect(calls.map((c) => c.content)).toEqual([
      'comfy-agent==1!0.2.3\ncomfy-cli==1.21.0\n',
      CORE_FILE
    ])
  })

  it('falls back to core file when the override cannot install in time, and says so once', async () => {
    respond = ({ constraints }) => (constraints ? { code: 2, output: '' } : { code: 0, output: '' })
    const sendOutput = vi.fn()

    const decision = await installAgentRequirements(
      plan,
      sendOutput,
      undefined,
      OVERRIDE,
      null,
      vi.fn()
    )

    expect(decision).toMatchObject({ decision: 'deferred', reason: 'not_cached' })
    expect(calls.map((c) => c.constraints === null)).toEqual([false, true])
    expect(calls[1]!.content).toBe(CORE_FILE)
    expect(
      sendOutput.mock.calls
        .join('')
        .split('newer version in the background; it applies on the next launch'),
      "core's file is in, so the agent starts now and only the newer version waits"
    ).toHaveLength(2)
  })

  it('installs core file for a version this install already gave up on', async () => {
    const state = { signature: 'comfy-agent==0.2.3', failures: 2 }

    const decision = await installAgentRequirements(plan, vi.fn(), undefined, OVERRIDE, state)

    expect(decision).toMatchObject({ decision: 'reverted', reason: 'previously_failed' })
    expect(calls).toEqual([{ content: CORE_FILE, constraints: null }])
  })

  it("says ComfyUI's versions follow a reverted override of pinned lines", async () => {
    const sendOutput = vi.fn()

    const decision = await installAgentRequirements(plan, sendOutput, undefined, OVERRIDE, {
      signature: 'comfy-agent==0.2.3',
      failures: 2
    })

    expect(decision).not.toHaveProperty('staysInstalled')
    expect(sendOutput.mock.calls.join('')).toContain("failed before; using ComfyUI's versions")
    expect(mockUvPip).not.toHaveBeenCalled()
  })

  it("names only the reverted pins ComfyUI can't take back, from the record", async () => {
    fs.writeFileSync(plan.reqPath, 'comfy-agent\ncomfy-cli==1.21.0\n')
    const sendOutput = vi.fn()
    const both = { 'comfy-agent': '0.2.3', 'comfy-cli': '1.22.0' }

    const decision = await installAgentRequirements(plan, sendOutput, undefined, both, {
      signature: 'comfy-agent==0.2.3,comfy-cli==1.22.0',
      failures: 2
    })

    expect(decision).toMatchObject({
      decision: 'reverted',
      reason: 'previously_failed',
      staysInstalled: new Map([['comfy-agent', '0.2.3']])
    })
    expect(sendOutput.mock.calls.join('')).toContain(
      "failed before; ComfyUI's requirements don't pin comfy-agent, so they can't take comfy-agent==0.2.3 back if it went in"
    )
    expect(mockUvPip, 'the version comes from the record, not a listing').not.toHaveBeenCalled()
  })

  it("says ComfyUI's versions follow a reverted override when its file can't be read", async () => {
    const read = vi.spyOn(fs.promises, 'readFile').mockRejectedValueOnce(new Error('EIO'))

    const decision = await installAgentRequirements(plan, vi.fn(), undefined, OVERRIDE, {
      signature: 'comfy-agent==0.2.3',
      failures: 2
    })
    read.mockRestore()

    expect(decision).toEqual({
      decision: 'reverted',
      reason: 'previously_failed',
      pins: new Map([['comfy-agent', '0.2.3']])
    })
    expect(calls).toEqual([{ content: CORE_FILE, constraints: null }])
  })

  it('tries a new version even after an earlier one was reverted', async () => {
    const state = { signature: 'comfy-agent==0.2.3', failures: 2 }

    const decision = await installAgentRequirements(
      plan,
      vi.fn(),
      undefined,
      { 'comfy-agent': '0.2.4' },
      state
    )

    expect(decision?.decision).toBe('applied')
  })

  it('starts no fallback when the launch is cancelled during the override', async () => {
    const abort = new AbortController()
    mockUvPip.mockImplementationOnce(async () => {
      abort.abort()
      return { code: 1, output: '' }
    })

    await installAgentRequirements(plan, vi.fn(), abort.signal, OVERRIDE)

    expect(calls, 'a cancelled launch installs nothing more').toEqual([])
  })

  it('says the fallback follows when the override is not cached', async () => {
    respond = ({ constraints }) => (constraints ? { code: 2, output: '' } : { code: 0, output: '' })
    const sendOutput = vi.fn()

    await installAgentRequirements(plan, sendOutput, undefined, OVERRIDE)

    expect(sendOutput.mock.calls.join('')).toContain(
      "is not downloaded yet; using ComfyUI's versions"
    )
  })

  describe('handing a cache miss to the background download', () => {
    it("hands over core file, then the override, when core's packages are not in yet", async () => {
      mockUvPip.mockResolvedValue({
        code: 0,
        output: JSON.stringify([{ name: 'requests', version: '2.32.0' }])
      })
      respond = () => ({ code: 2, output: '' })
      const onDeferred = vi.fn()

      const decision = await installAgentRequirements(
        plan,
        vi.fn(),
        undefined,
        OVERRIDE,
        null,
        onDeferred
      )

      expect(decision).toMatchObject({ decision: 'refused', reason: 'core_first' })
      expect(onDeferred).toHaveBeenCalledTimes(1)
      expect(onDeferred).toHaveBeenCalledWith(
        {
          plan,
          steps: [
            { text: CORE_FILE },
            { text: 'comfy-agent==0.2.3\ncomfy-cli==1.21.0\n', constraints: 'requests==2.32.0\n' }
          ],
          signature: 'comfy-agent==0.2.3'
        },
        'agent'
      )
    })

    it('hands over one download when both the override and core file miss', async () => {
      respond = () => ({ code: 2, output: '' })
      const onDeferred = vi.fn()

      await installAgentRequirements(plan, vi.fn(), undefined, OVERRIDE, null, onDeferred)

      expect(onDeferred).toHaveBeenCalledTimes(1)
      expect(onDeferred.mock.calls[0]![0]).toMatchObject({ signature: 'comfy-agent==0.2.3' })
    })

    it("hands over core file's own text when there is no override", async () => {
      respond = () => ({ code: 2, output: '' })
      const onDeferred = vi.fn()

      await installAgentRequirements(plan, vi.fn(), undefined, undefined, null, onDeferred)

      expect(onDeferred).toHaveBeenCalledWith(
        { plan, steps: [{ text: CORE_FILE }], signature: 'core' },
        'agent'
      )
    })

    it.each([
      ['agent', 'only the placeholder release', 'comfy-agent==0.0.0.dev0\n', '0.1.0rc2'],
      ['update', 'a real release', CORE_FILE, '0.2.0']
    ])(
      "hands a deferred override over as '%s' when core's file pins %s",
      async (deferral, _label, coreFile, installedAgent) => {
        fs.writeFileSync(plan.reqPath, coreFile)
        mockUvPip.mockResolvedValue({
          code: 0,
          output: JSON.stringify([
            { name: 'comfy-agent', version: installedAgent },
            { name: 'comfy-cli', version: '1.21.0' }
          ])
        })
        respond = () => ({ code: 2, output: '' })
        const onDeferred = vi.fn()

        await installAgentRequirements(plan, vi.fn(), undefined, OVERRIDE, null, onDeferred)

        expect(onDeferred).toHaveBeenCalledTimes(1)
        expect(onDeferred.mock.calls[0]![1], 'no agent runs on the placeholder release').toBe(
          deferral
        )
      }
    )

    it('hands over nothing when everything installs from the cache', async () => {
      const onDeferred = vi.fn()

      await installAgentRequirements(plan, vi.fn(), undefined, OVERRIDE, null, onDeferred)

      expect(onDeferred).not.toHaveBeenCalled()
    })

    it('hands over nothing for a launch cancelled during the install', async () => {
      const abort = new AbortController()
      respond = () => {
        abort.abort()
        return { code: 2, output: '' }
      }
      const onDeferred = vi.fn()

      await installAgentRequirements(plan, vi.fn(), abort.signal, OVERRIDE, null, onDeferred)

      expect(onDeferred).not.toHaveBeenCalled()
    })

    it("carries uv's exit and error on a deferred decision", async () => {
      respond = ({ constraints }) =>
        constraints
          ? {
              code: 2,
              output: `Using Python 3.12 environment at: ${installDir}/ComfyUI/.venv\nerror: Failed to fetch: \`https://mirror.example/simple/comfy-agent/\`\n`
            }
          : { code: 0, output: '' }

      vi.useFakeTimers({ toFake: ['Date'] })
      const decision = await installAgentRequirements(plan, vi.fn(), undefined, OVERRIDE).finally(
        () => vi.useRealTimers()
      )

      expect(decision, 'a frozen clock leaves the network try the whole budget').toMatchObject({
        decision: 'deferred',
        install: {
          outcome: 'exited',
          exitCode: 2,
          budgetMs: 20_000,
          errorTail: 'error: Failed to fetch: `<url>'
        }
      })
    })

    it('defers a download uv 0.11 cut short, though it exits 1 like no solution', async () => {
      respond = ({ constraints }) =>
        constraints
          ? {
              code: 1,
              output:
                '  × Failed to download `comfy-agent==0.2.3`\n  ├─▶ error sending request for url\n  ╰─▶ Connection refused (os error 111)\n'
            }
          : { code: 0, output: '' }
      const onDeferred = vi.fn()

      const decision = await installAgentRequirements(
        plan,
        vi.fn(),
        undefined,
        OVERRIDE,
        null,
        onDeferred
      )

      expect(decision).toMatchObject({ decision: 'deferred', reason: 'not_cached' })
      expect(onDeferred).toHaveBeenCalledWith(expect.anything(), 'update')
    })

    it('retires an override with no solution even when a name in it reads like a download error', async () => {
      respond = ({ constraints }) =>
        constraints
          ? {
              code: 1,
              output:
                'error: No solution found when resolving dependencies\n  cause: Because there is no version of comfy-connector==9.9.9 and you require comfy-connector==9.9.9, we can conclude that your requirements are unsatisfiable.\n'
            }
          : { code: 0, output: '' }

      expect(await installAgentRequirements(plan, vi.fn(), undefined, OVERRIDE)).toMatchObject({
        decision: 'reverted',
        reason: 'install_failed'
      })
    })

    it('retires a local failure even when uv mentioned a connection before it', async () => {
      respond = ({ constraints }) =>
        constraints
          ? {
              code: 2,
              output:
                'Resolved 61 packages, reusing the connection pool\nerror: failed to remove file `x.pyd`: Access is denied. (os error 5)\n'
            }
          : { code: 0, output: '' }

      expect(
        await installAgentRequirements(plan, vi.fn(), undefined, OVERRIDE),
        "only uv's error decides, not lines it printed before it"
      ).toMatchObject({ decision: 'reverted', reason: 'install_failed' })
    })

    it("defers a download failure whose cause comes after 500 characters of uv's error", async () => {
      respond = ({ constraints }) =>
        constraints
          ? {
              code: 1,
              output: `error: Failed to build \`comfy-agent\`\n${'  ╰─▶ backend frame\n'.repeat(40)}  ╰─▶ Connection refused (os error 111)\n`
            }
          : { code: 0, output: '' }

      expect(
        await installAgentRequirements(plan, vi.fn(), undefined, OVERRIDE),
        "the telemetry tail is cut at 500 characters; the decision reads all of uv's error"
      ).toMatchObject({ decision: 'deferred' })
    })

    it.each(['connecting', 'reconnect', 'disconnected', 'connections'])(
      'defers a failure uv describes as %s',
      async (word) => {
        respond = ({ constraints }) =>
          constraints
            ? { code: 2, output: `error: the index went away while ${word}\n` }
            : { code: 0, output: '' }

        expect(await installAgentRequirements(plan, vi.fn(), undefined, OVERRIDE)).toMatchObject({
          decision: 'deferred'
        })
      }
    )

    it('retires a local failure on a path that names a package like connectorx', async () => {
      respond = ({ constraints }) =>
        constraints
          ? {
              code: 2,
              output:
                'error: failed to remove file `site-packages/connectorx/x.pyd`: Access is denied. (os error 5)\n'
            }
          : { code: 0, output: '' }

      expect(await installAgentRequirements(plan, vi.fn(), undefined, OVERRIDE)).toMatchObject({
        decision: 'reverted',
        reason: 'install_failed'
      })
    })

    it('retires an override that fails on something no download fixes', async () => {
      respond = ({ constraints }) =>
        constraints
          ? {
              code: 2,
              output: 'error: failed to remove file `x.pyd`: Access is denied. (os error 5)\n'
            }
          : { code: 0, output: '' }
      const onDeferred = vi.fn()

      const decision = await installAgentRequirements(
        plan,
        vi.fn(),
        undefined,
        OVERRIDE,
        null,
        onDeferred
      )

      expect(decision).toMatchObject({ decision: 'reverted', reason: 'install_failed' })
      expect(onDeferred).not.toHaveBeenCalled()
    })

    it('defers a failure uv says nothing about', async () => {
      respond = ({ constraints }) =>
        constraints ? { code: 2, output: '' } : { code: 0, output: '' }

      expect(await installAgentRequirements(plan, vi.fn(), undefined, OVERRIDE)).toMatchObject({
        decision: 'deferred'
      })
    })

    it('retires an override uv proved unsatisfiable, and hands nothing over for it', async () => {
      respond = ({ constraints }) =>
        constraints
          ? { code: 1, output: 'error: No solution found when resolving dependencies\n' }
          : { code: 0, output: '' }
      const onDeferred = vi.fn()

      const decision = await installAgentRequirements(
        plan,
        vi.fn(),
        undefined,
        OVERRIDE,
        null,
        onDeferred
      )

      expect(decision).toMatchObject({
        decision: 'reverted',
        reason: 'install_failed',
        install: {
          exitCode: 1,
          errorTail: 'error: No solution found when resolving dependencies'
        }
      })
      expect(onDeferred).not.toHaveBeenCalled()
    })

    it('defers, never retires, an override whose cache-only try found no solution when the network has nothing to fetch', async () => {
      mockInstall.mockImplementation(async (_file, ...rest) => {
        const extraArgs = rest[7] as string[]
        if (extraArgs.includes('--dry-run')) return { code: 0, output: '' }
        if (extraArgs.includes('--constraint'))
          return { code: 1, output: 'error: No solution found when resolving dependencies\n' }
        return { code: 0, output: '' }
      })
      const onDeferred = vi.fn()

      const decision = await installAgentRequirements(
        plan,
        vi.fn(),
        undefined,
        OVERRIDE,
        null,
        onDeferred
      )

      expect(
        decision,
        'a cache miss reads as no solution, and a dry-run that adds nothing does not make it a proof'
      ).toMatchObject({ decision: 'deferred', reason: 'not_cached' })
      expect(onDeferred).toHaveBeenCalledTimes(1)
      expect(
        await installAgentRequirements(plan, vi.fn(), undefined, OVERRIDE, {
          signature: 'comfy-agent==0.2.3',
          failures: 1
        }),
        'one failure already counted: a second counted one would retire it'
      ).toMatchObject({ decision: 'deferred', reason: 'not_cached' })
    })

    it('puts core file back from the cache only after a same-launch retry that was retired', async () => {
      mockUvPip
        .mockResolvedValueOnce({
          code: 0,
          output: JSON.stringify([{ name: 'requests', version: '2.32.0' }])
        })
        .mockResolvedValueOnce({ code: 0, output: INSTALLED })
      const tries: { core: boolean; offline: boolean }[] = []
      let coreFetched = false
      mockInstall.mockImplementation(async (_file, ...rest) => {
        const extraArgs = rest[7] as string[]
        if (extraArgs.includes('--target')) {
          coreFetched = true
          return { code: 0, output: '' }
        }
        const core = !extraArgs.includes('--constraint')
        const offline = extraArgs.includes('--offline')
        tries.push({ core, offline })
        if (!core) {
          return offline
            ? { code: 1, output: '' }
            : { code: 1, output: 'error: No solution found when resolving dependencies\n' }
        }
        if (offline) return { code: coreFetched ? 0 : 1, output: '' }
        return { code: 0, output: ' + comfy-agent==0.2.0\n' }
      })

      const decision = await installAgentRequirements(
        plan,
        vi.fn(),
        undefined,
        OVERRIDE,
        null,
        vi.fn()
      )

      expect(decision).toMatchObject({ decision: 'reverted', reason: 'install_failed' })
      const lastOverride = tries.map((t) => t.core).lastIndexOf(false)
      expect(
        tries.slice(lastOverride + 1),
        'core file again from the cache only, its check and then its install, never the network'
      ).toEqual([
        { core: true, offline: true },
        { core: true, offline: true }
      ])
    })

    it('puts core file back from the cache after a same-launch retry that did not go in', async () => {
      mockUvPip
        .mockResolvedValueOnce({
          code: 0,
          output: JSON.stringify([{ name: 'requests', version: '2.32.0' }])
        })
        .mockResolvedValueOnce({ code: 0, output: INSTALLED })
      const tries: string[][] = []
      let coreFetched = false
      mockInstall.mockImplementation(async (_file, ...rest) => {
        const extraArgs = rest[7] as string[]
        if (extraArgs.includes('--target')) {
          coreFetched = true
          return { code: 0, output: '' }
        }
        tries.push(extraArgs)
        if (extraArgs.includes('--constraint')) return { code: 2, output: '' }
        if (extraArgs.includes('--offline')) return { code: coreFetched ? 0 : 2, output: '' }
        return { code: 0, output: ' + comfy-agent==0.2.0\n' }
      })

      const decision = await installAgentRequirements(
        plan,
        vi.fn(),
        undefined,
        OVERRIDE,
        null,
        vi.fn()
      )

      expect(decision).toMatchObject({ decision: 'deferred' })
      expect(tries.at(-1), 'core file again, from the cache only').toEqual(['--offline'])
    })

    it('defers, never retires, an override whose cache-only try found no solution and whose network try ran out', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
      try {
        mockInstall.mockImplementation(async (_file, ...rest) => {
          const extraArgs = rest[7] as string[]
          if (extraArgs.includes('--offline'))
            return { code: 1, output: 'error: No solution found\n' }
          const signal = rest[5] as AbortSignal
          return new Promise((resolve) =>
            signal.addEventListener('abort', () => resolve({ code: 1, output: '' }))
          )
        })

        const pending = installAgentRequirements(plan, vi.fn(), undefined, OVERRIDE, null, vi.fn())
        let done = false
        void pending.then(() => (done = true))
        while (!done) {
          await new Promise((resolve) => setImmediate(resolve))
          await vi.advanceTimersToNextTimerAsync()
        }

        expect(
          await pending,
          'exit 1 from a cache-only try is a miss, not a proof: uv never saw the index'
        ).toMatchObject({ decision: 'deferred', reason: 'not_cached' })
      } finally {
        vi.useRealTimers()
      }
    })

    it('gives a second network try only what the first left of the budget', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
      try {
        const budgets: number[] = []
        mockInstall.mockImplementation(async (_file, ...rest) => {
          const extraArgs = rest[7] as string[]
          if (extraArgs.includes('--offline')) return { code: 1, output: '' }
          const signal = rest[5] as AbortSignal
          const startedAt = Date.now()
          if (extraArgs.includes('--constraint')) {
            return new Promise((resolve) =>
              setTimeout(() => resolve({ code: 2, output: '' }), 5_000)
            )
          }
          return new Promise((resolve) =>
            signal.addEventListener('abort', () => {
              budgets.push(Date.now() - startedAt)
              resolve({ code: 2, output: '' })
            })
          )
        })

        const pending = installAgentRequirements(plan, vi.fn(), undefined, OVERRIDE, null, vi.fn())
        let done = false
        void pending.then(() => (done = true))
        while (!done) {
          await new Promise((resolve) => setImmediate(resolve))
          await vi.advanceTimersToNextTimerAsync()
        }

        expect(budgets).toEqual([15_000])
      } finally {
        vi.useRealTimers()
      }
    })

    it('gives the network one shared budget, so a slow first try leaves the rest none', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
      try {
        const budgets: number[] = []
        mockInstall.mockImplementation(async (_file, ...rest) => {
          const extraArgs = rest[7] as string[]
          if (extraArgs.includes('--offline')) return { code: 1, output: '' }
          const signal = rest[5] as AbortSignal
          const startedAt = Date.now()
          return new Promise((resolve) =>
            signal.addEventListener('abort', () => {
              budgets.push(Date.now() - startedAt)
              resolve({ code: 1, output: '' })
            })
          )
        })
        const onDeferred = vi.fn()

        const pending = installAgentRequirements(
          plan,
          vi.fn(),
          undefined,
          OVERRIDE,
          null,
          onDeferred
        )
        let done = false
        void pending.then(() => (done = true))
        while (!done) {
          await new Promise((resolve) => setImmediate(resolve))
          await vi.advanceTimersToNextTimerAsync()
        }
        const decision = await pending

        expect(budgets, 'the override took it all; core file gets no network try').toEqual([20_000])
        expect(decision).toMatchObject({ decision: 'deferred', install: { outcome: 'timed_out' } })
        expect(onDeferred).toHaveBeenCalledTimes(1)
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('the bounds', () => {
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
        const extraArgs = rest[7] as string[]
        if (extraArgs.includes('--offline')) return { code: 1, output: '' }
        calls.push({
          content: fs.readFileSync(file, 'utf-8'),
          constraints: extraArgs.includes('--constraint') ? 'yes' : null
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

    it('stops a stuck cache-only install at 120 s, then tries the network', async () => {
      const startedAt = Date.now()
      const stopped: number[] = []
      mockInstall.mockImplementation(async (_file, ...rest) => {
        const signal = rest[5] as AbortSignal
        const extraArgs = rest[7] as string[]
        if (extraArgs.includes('--dry-run')) return { code: 0, output: ' + comfy-agent==0.2.3\n' }
        if (!extraArgs.includes('--offline') || stopped.length > 0) return { code: 0, output: '' }
        waiting++
        return new Promise((resolve) =>
          signal.addEventListener('abort', () => {
            waiting--
            stopped.push(Date.now() - startedAt)
            resolve({ code: 1, output: '' })
          })
        )
      })

      const decision = await settle(installAgentRequirements(plan, vi.fn(), undefined, OVERRIDE))

      expect(stopped, 'sized for writing the whole agent, not only a stuck uv').toEqual([120_000])
      expect(decision).toMatchObject({ decision: 'applied' })
    })

    it('installs what a quick download fetched on the same launch, held to the install bound and not the network budget', async () => {
      let downloaded = false
      mockInstall.mockImplementation(async (_file, ...rest) => {
        const signal = rest[5] as AbortSignal
        const extraArgs = rest[7] as string[]
        if (extraArgs.includes('--dry-run')) return { code: 0, output: ' + comfy-agent==0.2.3\n' }
        if (extraArgs.includes('--target')) {
          downloaded = true
          return { code: 0, output: '' }
        }
        if (!downloaded) return { code: 1, output: '' }
        waiting++
        return new Promise((resolve) => {
          const writing = setTimeout(() => {
            waiting--
            resolve({ code: 0, output: '' })
          }, 60_000)
          signal.addEventListener('abort', () => {
            clearTimeout(writing)
            waiting--
            resolve({ code: 1, output: '' })
          })
        })
      })

      const decision = await settle(installAgentRequirements(plan, vi.fn(), undefined, OVERRIDE))

      expect(
        decision,
        'a 60 s install from the cache outlasts the 20 s network budget but not its own 120 s bound'
      ).toMatchObject({ decision: 'applied' })
    })

    it.each([
      ['resolving', '--dry-run'],
      ['downloading', '--target']
    ])(
      'leaves the environment alone when the network budget runs out while %s',
      async (_stage, stuck) => {
        const seen: string[][] = []
        mockInstall.mockImplementation(async (_file, ...rest) => {
          const signal = rest[5] as AbortSignal
          const extraArgs = rest[7] as string[]
          seen.push(extraArgs)
          if (extraArgs.includes('--offline')) return { code: 1, output: '' }
          if (!extraArgs.includes(stuck)) return { code: 0, output: ' + comfy-agent==0.2.3\n' }
          waiting++
          return new Promise((resolve) =>
            signal.addEventListener('abort', () => {
              waiting--
              resolve({ code: 1, output: '' })
            })
          )
        })
        const onDeferred = vi.fn()

        const decision = await settle(
          installAgentRequirements(plan, vi.fn(), undefined, OVERRIDE, null, onDeferred)
        )

        expect(decision).toMatchObject({ decision: 'deferred', install: { outcome: 'timed_out' } })
        expect(onDeferred).toHaveBeenCalledTimes(1)
        expect(
          seen.filter(
            (args) => !['--dry-run', '--target', '--offline'].some((f) => args.includes(f))
          ),
          'only a resolve, a download into a scratch target, or an install from the cache ever runs'
        ).toEqual([])
      }
    )

    const fetchTimesOut = (stuck: '--dry-run' | '--target', cachedAfter: boolean) => {
      const retries: string[][] = []
      let stopped = false
      mockInstall.mockImplementation(async (_file, ...rest) => {
        const signal = rest[5] as AbortSignal
        const extraArgs = rest[7] as string[]
        if (extraArgs.includes('--offline')) {
          if (stopped && extraArgs.includes('--constraint')) retries.push(extraArgs)
          return { code: stopped && cachedAfter ? 0 : 1, output: '' }
        }
        if (!extraArgs.includes(stuck)) return { code: 0, output: ' + comfy-agent==0.2.3\n' }
        waiting++
        return new Promise((resolve) =>
          signal.addEventListener('abort', () => {
            waiting--
            stopped = true
            resolve({ code: 1, output: '' })
          })
        )
      })
      return retries
    }

    const downloadRunsOut = (
      afterStop: (extraArgs: string[], signal: AbortSignal) => Promise<UvResult> | UvResult
    ) => {
      const late: string[][] = []
      let stopped = false
      mockInstall.mockImplementation(async (_file, ...rest) => {
        const signal = rest[5] as AbortSignal
        const extraArgs = rest[7] as string[]
        if (extraArgs.includes('--offline')) {
          if (!stopped || !extraArgs.includes('--constraint')) return { code: 1, output: '' }
          late.push(extraArgs.filter((arg) => arg.startsWith('--') && arg !== '--constraint'))
          return afterStop(extraArgs, signal)
        }
        if (!extraArgs.includes('--target')) return { code: 0, output: ' + comfy-agent==0.2.3\n' }
        waiting++
        return new Promise((resolve) =>
          signal.addEventListener('abort', () => {
            waiting--
            stopped = true
            resolve({ code: 1, output: '' })
          })
        )
      })
      return late
    }
    type UvResult = { code: number; output: string }
    const lasting = (signal: AbortSignal, ms: number, result: UvResult, stoppedAt?: number[]) => {
      const startedAt = Date.now()
      waiting++
      return new Promise<UvResult>((resolve) => {
        const timer =
          ms === Infinity
            ? undefined
            : setTimeout(() => {
                waiting--
                resolve(result)
              }, ms)
        signal.addEventListener('abort', () => {
          clearTimeout(timer)
          waiting--
          stoppedAt?.push(Date.now() - startedAt)
          resolve({ code: 1, output: '' })
        })
      })
    }

    it('goes to the network without a cache-only install when the cache check would still download', async () => {
      const tries: string[][] = []
      mockInstall.mockImplementation(async (_file, ...rest) => {
        const extraArgs = rest[7] as string[]
        tries.push(extraArgs.filter((arg) => arg.startsWith('--') && arg !== '--constraint'))
        if (extraArgs.includes('--offline') && extraArgs.includes('--dry-run')) {
          return tries.length === 1
            ? { code: 0, output: 'Would download 1 package\n + comfy-agent==0.2.3\n' }
            : { code: 0, output: '' }
        }
        if (extraArgs.includes('--dry-run')) return { code: 0, output: ' + comfy-agent==0.2.3\n' }
        return { code: 0, output: '' }
      })

      const decision = await settle(installAgentRequirements(plan, vi.fn(), undefined, OVERRIDE))

      expect(
        tries,
        'no install waits on a wheel another download is fetching: check, download, then install'
      ).toEqual([
        ['--offline', '--dry-run'],
        ['--dry-run'],
        ['--no-deps', '--target'],
        ['--offline']
      ])
      expect(decision).toMatchObject({ decision: 'applied' })
    })

    it('stops a cache check held up for 30 s, takes it as a miss, and never counts it', async () => {
      const checkStopped: number[] = []
      mockInstall.mockImplementation(async (_file, ...rest) => {
        const signal = rest[5] as AbortSignal
        const extraArgs = rest[7] as string[]
        const override = extraArgs.includes('--constraint')
        if (override && extraArgs.includes('--offline') && extraArgs.includes('--dry-run')) {
          return lasting(signal, Infinity, { code: 0, output: '' }, checkStopped)
        }
        if (override) return { code: 2, output: 'error: Failed to download `comfy-agent`\n' }
        return { code: 0, output: '' }
      })
      const onDeferred = vi.fn()

      const decision = await settle(
        installAgentRequirements(plan, vi.fn(), undefined, OVERRIDE, null, onDeferred)
      )

      expect(checkStopped, 'a check is safe to stop: it writes nothing').toEqual([30_000])
      expect(decision, 'a miss, so it waits for the background download').toMatchObject({
        decision: 'deferred',
        reason: 'not_cached'
      })
      expect(onDeferred).toHaveBeenCalledTimes(1)
    })

    it('checks the cache without writing after a download ran out, then installs from it under the install bound', async () => {
      const late = downloadRunsOut((extraArgs, signal) =>
        extraArgs.includes('--dry-run')
          ? { code: 0, output: ' + comfy-agent==0.2.3\n' }
          : lasting(signal, 60_000, { code: 0, output: '' })
      )

      const decision = await settle(installAgentRequirements(plan, vi.fn(), undefined, OVERRIDE))

      expect(late, 'a check that writes nothing, then the install').toEqual([
        ['--offline', '--dry-run'],
        ['--offline']
      ])
      expect(
        decision,
        'a 60 s install from the cache is never cut short at the 30 s a check gets'
      ).toMatchObject({ decision: 'applied' })
    })

    it("stops a cache check held up behind another install's download at 30 s, and installs nothing", async () => {
      const checkStopped: number[] = []
      const late = downloadRunsOut((extraArgs, signal) =>
        extraArgs.includes('--dry-run')
          ? lasting(signal, Infinity, { code: 0, output: '' }, checkStopped)
          : { code: 0, output: '' }
      )
      const onDeferred = vi.fn()

      const decision = await settle(
        installAgentRequirements(plan, vi.fn(), undefined, OVERRIDE, null, onDeferred)
      )

      expect(checkStopped).toEqual([30_000])
      expect(late, 'nothing went into the environment').toEqual([['--offline', '--dry-run']])
      expect(decision, "deferred like a cache miss, with the download's own timeout").toMatchObject(
        { decision: 'deferred', install: { outcome: 'timed_out', budgetMs: 20_000 } }
      )
      expect(onDeferred).toHaveBeenCalledTimes(1)
    })

    it.each([
      [
        'would still download a wheel',
        { code: 0, output: 'Would download 1 package\n + comfy-agent==0.2.3\n' }
      ],
      ['misses the cache', { code: 1, output: '' }]
    ])(
      'installs nothing when the check after a download ran out %s, and defers',
      async (_label, check) => {
        const late = downloadRunsOut((extraArgs) =>
          extraArgs.includes('--dry-run') ? check : { code: 0, output: '' }
        )
        const onDeferred = vi.fn()

        const decision = await settle(
          installAgentRequirements(plan, vi.fn(), undefined, OVERRIDE, null, onDeferred)
        )

        expect(late).toEqual([['--offline', '--dry-run']])
        expect(decision).toMatchObject({ decision: 'deferred', install: { outcome: 'timed_out' } })
        expect(onDeferred).toHaveBeenCalledTimes(1)
      }
    )

    it('tries the cache no more after a resolve that ran out, which fetched nothing', async () => {
      const retries = fetchTimesOut('--dry-run', true)

      const decision = await settle(installAgentRequirements(plan, vi.fn(), undefined, OVERRIDE))

      expect(retries, 'a resolve stopped at the budget fetched nothing to install').toEqual([])
      expect(decision).toMatchObject({ decision: 'deferred', install: { outcome: 'timed_out' } })
    })

    it('gives up on a package listing that never answers, and refuses', async () => {
      const startedAt = Date.now()
      hangUntilAborted(startedAt)
      let listingStoppedAt = 0
      mockUvPip.mockImplementation((...args) => {
        waiting++
        args[4]!.addEventListener('abort', () => (listingStoppedAt = Date.now() - startedAt))
        return new Promise(() => {})
      })

      const decision = await settle(installAgentRequirements(plan, vi.fn(), undefined, OVERRIDE))

      expect(decision).toMatchObject({ decision: 'refused', reason: 'check_failed' })
      expect(listingStoppedAt, 'a stuck listing is stopped at its own 30 s bound').toBe(30_000)
      expect(
        calls.map((c) => [c.constraints, c.timeoutAt]),
        "the listing is local, so the network budget is all core file's"
      ).toEqual([[null, 50_000]])
    })

    it("clears the override's files when uv ignores the stop and is abandoned", async () => {
      mockInstall.mockImplementation(async (_file, ...rest) => {
        const extraArgs = rest[7] as string[]
        if (extraArgs.includes('--offline')) return { code: 1, output: '' }
        calls.push({ content: '', constraints: extraArgs.includes('--constraint') ? 'yes' : null })
        fs.writeFileSync(path.join(installDir, rest[3] as string), '')
        waiting++
        return new Promise(() => {})
      })

      const sendOutput = vi.fn()
      const decision = await settle(installAgentRequirements(plan, sendOutput, undefined, OVERRIDE))
      expect(sendOutput.mock.calls.join('')).toContain(
        'uv did not stop; hard-stopped it and continuing without it'
      )
      expect(decision).toMatchObject({ decision: 'deferred', install: { outcome: 'abandoned' } })
      expect(
        calls.map((c) => c.constraints),
        'the budget is spent, so core file gets no network try'
      ).toEqual(['yes'])
      vi.useRealTimers()
      await vi.waitFor(
        () =>
          expect(
            fs.readdirSync(installDir),
            'the abandoned attempt still cleans up, after the launch has moved on'
          ).toEqual(['ComfyUI']),
        { timeout: 5_000 }
      )
    })
  })
})

describe('restoreCoreFrontend', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontend-restore-'))
    fs.mkdirSync(path.join(installDir, 'ComfyUI'), { recursive: true })
    mockInstall.mockResolvedValue({ code: 0, output: '' })
  })

  afterEach(() => {
    fs.rmSync(installDir, { recursive: true, force: true })
  })

  const writeCore = (text: string): void =>
    fs.writeFileSync(path.join(installDir, 'ComfyUI', 'requirements.txt'), text)

  it("installs ComfyUI's exact frontend pin alone, without dependencies", async () => {
    const inst = managedInstall()
    writeCore('torch\ncomfyui-frontend-package==1.55.18\n')
    let content = ''
    mockInstall.mockImplementationOnce(async (file) => {
      content = fs.readFileSync(file, 'utf-8')
      return { code: 0, output: '' }
    })

    expect(await restoreCoreFrontend(inst, vi.fn())).toBe(true)
    expect(content).toBe('comfyui-frontend-package==1.55.18\n')
    expect(mockInstall.mock.calls[0]![8]).toEqual(['--no-deps'])
    await vi.waitFor(() =>
      expect(fs.readdirSync(installDir).filter((name) => name.startsWith('.launch'))).toEqual([])
    )
  })

  it('keeps the record for the next launch when the install fails', async () => {
    const inst = managedInstall()
    writeCore('comfyui-frontend-package==1.55.18\n')
    mockInstall.mockResolvedValueOnce({ code: 1, output: '' })

    expect(await restoreCoreFrontend(inst, vi.fn())).toBe(false)
  })

  it('drops the record without installing when there is no exact pin to put back', async () => {
    const inst = managedInstall()
    expect(await restoreCoreFrontend(inst, vi.fn()), 'no requirements.txt').toBe(true)
    writeCore('comfyui-frontend-package>=1.0\n')
    expect(await restoreCoreFrontend(inst, vi.fn()), 'a range').toBe(true)
    expect(mockInstall).not.toHaveBeenCalled()
  })

  it('drops the record for an install with no uv', async () => {
    writeCore('comfyui-frontend-package==1.55.18\n')
    const inst = { installPath: installDir } as unknown as InstallationRecord
    expect(await restoreCoreFrontend(inst, vi.fn())).toBe(true)
    expect(mockInstall).not.toHaveBeenCalled()
  })
})

describe('uvErrorTail', () => {
  it("keeps uv's error from its first error line on, without local paths", () => {
    const home = os.homedir()
    const output = [
      `Using Python 3.12 environment at: ${home}/installs/a/ComfyUI/.venv`,
      'Resolved 3 packages in 20ms',
      '  × No solution found when resolving dependencies:',
      `  ╰─▶ Because ${home}/installs/a/wheels/x.whl is missing and ${home}/cache is empty`
    ].join('\n')

    expect(uvErrorTail(output, `${home}/installs/a`)).toBe(
      '× No solution found when resolving dependencies:\n  ╰─▶ Because <install>/wheels/x.whl is missing and ~/cache is empty'
    )
  })

  it('scrubs a Windows path written with either separator', () => {
    const output = 'error: failed to read C:\\Users\\me\\I\\x.txt and C:/Users/me/I/y.txt'

    expect(uvErrorTail(output, 'C:\\Users\\me\\I')).toBe(
      'error: failed to read <install>\\x.txt and <install>/y.txt'
    )
  })

  it('caps the text at 500 characters', () => {
    expect(uvErrorTail(`error: ${'x'.repeat(900)}`, '/inst')).toHaveLength(500)
  })

  it('is null when uv printed no error', () => {
    expect(uvErrorTail('Resolved 3 packages in 20ms\nInstalled 3 packages', '/inst')).toBeNull()
  })
})

describe('prefetchAgentRequirements', () => {
  let dir = ''
  let plan: PrefetchRequest['plan']
  type Call = { content: string; extraArgs: string[]; env: Record<string, string> | undefined }
  let calls: Call[] = []
  let resolveAnswer: { code: number; output: string } = { code: 0, output: '' }
  let fetchAnswer: { code: number; output: string } = { code: 0, output: '' }

  const DRY_RUN = [
    'Resolved 6 packages in 400ms',
    'Would download 2 packages',
    'Would uninstall 1 package',
    'Would install 2 packages',
    ' - comfy-agent==0.0.0.dev0',
    ' + comfy-agent==0.1.0rc3',
    ' + comfy-agent-go==0.1.0rc3'
  ].join('\n')

  const finish = (request: PrefetchRequest): Promise<PrefetchReport | null> =>
    new Promise((resolve, reject) => {
      if (!prefetchAgentRequirements(request, resolve)) reject(new Error('not started'))
    })

  beforeEach(() => {
    vi.clearAllMocks()
    calls = []
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-prefetch-'))
    plan = {
      reqPath: path.join(dir, 'ComfyUI', 'agent_requirements.txt'),
      uvPath: '/uv',
      pythonPath: '/py',
      installPath: dir
    }
    resolveAnswer = { code: 0, output: DRY_RUN }
    fetchAnswer = {
      code: 0,
      output:
        'Downloading comfy-agent (49.4MiB)\nDownloading comfy-agent-go (49.3MiB)\n Downloaded comfy-agent\n Downloaded comfy-agent-go\n'
    }
    mockUvPip.mockResolvedValue({ code: 0, output: 'uv 0.13.4 (7456b60bc 2026-10-20)\n' })
    mockInstall.mockImplementation(async (file, ...rest) => {
      const extraArgs = rest[7] as string[]
      const call = {
        content: fs.readFileSync(file, 'utf-8'),
        extraArgs,
        env: rest[9] as Call['env']
      }
      calls.push(call)
      if (extraArgs.includes('--target')) {
        fs.mkdirSync(path.join(dir, extraArgs[extraArgs.indexOf('--target') + 1]!, 'comfy_agent'), {
          recursive: true
        })
        return fetchAnswer
      }
      return resolveAnswer
    })
  })

  afterEach(() => {
    stopAgentPrefetches()
    _resetAgentPrefetchesForTest()
    mockInstall.mockReset()
    mockInstall.mockResolvedValue({ code: 0, output: '' })
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const request = (): PrefetchRequest => ({
    plan,
    steps: [{ text: 'comfy-agent[go-nonfree]==0.1.0rc3\n', constraints: 'requests==2.32.0\n' }],
    signature: 'comfy-agent[go-nonfree]==0.1.0rc3'
  })

  it('resolves against the environment, then fetches exactly the missing pins one at a time', async () => {
    const report = await finish(request())

    expect(calls).toHaveLength(2)
    const [resolved, fetched] = calls
    expect(resolved!.content).toBe('comfy-agent[go-nonfree]==0.1.0rc3\n')
    expect(resolved!.extraArgs[0]).toBe('--dry-run')
    const constraint = resolved!.extraArgs[resolved!.extraArgs.indexOf('--constraint') + 1]!
    expect(path.isAbsolute(constraint), 'uv splits an absolute --constraint on spaces').toBe(false)
    expect(fetched!.content).toBe('comfy-agent==0.1.0rc3\ncomfy-agent-go==0.1.0rc3\n')
    expect(fetched!.extraArgs.slice(0, 2)).toEqual(['--no-deps', '--target'])
    expect(path.isAbsolute(fetched!.extraArgs[2]!)).toBe(false)
    expect(
      fetched!.env,
      'finished wheels outlive a stopped run only when fetched one by one'
    ).toEqual({
      UV_CONCURRENT_DOWNLOADS: '1'
    })
    expect(report).toMatchObject({
      outcome: 'completed',
      exitCode: 0,
      downloadsStarted: 2,
      downloadsFinished: 2,
      errorTail: null,
      uvVersion: '0.13.4'
    })
  })

  it('never touches the environment, and leaves no scratch target or files behind', async () => {
    await finish(request())

    for (const call of calls) expect(call.extraArgs).not.toContain('--offline')
    expect(calls[1]!.extraArgs, 'installs into the scratch target, not the venv').toContain(
      '--target'
    )
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it('ends a run only once every scratch removal has settled, even when one of them fails', async () => {
    const failing = path.join(dir, '.agent-prefetch-left-1')
    const slow = path.join(dir, '.agent-prefetch-left-2')
    mockInstall.mockImplementationOnce(async () => {
      fs.writeFileSync(failing, '')
      fs.writeFileSync(slow, '')
      return { code: 0, output: '' }
    })
    const rm = fs.promises.rm
    let releaseSlow = (): void => {}
    const spy = vi.spyOn(fs.promises, 'rm').mockImplementation((async (
      ...args: Parameters<typeof rm>
    ) => {
      if (args[0] === failing) throw new Error('EBUSY')
      if (args[0] === slow) await new Promise<void>((resolve) => (releaseSlow = resolve))
      return rm(...args)
    }) as typeof rm)
    try {
      const done = vi.fn()
      expect(prefetchAgentRequirements(request(), done)).toBe(true)
      await vi.waitFor(() => expect(spy.mock.calls.map(([at]) => at)).toContain(slow))

      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(done, 'a removal still running holds the run open').not.toHaveBeenCalled()
      releaseSlow()
      await vi.waitFor(() => expect(done).toHaveBeenCalled())
      expect(fs.existsSync(slow)).toBe(false)
    } finally {
      spy.mockRestore()
    }
  })

  it('clears what a run cut short by an exit left behind', async () => {
    fs.mkdirSync(path.join(dir, '.agent-prefetch-1-1', 'comfy_agent'), { recursive: true })
    fs.writeFileSync(path.join(dir, '.agent-prefetch-1-1-pins.txt'), 'x\n')
    fs.writeFileSync(path.join(dir, 'keep.txt'), 'x\n')

    await finish(request())

    expect(fs.readdirSync(dir)).toEqual(['keep.txt'])
  })

  it("passes no constraints for core file's own text", async () => {
    await finish({ plan, steps: [{ text: 'comfy-agent==0.2.0\n' }], signature: 'core' })

    expect(calls[0]!.extraArgs).toEqual(['--dry-run'])
  })

  it('reports a resolve that fails as resolve_failed, with the error, and fetches nothing', async () => {
    resolveAnswer = { code: 1, output: 'error: No solution found when resolving dependencies\n' }

    const report = await finish(request())

    expect(calls).toHaveLength(1)
    expect(report).toMatchObject({
      outcome: 'resolve_failed',
      exitCode: 1,
      errorTail: 'error: No solution found when resolving dependencies'
    })
  })

  it('reports a fetch that fails as download_failed, with how far it got', async () => {
    fetchAnswer = {
      code: 2,
      output:
        'Downloading comfy-agent (49.4MiB)\nDownloading comfy-agent-go (49.3MiB)\n Downloaded comfy-agent\nerror: Failed to download comfy-agent-go\n'
    }

    const report = await finish(request())

    expect(report).toMatchObject({
      outcome: 'download_failed',
      exitCode: 2,
      downloadsStarted: 2,
      downloadsFinished: 1,
      errorTail: 'error: Failed to download comfy-agent-go'
    })
  })

  it('reports nothing_missing when the resolve finds everything installed', async () => {
    resolveAnswer = { code: 0, output: 'Resolved 6 packages in 400ms\nWould make no changes\n' }

    const report = await finish(request())

    expect(calls).toHaveLength(1)
    expect(report?.outcome).toBe('nothing_missing')
  })

  it('fetches each step in order, and reports the counts across them', async () => {
    const report = await finish({
      plan,
      steps: [{ text: 'comfy-agent==0.0.0.dev0\n' }, request().steps[0]!],
      signature: 'comfy-agent[go-nonfree]==0.1.0rc3'
    })

    expect(calls.map((call) => [call.extraArgs[0], call.content.split('\n')[0]])).toEqual([
      ['--dry-run', 'comfy-agent==0.0.0.dev0'],
      ['--no-deps', 'comfy-agent==0.1.0rc3'],
      ['--dry-run', 'comfy-agent[go-nonfree]==0.1.0rc3'],
      ['--no-deps', 'comfy-agent==0.1.0rc3']
    ])
    expect(report).toMatchObject({
      outcome: 'completed',
      downloadsStarted: 4,
      downloadsFinished: 4
    })
  })

  it('stops at the first step that fails, reporting it', async () => {
    resolveAnswer = { code: 1, output: 'error: No solution found\n' }

    const report = await finish({
      plan,
      steps: [{ text: 'comfy-agent==0.0.0.dev0\n' }, request().steps[0]!],
      signature: 'comfy-agent[go-nonfree]==0.1.0rc3'
    })

    expect(calls).toHaveLength(1)
    expect(report).toMatchObject({ outcome: 'resolve_failed' })
  })

  it('waits for a uv that ignores the stop to be hard-stopped, for removing the install, through a slow Windows taskkill', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
    Object.defineProperty(process, 'platform', { value: 'win32' })
    slowTaskkill.ms = 1_000
    try {
      execCalls.length = 0
      execAnswered.length = 0
      mockInstall.mockImplementation(
        (...args: Parameters<typeof installFilteredRequirementsDetailed>) => {
          args[9]?.(Object.assign(new EventEmitter(), { pid: 4545 }) as never)
          return new Promise<never>(() => {})
        }
      )
      prefetchAgentRequirements(request(), vi.fn())
      await vi.waitFor(() => expect(mockInstall).toHaveBeenCalled())

      let heldBeforeTaskkillReturned: boolean | undefined
      const hold = holdAgentPrefetch(dir).then((release) => {
        heldBeforeTaskkillReturned = !execAnswered.includes('taskkill')
        return release
      })
      await vi.advanceTimersByTimeAsync(10_000)
      await vi.waitFor(() =>
        expect(execCalls, 'the grace ran out, so uv is hard-stopped').toContainEqual({
          cmd: 'taskkill',
          args: ['/F', '/T', '/PID', '4545']
        })
      )
      await vi.advanceTimersByTimeAsync(1_000)
      ;(await hold)()
      expect(heldBeforeTaskkillReturned, 'the removal waits until the hard stop has returned').toBe(
        false
      )
    } finally {
      slowTaskkill.ms = 0
      Object.defineProperty(process, 'platform', platform)
      vi.useRealTimers()
    }
  })

  it("waits for an install's download to stop, for removing the install", async () => {
    let uvSignal: AbortSignal | undefined
    let exited = false
    mockInstall.mockImplementationOnce(async (...args) => {
      uvSignal = args[6] as AbortSignal
      return new Promise((resolve) =>
        uvSignal!.addEventListener(
          'abort',
          () =>
            setTimeout(() => {
              exited = true
              resolve({ code: 1, output: '' })
            }, 20),
          { once: true }
        )
      )
    })
    const pending = finish(request())
    await vi.waitFor(() => expect(uvSignal).toBeDefined())

    const release = await holdAgentPrefetch(dir)

    expect(exited, 'resolves only once uv has exited').toBe(true)
    await expect(pending).resolves.toMatchObject({ outcome: 'cancelled' })
    expect(prefetchAgentRequirements(request(), vi.fn()), 'none starts while held').toBe(false)
    release()
    release()
    const after = vi.fn()
    expect(prefetchAgentRequirements(request(), after), 'released, once').toBe(true)
    await vi.waitFor(() => expect(after).toHaveBeenCalled())
  })

  it('starts nothing after quit', () => {
    stopAgentPrefetches()

    expect(prefetchAgentRequirements(request(), vi.fn())).toBe(false)
  })

  it('refuses a different request while one runs, and settles it at once so no caller waits', async () => {
    mockInstall.mockImplementationOnce(async (...args) => {
      const uvSignal = args[6] as AbortSignal
      return new Promise((resolve) =>
        uvSignal.addEventListener('abort', () => resolve({ code: 1, output: '' }), { once: true })
      )
    })
    const running = vi.fn()
    expect(prefetchAgentRequirements(request(), running)).toBe(true)
    await vi.waitFor(() => expect(mockInstall).toHaveBeenCalled())
    const refused = vi.fn()

    expect(prefetchAgentRequirements({ ...request(), signature: 'core' }, refused)).toBe(false)

    expect(
      refused,
      'settled at once: the startup pass waits on it before the next install'
    ).toHaveBeenCalledWith(null)
    const again = vi.fn()
    expect(
      prefetchAgentRequirements(request(), again),
      'the same request joins the running one'
    ).toBe(false)
    expect(again).not.toHaveBeenCalled()
    expect(running, 'the running download is left alone').not.toHaveBeenCalled()
    stopAgentPrefetches()
    await vi.waitFor(() => expect(running).toHaveBeenCalled())
  })

  it('reports, rather than hangs, when uv cannot even say its version', async () => {
    mockUvPip.mockRejectedValue(new Error('spawn EINVAL'))

    expect(await finish(request())).toMatchObject({ outcome: 'spawn_error', uvVersion: null })
  })

  it('runs one download per install at a time', async () => {
    let release = (): void => {}
    mockInstall.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve({ code: 0, output: '' })))
    )
    const first = vi.fn()

    expect(prefetchAgentRequirements(request(), first)).toBe(true)
    expect(prefetchAgentRequirements(request(), vi.fn()), 'a relaunch while it runs').toBe(false)
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-prefetch-other-'))
    const second = vi.fn()
    try {
      expect(
        prefetchAgentRequirements({ ...request(), plan: { ...plan, installPath: other } }, second),
        'another install has its own'
      ).toBe(true)
      await vi.waitFor(() => expect(mockInstall).toHaveBeenCalled())
      release()
      await vi.waitFor(() => expect(first).toHaveBeenCalled())
      await vi.waitFor(() => expect(second).toHaveBeenCalled())
      const third = vi.fn()
      expect(prefetchAgentRequirements(request(), third), 'free again once it ended').toBe(true)
      await vi.waitFor(() => expect(third).toHaveBeenCalled())
    } finally {
      fs.rmSync(other, { recursive: true, force: true })
    }
  })

  it('stops the uv it runs when Desktop quits', async () => {
    let uvSignal: AbortSignal | undefined
    mockInstall.mockImplementationOnce(async (...args) => {
      uvSignal = args[6] as AbortSignal
      return new Promise((resolve) =>
        uvSignal!.addEventListener('abort', () => resolve({ code: 1, output: '' }), { once: true })
      )
    })
    const pending = finish(request())
    await vi.waitFor(() => expect(uvSignal).toBeDefined())

    stopAgentPrefetches()

    expect(uvSignal!.aborted).toBe(true)
    await expect(pending).resolves.toMatchObject({ outcome: 'cancelled' })
  })

  it('reports no uv version when uv cannot say', async () => {
    mockUvPip.mockResolvedValue({ code: 1, output: '' })

    expect((await finish(request()))!.uvVersion).toBeNull()
  })

  describe('ahead of a launch', () => {
    const answerCacheOnly = (cachedOutput: { code: number; output: string }): void => {
      const original = mockInstall.getMockImplementation()!
      mockInstall.mockImplementation(async (file, ...rest) =>
        (rest[7] as string[]).includes('--offline') ? cachedOutput : original(file, ...rest)
      )
    }

    it('does nothing, and reports nothing, when the cache holds every wheel', async () => {
      answerCacheOnly({ code: 0, output: 'Would uninstall 1 package\nWould install 2 packages\n' })

      expect(await finish({ ...request(), eager: true })).toBeNull()
      expect(calls, 'nothing went to the network').toEqual([])
    })

    it('fetches when the cache knows the packages but holds no wheels for them', async () => {
      answerCacheOnly({ code: 0, output: 'Would download 2 packages\nWould install 2 packages\n' })

      expect(
        await finish({ ...request(), eager: true }),
        'a resolve from the cache passes on metadata an earlier resolve left there'
      ).toMatchObject({ outcome: 'completed' })
      expect(calls.at(-1)!.extraArgs).toContain('--target')
    })

    it('reports a run whose first step was cached and whose second was fetched', async () => {
      let cacheOnly = 0
      const original = mockInstall.getMockImplementation()!
      mockInstall.mockImplementation(async (file, ...rest) => {
        if (!(rest[7] as string[]).includes('--offline')) return original(file, ...rest)
        return cacheOnly++ === 0
          ? { code: 0, output: 'Would install 1 package\n' }
          : { code: 0, output: 'Would download 2 packages\n' }
      })

      const report = await finish({
        plan,
        steps: [{ text: 'comfy-agent==0.0.0.dev0\n' }, request().steps[0]!],
        signature: 'comfy-agent[go-nonfree]==0.1.0rc3',
        eager: true
      })

      expect(report).toMatchObject({ outcome: 'completed' })
      expect(calls.filter((call) => call.extraArgs.includes('--target'))).toHaveLength(1)
    })

    it('gives a later step only what the earlier ones left of the 30 minutes', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
      try {
        const budgets: number[] = []
        mockInstall.mockImplementation(async (_file, ...rest) => {
          const extraArgs = rest[7] as string[]
          const signal = rest[5] as AbortSignal
          if (extraArgs.includes('--target')) {
            return new Promise((resolve) =>
              setTimeout(() => resolve({ code: 0, output: '' }), 10 * 60_000)
            )
          }
          const startedAt = Date.now()
          if (budgets.length === 0) {
            budgets.push(-1)
            return { code: 0, output: DRY_RUN }
          }
          return new Promise((resolve) =>
            signal.addEventListener('abort', () => {
              budgets.push(Date.now() - startedAt)
              resolve({ code: 1, output: '' })
            })
          )
        })

        const pending = finish({
          plan,
          steps: [{ text: 'comfy-agent==0.0.0.dev0\n' }, request().steps[0]!],
          signature: 'comfy-agent[go-nonfree]==0.1.0rc3'
        })
        let done = false
        void pending.then(() => (done = true))
        while (!done) {
          await new Promise((resolve) => setImmediate(resolve))
          await vi.advanceTimersToNextTimerAsync()
        }

        expect(budgets.at(-1), "step 2's resolve gets 20 of the 30 minutes").toBe(20 * 60_000)
      } finally {
        vi.useRealTimers()
      }
    })

    it('fetches when the cache cannot even resolve', async () => {
      answerCacheOnly({ code: 1, output: 'error: No solution found\n' })

      expect(await finish({ ...request(), eager: true })).toMatchObject({ outcome: 'completed' })
    })
  })
})

describe('prepareAgentPrefetch', () => {
  let dir = ''
  let plan: PrefetchRequest['plan']

  beforeEach(() => {
    vi.clearAllMocks()
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-prepare-'))
    plan = {
      reqPath: path.join(dir, 'ComfyUI', 'agent_requirements.txt'),
      uvPath: '/uv',
      pythonPath: '/py',
      installPath: dir
    }
    fs.mkdirSync(path.dirname(plan.reqPath), { recursive: true })
    fs.writeFileSync(plan.reqPath, 'comfy-agent==0.0.0.dev0\n')
    mockUvPip.mockResolvedValue({
      code: 0,
      output: JSON.stringify([
        { name: 'comfy-agent', version: '0.0.0.dev0' },
        { name: 'requests', version: '2.32.0' }
      ])
    })
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it("prepares the override's text and constraints, as the launch would install them", async () => {
    expect(await prepareAgentPrefetch(plan, { 'comfy-agent': '0.1.0rc3' }, null)).toEqual({
      plan,
      steps: [{ text: 'comfy-agent==0.1.0rc3\n', constraints: 'requests==2.32.0\n' }],
      signature: 'comfy-agent==0.1.0rc3',
      eager: true
    })
  })

  it("holds a removal until a preparation's uv listing has exited, and prepares nothing then", async () => {
    let exited = false
    mockUvPip.mockImplementationOnce(
      (...args) =>
        new Promise((resolve) =>
          args[4]!.addEventListener(
            'abort',
            () =>
              setTimeout(() => {
                exited = true
                resolve({ code: 1, output: '' })
              }, 20),
            { once: true }
          )
        )
    )
    const prepared = prepareAgentPrefetch(plan, { 'comfy-agent': '0.1.0rc3' }, null)
    await vi.waitFor(() => expect(mockUvPip).toHaveBeenCalled())

    const release = await holdAgentPrefetch(dir)

    expect(exited, 'a delete must not go on with uv still running from inside the install').toBe(
      true
    )
    expect(await prepared, 'what was cut short is not downloaded').toBeNull()
    release()
  })

  it('prepares core file first when its packages are not in yet, as a launch installs them', async () => {
    mockUvPip.mockResolvedValue({
      code: 0,
      output: JSON.stringify([{ name: 'requests', version: '2.32.0' }])
    })

    expect(await prepareAgentPrefetch(plan, { 'comfy-agent': '0.1.0rc3' }, null)).toMatchObject({
      steps: [{ text: 'comfy-agent==0.0.0.dev0\n' }, { text: 'comfy-agent==0.1.0rc3\n' }]
    })
  })

  it("falls back to core file's text for an override this install gave up on", async () => {
    const state = { signature: 'comfy-agent==0.1.0rc3', failures: 2 }

    expect(await prepareAgentPrefetch(plan, { 'comfy-agent': '0.1.0rc3' }, state)).toEqual({
      plan,
      steps: [{ text: 'comfy-agent==0.0.0.dev0\n' }],
      signature: 'core',
      eager: true
    })
  })

  it("falls back to core file's text for no override, or one that is refused", async () => {
    for (const raw of [undefined, { 'comfy-agent': 'latest' }, { 'comfy-agent': '0.0.0.dev0' }]) {
      expect(await prepareAgentPrefetch(plan, raw, null)).toMatchObject({ signature: 'core' })
    }
  })

  it("prepares nothing when core file can't be read", async () => {
    fs.rmSync(plan.reqPath)

    expect(await prepareAgentPrefetch(plan, undefined, null)).toBeNull()
  })
})
