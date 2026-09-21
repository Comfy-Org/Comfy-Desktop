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
    const signal = new AbortController().signal

    await installAgentRequirements(plan, sendOutput, signal)

    expect(mockInstall).toHaveBeenCalledWith(
      plan.reqPath,
      plan.uvPath,
      plan.pythonPath,
      plan.installPath,
      '.launch-agent-reqs.txt',
      sendOutput,
      signal,
      mirrors
    )
    expect(sendOutput.mock.calls.join('')).toContain('Installing agent requirements')
  })

  it('reports a failed install and resolves so the launch continues', async () => {
    mockInstall.mockResolvedValueOnce({ code: 2, output: 'No solution found\n' })
    const sendOutput = vi.fn()

    await expect(installAgentRequirements(plan, sendOutput)).resolves.toBeUndefined()

    const reported = sendOutput.mock.calls.join('')
    expect(reported).toContain('exited with code 2')
    expect(reported).toContain('No solution found')
  })

  it('reports a thrown install and resolves so the launch continues', async () => {
    mockInstall.mockRejectedValueOnce(new Error('EACCES: permission denied'))
    const sendOutput = vi.fn()

    await expect(installAgentRequirements(plan, sendOutput)).resolves.toBeUndefined()

    expect(sendOutput.mock.calls.join('')).toContain('EACCES: permission denied')
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
