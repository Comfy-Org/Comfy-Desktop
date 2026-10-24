import { execFileSync, spawn } from 'child_process'
import type { ChildProcess } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../settings', () => ({
  getMirrorConfig: () => ({ pypiMirror: undefined, useChineseMirrors: false })
}))

const fakePs = vi.hoisted(() => ({ answer: null as string | null }))

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof ChildProcessModule>('node:child_process')
  const execFile = ((cmd: string, ...rest: unknown[]) => {
    const answer = fakePs.answer
    if (cmd !== 'ps' || answer === null)
      return Reflect.apply(actual.execFile, undefined, [cmd, ...rest])
    ;(rest.at(-1) as (e: null, out: string, err: string) => void)(null, answer, '')
    return {}
  }) as typeof actual.execFile
  return {
    ...actual,
    spawn: actual.spawn,
    execFileSync: actual.execFileSync,
    execFile,
    default: { ...actual, execFile }
  }
})

vi.mock('./pip', () => ({
  installFilteredRequirementsDetailed: vi.fn(async () => ({ code: 0, output: '' })),
  runUvPipDetailed: vi.fn(async () => ({ code: 0, output: '[]' }))
}))

import {
  _resetAgentPrefetchesForTest,
  holdAgentPrefetch,
  installAgentRequirements,
  prepareAgentPrefetch,
  reapOrphanedAgentUv
} from './agentRequirementsLaunch'
import { installFilteredRequirementsDetailed, runUvPipDetailed } from './pip'
import type * as ChildProcessModule from 'child_process'

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const comm = (pid: number): string => {
  try {
    return execFileSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf-8' }).trim()
  } catch {
    return ''
  }
}

describe.skipIf(process.platform === 'win32')('reapOrphanedAgentUv', { timeout: 20_000 }, () => {
  let dir = ''
  let fakeUv = ''
  const children: ChildProcess[] = []

  const start = async (
    command: string,
    args: string[],
    name: string
  ): Promise<{ pid: number; startedAt: number }> => {
    const startedAt = Date.now()
    const child = spawn(command, args, { detached: true, stdio: 'ignore' })
    children.push(child)
    const pid = child.pid!
    await vi.waitFor(() => expect(path.basename(comm(pid))).toBe(name), { timeout: 10_000 })
    return { pid, startedAt }
  }

  const record = (pid: number, startedAt = Date.now()): string => {
    const file = path.join(dir, `.agent-uv-${pid}.json`)
    fs.writeFileSync(file, JSON.stringify({ pid, startedAt }))
    return file
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-uv-reaper-'))
    fakeUv = path.join(dir, 'bin', 'uv')
    fs.mkdirSync(path.dirname(fakeUv))
    fs.writeFileSync(fakeUv, '#!/bin/sh\nsleep 60\n', { mode: 0o755 })
  })

  afterEach(() => {
    for (const child of children.splice(0)) {
      try {
        process.kill(-child.pid!, 'SIGKILL')
      } catch {}
    }
    vi.mocked(installFilteredRequirementsDetailed).mockReset()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('kills the process group of a uv a killed Desktop left running, and removes its record', async () => {
    const { pid, startedAt } = await start(fakeUv, [], 'uv')
    const file = record(pid, startedAt)

    await reapOrphanedAgentUv(dir)

    expect(alive(pid), 'the orphan no longer holds the environment').toBe(false)
    expect(fs.existsSync(file)).toBe(false)
  })

  it.each([
    ['a process that is not uv', 'sleep', 0],
    ['a uv that started at another time, so its pid was reused', 'uv', -60_000]
  ])('leaves %s alone, and removes only the record', async (_label, name, skew) => {
    const { pid, startedAt } =
      name === 'uv' ? await start(fakeUv, [], 'uv') : await start('sleep', ['60'], 'sleep')
    const file = record(pid, startedAt + skew)

    await reapOrphanedAgentUv(dir)

    expect(alive(pid), 'a recycled pid is someone else’s process').toBe(true)
    expect(fs.existsSync(file)).toBe(false)
  })

  it('removes a corrupt record without signalling anything, even when the pid looks like uv', async () => {
    const now = new Date()
    fakePs.answer = `${now.toDateString().slice(0, 10)} ${now.toTimeString().slice(0, 8)} ${now.getFullYear()} /opt/bin/uv\n`
    const kill = vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
      if (signal === 0) throw new Error('ESRCH')
      return true
    })
    try {
      const files = [0, 1, -5].map((pid) => record(pid))

      await reapOrphanedAgentUv(dir)

      expect(
        kill.mock.calls.filter(([pid]) => [0, 1, -1, 5, -5].includes(pid)),
        'pid 0 or -1 signals a whole process group, and 1 is init'
      ).toEqual([])
      expect(files.filter((file) => fs.existsSync(file))).toEqual([])
    } finally {
      kill.mockRestore()
      fakePs.answer = null
    }
  })

  it('removes the record of a uv that has already exited', async () => {
    const file = record(2 ** 22 + 1)

    await reapOrphanedAgentUv(dir)

    expect(fs.existsSync(file)).toBe(false)
  })

  it('records each uv it starts, leaves its own running uv alone, and clears the record when it exits', async () => {
    fs.mkdirSync(path.join(dir, 'ComfyUI'))
    const reqPath = path.join(dir, 'ComfyUI', 'agent_requirements.txt')
    fs.writeFileSync(reqPath, 'comfy-agent==0.2.0\n')
    let own: ChildProcess | undefined
    vi.mocked(installFilteredRequirementsDetailed).mockImplementation(async (...args) => {
      if ((args[8] as string[]).includes('--dry-run')) return { code: 0, output: '' }
      own = spawn(fakeUv, [], { detached: true, stdio: 'ignore' })
      children.push(own)
      args[9]?.(own)
      return new Promise((resolve) => own!.once('close', () => resolve({ code: 0, output: '' })))
    })
    const plan = { reqPath, uvPath: '/uv', pythonPath: '/py', installPath: dir }

    const pending = installAgentRequirements(plan, vi.fn())
    await vi.waitFor(() => expect(own).toBeDefined())
    const pid = own!.pid!
    await vi.waitFor(() => expect(path.basename(comm(pid))).toBe('uv'), { timeout: 10_000 })
    const file = path.join(dir, `.agent-uv-${pid}.json`)
    expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toMatchObject({ pid })

    await reapOrphanedAgentUv(dir)

    expect(alive(pid), "this Desktop's own uv is not an orphan").toBe(true)
    expect(fs.existsSync(file)).toBe(true)
    process.kill(-pid, 'SIGKILL')
    await pending
    await vi.waitFor(() => expect(fs.existsSync(file)).toBe(false), { timeout: 10_000 })
  })
})

