import { EventEmitter } from 'events'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChildProcess } from 'child_process'
import type * as ProcessIdentity from './processIdentity'

/** The Windows bookkeeping paths of `trackSpawn`, with the process table faked. */
const fake = vi.hoisted(() => ({
  state: '',
  rows: [] as Array<{ pid: number; ppid: number; created: string; commandLine: string }>,
  tableCalls: 0
}))
vi.mock('./paths', () => ({ stateDir: () => fake.state }))
vi.mock('./processIdentity', async (importOriginal) => {
  const actual = await importOriginal<typeof ProcessIdentity>()
  return {
    ...actual,
    windowsProcessRows: async () =>
      fake.rows.map(({ pid, ppid, created }) => ({ pid, ppid, created })),
    windowsProcessTable: async () => {
      fake.tableCalls++
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

import { filetimeOf, readRecord, trackSpawn } from './comfyProcessRecord'

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
function child(pid: number): FakeChild {
  const c = new EventEmitter() as FakeChild
  c.stdout = new EventEmitter()
  c.stderr = new EventEmitter()
  c.pid = pid
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
  // Launcher 100 and its interpreter 101, both from well before the exit.
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
afterEach(() => {
  fs.rmSync(fake.state, { recursive: true, force: true })
})

/** What a ComfyUI that replaced itself leaves: a new venv launcher under the dead interpreter. */
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
    // Pipes held by the restarted copy: no `close`. Desktop respawns before the scan runs.
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
