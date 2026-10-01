import { EventEmitter } from 'events'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChildProcess } from 'child_process'
import type * as ProcessIdentity from './processIdentity'
import type * as ChildProcessModule from 'child_process'

/** The Windows kill with taskkill and the process table faked: what is signalled, in what order. */
const fake = vi.hoisted(() => {
  // Before the module loads: its kill bound is chosen by platform at import.
  const realPlatform = process.platform
  Object.defineProperty(process, 'platform', { value: 'win32' })
  return {
    realPlatform,
    rows: [] as Array<{ pid: number; ppid: number; created: string }>,
    alive: new Set<number>(),
    order: [] as string[],
    tableFails: false,
    /** Runs before the table is read for the n-th time (1-based). */
    beforeRead: null as null | ((n: number) => void),
    reads: 0,
    /** What a taskkill of a pid takes down with it (the job object's cascade, in reality). */
    cascade: new Map<number, number[]>()
  }
})

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcessModule>()
  const execFile = (cmd: string, args: string[], _opts: unknown, cb: () => void): void => {
    if (cmd === 'taskkill') {
      const pid = Number(args[args.length - 1])
      fake.order.push(`taskkill ${pid}`)
      for (const p of [pid, ...(fake.cascade.get(pid) ?? [])]) fake.alive.delete(p)
    }
    setTimeout(cb, 0)
  }
  return { ...actual, execFile, default: { ...actual, execFile } }
})
vi.mock('./processIdentity', async (importOriginal) => {
  const actual = await importOriginal<typeof ProcessIdentity>()
  return {
    ...actual,
    isPidAlive: (pid: number) => fake.alive.has(pid),
    windowsProcessRows: async () => {
      fake.reads++
      fake.beforeRead?.(fake.reads)
      fake.order.push('table')
      if (fake.tableFails) return null
      return fake.rows.filter((r) => fake.alive.has(r.pid))
    }
  }
})

import { killProcessTree } from './process'

function child(pid: number): ChildProcess {
  const c = new EventEmitter() as EventEmitter & Record<string, unknown>
  Object.assign(c, { pid, exitCode: null, signalCode: null, stdout: null, stderr: null })
  return c as unknown as ChildProcess
}

afterAll(() => {
  Object.defineProperty(process, 'platform', { value: fake.realPlatform })
})

beforeEach(() => {
  // The venv launcher 100, its interpreter 101 (in the launcher's job), and 300, a helper the
  // interpreter started outside that job.
  fake.rows = [
    { pid: 100, ppid: 1, created: '1000' },
    { pid: 101, ppid: 100, created: '1100' },
    { pid: 300, ppid: 101, created: '3000' }
  ]
  fake.alive = new Set([100, 101, 300])
  fake.order = []
  fake.tableFails = false
  fake.beforeRead = null
  fake.reads = 0
  fake.cascade = new Map([[100, [101]]])
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('killProcessTree on Windows', () => {
  it('snapshots first, then kills the root, then what of the tree survived', async () => {
    const result = await killProcessTree(child(100))
    expect(fake.order).toEqual(['table', 'taskkill 100', 'table', 'taskkill 300'])
    expect(result.exited).toBe(true)
    expect(fake.alive.size).toBe(0)
  })

  it('never signals a survivor whose pid now names another process', async () => {
    // Between the snapshot and the survivor pass, 300 exits and its pid is reused.
    fake.beforeRead = (n) => {
      if (n === 2) fake.rows.find((r) => r.pid === 300)!.created = '9999'
    }
    const stop = killProcessTree(child(100))
    await vi.waitFor(() => expect(fake.reads).toBe(2))
    await new Promise((r) => setTimeout(r, 20))
    expect(fake.order).toEqual(['table', 'taskkill 100', 'table'])
    fake.alive.delete(300) // the other process goes away on its own; the wait ends
    await stop
  })

  it.each([
    ['with', [{ pid: 101, startTime: '1100' }], true],
    ['without', [], false]
  ] as const)(
    "reaches a recorded interpreter's children once the launcher is gone, only %s the record",
    async (_how, known, reached) => {
      // The launcher is gone from the table, and the interpreter names some other (dead) parent:
      // only the record leads to it, and through it to the helper.
      fake.rows = [
        { pid: 101, ppid: 999, created: '1100' },
        { pid: 300, ppid: 101, created: '3000' }
      ]
      fake.alive = new Set([100, 101, 300])
      fake.cascade = new Map()
      const stop = killProcessTree(child(100), known)
      if (!reached) {
        await vi.waitFor(() => expect(fake.order).toContain('taskkill 100'))
        await new Promise((r) => setTimeout(r, 20))
        fake.alive.clear() // let the wait end
      }
      await stop
      expect(fake.order.includes('taskkill 101')).toBe(reached)
    }
  )

  it('never signals an older process that merely names the gone launcher as its parent', async () => {
    // Windows keeps a dead parent's pid in ParentProcessId: 400 was started long before the
    // launcher, by an unrelated process that once had pid 100.
    fake.rows = [{ pid: 400, ppid: 100, created: '0400' }]
    fake.alive = new Set([100, 400])
    fake.cascade = new Map()
    const stop = killProcessTree(child(100))
    await vi.waitFor(() => expect(fake.order).toContain('taskkill 100'))
    await stop
    expect(fake.order).not.toContain('taskkill 400')
    expect(fake.alive.has(400)).toBe(true)
  })

  it('does not signal the root once Node has seen it exit (its pid may be reused)', async () => {
    const exited = child(100) as unknown as { exitCode: number | null }
    exited.exitCode = 0
    fake.cascade = new Map()
    fake.alive.delete(100)
    const stop = killProcessTree(exited as unknown as ChildProcess)
    await vi.waitFor(() => expect(fake.reads).toBeGreaterThanOrEqual(1))
    fake.alive.clear()
    await stop
    expect(fake.order).not.toContain('taskkill 100')
  })

  it('does not take a recorded pid whose creation time no longer matches', async () => {
    fake.rows = [
      { pid: 100, ppid: 1, created: '1000' },
      { pid: 777, ppid: 1, created: '7777' }
    ]
    fake.alive = new Set([100, 777])
    fake.cascade = new Map()
    await killProcessTree(child(100), [{ pid: 777, startTime: 'recorded-earlier' }])
    expect(fake.order).not.toContain('taskkill 777')
    expect(fake.alive.has(777)).toBe(true)
  })

  it('still kills when the process table cannot be read, and watches the root', async () => {
    fake.tableFails = true
    fake.cascade = new Map([[100, [101, 300]]])
    const result = await killProcessTree(child(100))
    expect(fake.order).toEqual(['table', 'taskkill 100'])
    expect(result.exited).toBe(true)
  })
})
