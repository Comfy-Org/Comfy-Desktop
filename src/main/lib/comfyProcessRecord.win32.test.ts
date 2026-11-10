import { EventEmitter } from 'events'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChildProcess } from 'child_process'
import type * as ProcessIdentity from './processIdentity'

const fake = vi.hoisted(() => ({
  state: '',
  rows: [] as Array<{ pid: number; ppid: number; created: string; commandLine: string }>,
  tableCalls: 0,
  rowCalls: 0,
  rowsInFlight: 0,
  maxRowsInFlight: 0,
  tableFails: 0
}))
vi.mock('./paths', () => ({ stateDir: () => fake.state }))
vi.mock('./processIdentity', async (importOriginal) => {
  const actual = await importOriginal<typeof ProcessIdentity>()
  return {
    ...actual,
    windowsProcessRows: async () => {
      fake.rowCalls++
      fake.rowsInFlight++
      fake.maxRowsInFlight = Math.max(fake.maxRowsInFlight, fake.rowsInFlight)
      await new Promise((r) => setTimeout(r, 20))
      fake.rowsInFlight--
      return fake.rows.map(({ pid, ppid, created }) => ({ pid, ppid, created }))
    },
    windowsProcessTable: async () => {
      fake.tableCalls++
      if (fake.tableFails > 0) {
        fake.tableFails--
        return null
      }
      return fake.rows
    },
    readStartTimes: async (pids: number[]) =>
      new Map(
        pids.flatMap((p) => {
          const row = fake.rows.find((r) => r.pid === p)
          return row ? [[p, row.created] as [number, string]] : []
        })
      ),
    ownStartTime: async () => 'desktop-start'
  }
})

import {
  filetimeOf,
  queueExitBookkeeping,
  readRecord,
  resolvePriorProcess,
  settleExitBookkeeping,
  trackSpawn
} from './comfyProcessRecord'

const INSTALL = 'C:\\c\\one'
const info = {
  sessionKey: 'inst-1',
  installationId: 'inst-1',
  installPath: INSTALL,
  port: 8188,
  bootId: 'b'
}
const realPlatform = process.platform

type FakeChild = EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; pid: number }
const created: FakeChild[] = []
function child(pid: number): FakeChild {
  const c = new EventEmitter() as FakeChild
  c.stdout = new EventEmitter()
  c.stderr = new EventEmitter()
  c.pid = pid
  created.push(c)
  return c
}
const asProc = (c: FakeChild): ChildProcess => c as unknown as ChildProcess
const now = (): string => String(filetimeOf(Date.now()))

beforeAll(() => {
  Object.defineProperty(process, 'platform', { value: 'win32' })
})
afterAll(() => {
  Object.defineProperty(process, 'platform', { value: realPlatform })
})
beforeEach(() => {
  fake.state = fs.mkdtempSync(path.join(os.tmpdir(), 'comfy-procs-win32-'))
  fake.tableCalls = 0
  fake.rowCalls = 0
  fake.rowsInFlight = 0
  fake.maxRowsInFlight = 0
  fake.tableFails = 0
  fake.rows = [
    {
      pid: 100,
      ppid: 1,
      created: '1000',
      commandLine: `"${INSTALL}\\.venv\\Scripts\\python.exe" -s ComfyUI\\main.py`
    },
    { pid: 101, ppid: 100, created: '1100', commandLine: 'C:\\Py\\python.exe -s ComfyUI\\main.py' }
  ]
})
afterEach(async () => {
  for (const c of created.splice(0)) {
    if (c.listenerCount('exit') > 0) c.emit('exit', 0, null)
    if (c.listenerCount('close') > 0) c.emit('close', 0, null)
  }
  await settleExitBookkeeping('inst-1')
  fs.rmSync(fake.state, { recursive: true, force: true })
})

function restartedCopy(): void {
  fake.rows = [
    {
      pid: 200,
      ppid: 101,
      created: now(),
      commandLine: `"${INSTALL}\\.venv\\Scripts\\python.exe" "main.py" --port 8188`
    }
  ]
}