describe.skipIf(process.platform === 'win32')(
  "a preparation's uv listing that ignores the stop",
  { timeout: 20_000 },
  () => {
    let dir = ''
    let child: ChildProcess | undefined

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-uv-listing-'))
      fs.mkdirSync(path.join(dir, 'ComfyUI'))
      fs.writeFileSync(path.join(dir, 'ComfyUI', 'agent_requirements.txt'), 'comfy-agent==0.2.0\n')
      _resetAgentPrefetchesForTest()
    })

    afterEach(() => {
      vi.useRealTimers()
      try {
        process.kill(-child!.pid!, 'SIGKILL')
      } catch {}
      vi.mocked(runUvPipDetailed).mockReset()
      fs.rmSync(dir, { recursive: true, force: true })
    })

    it('is hard-stopped after the grace, so a hold for a removal still returns', async () => {
      let ready = (): void => {}
      const trapped = new Promise<void>((resolve) => (ready = resolve))
      vi.mocked(runUvPipDetailed).mockImplementationOnce(
        (_uv, _args, _cwd, _output, signal, onSpawn) =>
          new Promise((resolve) => {
            child = spawn('sh', ['-c', 'trap "" TERM; echo ready; while :; do sleep 1; done'], {
              detached: true,
              stdio: ['ignore', 'pipe', 'ignore']
            })
            child.stdout!.once('data', () => ready())
            onSpawn?.(child)
            signal?.addEventListener('abort', () => process.kill(-child!.pid!, 'SIGTERM'), {
              once: true
            })
            child.once('close', () => resolve({ code: 1, output: '' }))
          })
      )
      const plan = {
        reqPath: path.join(dir, 'ComfyUI', 'agent_requirements.txt'),
        uvPath: '/uv',
        pythonPath: '/py',
        installPath: dir
      }
      const prepared = prepareAgentPrefetch(plan, { 'comfy-agent': '0.2.3' }, null)
      await trapped
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      let held = false
      const hold = holdAgentPrefetch(dir).then((release) => {
        held = true
        return release
      })

      await vi.advanceTimersByTimeAsync(9_999)
      expect(held, 'it first waits out the grace a stop gets').toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      await vi.waitFor(() => expect(held).toBe(true))

      expect(alive(child!.pid!), 'a removal must not go on with uv still running in it').toBe(false)
      ;(await hold)()
      expect(await prepared).toBeNull()
    })
  }
)