describe('trackSpawn on Windows', () => {
  it('notes the tree when ComfyUI first writes to stderr (it logs there, not stdout)', async () => {
    const c = child(100)
    trackSpawn(asProc(c), info)
    await vi.waitFor(() => expect(readRecord('inst-1')?.childStartTime).toBe('1000'))
    c.stderr.emit('data', Buffer.from('Starting server'))
    await vi.waitFor(() =>
      expect(readRecord('inst-1')?.tree).toEqual([{ pid: 101, startTime: '1100' }])
    )
  })

  it('does not note a tree once the child is no longer in the snapshot', async () => {
    const c = child(100)
    trackSpawn(asProc(c), info)
    await vi.waitFor(() => expect(readRecord('inst-1')?.childStartTime).toBe('1000'))
    fake.rows = fake.rows.filter((r) => r.pid !== 100)
    c.stdout.emit('data', Buffer.from('x'))
    await new Promise((r) => setTimeout(r, 50))
    expect(readRecord('inst-1')?.tree).toBeUndefined()
  })

  it('scans once at exit and records a ComfyUI that restarted itself', async () => {
    const c = child(100)
    trackSpawn(asProc(c), info)
    await vi.waitFor(() => expect(readRecord('inst-1')?.childStartTime).toBe('1000'))
    c.stderr.emit('data', Buffer.from('x'))
    await vi.waitFor(() => expect(readRecord('inst-1')?.tree).toHaveLength(1))

    restartedCopy()
    fake.tableCalls = 0
    c.emit('exit', 0, null)
    c.emit('close', 0, null)
    await vi.waitFor(() =>
      expect(readRecord('inst-1')?.lingering?.map((m) => m.pid)).toEqual([200])
    )
    await new Promise((r) => setTimeout(r, 1_700))
    expect(fake.tableCalls).toBe(1)
  })

  it('keeps the survivors when a respawn replaces the record before the deferred scan', async () => {
    const c = child(100)
    trackSpawn(asProc(c), info)
    await vi.waitFor(() => expect(readRecord('inst-1')?.childStartTime).toBe('1000'))
    c.stderr.emit('data', Buffer.from('x'))
    await vi.waitFor(() => expect(readRecord('inst-1')?.tree).toHaveLength(1))

    restartedCopy()
    c.emit('exit', 0, null)
    trackSpawn(asProc(child(500)), info)
    await vi.waitFor(
      () => {
        const record = readRecord('inst-1')
        expect(record?.childPid).toBe(500)
        expect(record?.lingering?.map((m) => m.pid)).toEqual([200])
      },
      { timeout: 4_000 }
    )
  })
})

describe('trackSpawn on Windows: races and failures', () => {
  async function running(): Promise<FakeChild> {
    const c = child(100)
    trackSpawn(asProc(c), info)
    await vi.waitFor(() => expect(readRecord('inst-1')?.childStartTime).toBe('1000'))
    return c
  }

  it('never runs two tree snapshots at once when both streams speak together', async () => {
    const c = await running()
    c.stdout.emit('data', Buffer.from('x'))
    c.stderr.emit('data', Buffer.from('y'))
    await vi.waitFor(() => expect(readRecord('inst-1')?.tree).toHaveLength(1))
    expect(fake.maxRowsInFlight).toBe(1)
  })

  it('a launch right after the exit waits for the scan and then stops the restarted copy', async () => {
    const c = await running()
    c.stderr.emit('data', Buffer.from('x'))
    await vi.waitFor(() => expect(readRecord('inst-1')?.tree).toHaveLength(1))
    restartedCopy()
    c.emit('exit', 0, null)
    const kills: number[] = []
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      {
        readRecord,
        removeRecordIf: () => {},
        readStartTimes: async (pids) =>
          new Map(pids.filter((p) => p === 200).map((p) => [p, fake.rows[0]!.created])),
        ownStartTime: async () => 'desktop-start',
        isPidAlive: (pid) => pid === 200,
        portListeners: async () => [200],
        probeQueue: async () => ({ running: 0, pending: 0 }),
        killPidTree: async (pid) => {
          kills.push(pid)
          return { killed: true, exited: true, waitMs: 1 }
        },
        now: () => performance.now(),
        wallNow: () => Date.now(),
        sleep: async () => {}
      }
    )
    expect(kills).toEqual([200])
    expect(out).toMatchObject({ action: 'terminated', lingering: 1 })
  })

  it('leaves the scan to the next launch when the process table cannot be read at exit', async () => {
    const c = await running()
    c.stderr.emit('data', Buffer.from('x'))
    await vi.waitFor(() => expect(readRecord('inst-1')?.tree).toHaveLength(1))
    fake.tableFails = 3
    c.emit('exit', 0, null)
    c.emit('close', 0, null)
    await vi.waitFor(() => expect(readRecord('inst-1')?.pendingScan?.known).toHaveLength(2), {
      timeout: 6_000
    })
    expect(readRecord('inst-1')?.lingering ?? []).toEqual([])
  }, 10_000)
})

describe('exit bookkeeping per session', () => {
  it('runs one at a time, in order, and a launch waits for all of it', async () => {
    const order: string[] = []
    let releaseFirst: () => void = () => {}
    queueExitBookkeeping('inst-2', async () => {
      order.push('first:start')
      await new Promise<void>((r) => {
        releaseFirst = r
      })
      order.push('first:end')
    })
    queueExitBookkeeping('inst-2', async () => {
      order.push('second')
    })
    const settled = settleExitBookkeeping('inst-2').then(() => order.push('settled'))
    await new Promise((r) => setTimeout(r, 20))
    expect(order).toEqual(['first:start'])
    releaseFirst()
    await settled
    expect(order).toEqual(['first:start', 'first:end', 'second', 'settled'])
  })
})
