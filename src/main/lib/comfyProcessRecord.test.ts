import { spawn } from 'child_process'
import fs from 'fs'
import http from 'http'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AddressInfo } from 'net'

const dirs = vi.hoisted(() => ({ state: '' }))
vi.mock('./paths', () => ({ stateDir: () => dirs.state }))

import {
  classifyRecord,
  commandLineIsInstall,
  holderIsInstall,
  listRecords,
  markStopRequested,
  probeQueue,
  readRecord,
  removeRecordIf,
  resolvePriorProcess,
  takePriorSessionUnclean,
  trackSpawn,
  writeRecord,
  QUEUE_PROBE_BUDGET_MS,
  type ComfyProcessRecord,
  type PriorProcessDeps
} from './comfyProcessRecord'
import { isPidAlive } from './processIdentity'

const SELF = { pid: process.pid, start: 'self-start' }

function record(overrides: Partial<ComfyProcessRecord> = {}): ComfyProcessRecord {
  return {
    v: 1,
    sessionKey: 'inst-1',
    installationId: 'inst-1',
    installPath: '/installs/one',
    port: 8188,
    bootId: 'boot-1',
    spawnedAt: 1_000,
    desktopPid: 111,
    desktopStartTime: 'desk-start',
    childPid: 222,
    childStartTime: 'child-start',
    ...overrides
  }
}

beforeEach(() => {
  dirs.state = fs.mkdtempSync(path.join(os.tmpdir(), 'comfy-procs-test-'))
})

afterEach(() => {
  fs.rmSync(dirs.state, { recursive: true, force: true })
})

/** A pid that was just used and is now certainly dead (and reaped). */
async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
  await new Promise((r) => child.once('exit', r))
  return child.pid!
}

describe('classifyRecord (the proof rule)', () => {
  const probe = (times: Record<number, string> | null) => ({
    startTimes: times ? new Map(Object.entries(times).map(([k, v]) => [Number(k), v])) : null,
    selfPid: SELF.pid,
    selfStartTime: SELF.start
  })

  it.each([
    ['child gone', {}, record(), 'stale'],
    ['pid reused by another process', { 222: 'other' }, record(), 'stale'],
    ['OS query failed', null, record(), 'unproven'],
    ['no child start time recorded', { 222: 'x' }, record({ childStartTime: null }), 'unproven'],
    ['owner running', { 222: 'child-start', 111: 'desk-start' }, record(), 'owner_alive'],
    ['owner gone', { 222: 'child-start' }, record(), 'orphan'],
    ['owner pid reused', { 222: 'child-start', 111: 'someone-else' }, record(), 'orphan'],
    [
      'owner alive, start unknown',
      { 222: 'child-start', 111: 'x' },
      record({ desktopStartTime: null }),
      'owner_alive'
    ],
    [
      'owned by this Desktop',
      { 222: 'child-start' },
      record({ desktopPid: SELF.pid, desktopStartTime: SELF.start }),
      'owner_alive'
    ],
    [
      'a previous Desktop that had our pid',
      { 222: 'child-start' },
      record({ desktopPid: SELF.pid, desktopStartTime: 'older' }),
      'orphan'
    ]
  ] as const)('%s → %s', (_name, times, rec, verdict) => {
    expect(classifyRecord(rec, probe(times as Record<number, string> | null))).toBe(verdict)
  })
})

describe('resolvePriorProcess', () => {
  let clock = 10_000
  let removed: Array<[string, number]> = []
  let alive = new Set<number>()
  let kills: Array<[number, string]> = []

  const deps = (overrides: Partial<PriorProcessDeps> = {}): PriorProcessDeps => ({
    readRecord: () => record(),
    removeRecordIf: (key, pid) => {
      removed.push([key, pid])
    },
    readStartTimes: async (pids) =>
      new Map(
        pids
          .filter((p) => alive.has(p))
          .map((p) => [p, p === 222 ? 'child-start' : 'desk-start'] as [number, string])
      ),
    ownStartTime: async () => SELF.start,
    isPidAlive: (pid) => alive.has(pid),
    probeQueue: async () => ({ running: 0, pending: 0 }),
    killPidTree: async (pid, start) => {
      kills.push([pid, start])
      alive.delete(pid)
      return { killed: true, exited: true, waitMs: 30 }
    },
    now: () => clock,
    wallNow: () => clock,
    sleep: async (ms) => {
      clock += ms
    },
    ...overrides
  })

  beforeEach(() => {
    clock = 10_000
    removed = []
    kills = []
    alive = new Set([222])
  })

  it('does nothing without a record', async () => {
    expect(await resolvePriorProcess('inst-1', {}, deps({ readRecord: () => null }))).toBeNull()
  })

  it('drops the record of a child that is already gone, with no OS query', async () => {
    alive.clear()
    const readStartTimes = vi.fn()
    expect(await resolvePriorProcess('inst-1', {}, deps({ readStartTimes }))).toBeNull()
    expect(readStartTimes).not.toHaveBeenCalled()
    expect(removed).toEqual([['inst-1', 222]])
  })

  it('terminates a proven orphan, with the start time it was proven by', async () => {
    const out = await resolvePriorProcess('inst-1', {}, deps())
    expect(kills).toEqual([[222, 'child-start']])
    expect(out).toMatchObject({
      action: 'terminated',
      proof: 'desktop_record',
      exitedInTime: true,
      blocked: null,
      ageMs: 9_000
    })
    expect(removed).toEqual([['inst-1', 222]])
  })

  it('leaves a busy orphan running and blocks the launch', async () => {
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({ probeQueue: async () => ({ running: 1, pending: 0 }) })
    )
    expect(kills).toEqual([])
    expect(out).toMatchObject({ action: 'busy_left', blocked: 'busy', queue: { running: 1 } })
  })

  it('counts queued-but-not-started prompts as busy too', async () => {
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({ probeQueue: async () => ({ running: 0, pending: 3 }) })
    )
    expect(out?.action).toBe('busy_left')
  })

  it('stops a busy orphan once the user has chosen to, without asking the queue', async () => {
    const probeQueue = vi.fn()
    const out = await resolvePriorProcess('inst-1', { stopBusy: true }, deps({ probeQueue }))
    expect(probeQueue).not.toHaveBeenCalled()
    expect(out).toMatchObject({ action: 'terminated', busyOverride: true })
  })

  it('keeps asking a slow orphan until it answers, then acts on the answer', async () => {
    const timeouts: number[] = []
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({
        probeQueue: async (_port, timeoutMs) => {
          timeouts.push(timeoutMs!)
          clock += timeoutMs!
          return timeouts.length < 3 ? null : { running: 1, pending: 0 }
        }
      })
    )
    expect(timeouts).toEqual([1_000, 2_000, 4_000])
    expect(kills).toEqual([])
    expect(out).toMatchObject({ action: 'busy_left', blocked: 'busy', queue: { running: 1 } })
  })

  it('stops a slow orphan that finally answers idle', async () => {
    let calls = 0
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({
        probeQueue: async (_port, timeoutMs) => {
          clock += timeoutMs!
          return ++calls < 2 ? null : { running: 0, pending: 0 }
        }
      })
    )
    expect(out?.action).toBe('terminated')
  })

  it('ends the probe loop even under a clock that never moves, without a pause after the last try', async () => {
    let calls = 0
    let sleeps = 0
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({
        now: () => clock,
        sleep: async () => {
          sleeps++
        },
        probeQueue: async () => {
          calls++
          return null
        }
      })
    )
    expect(calls).toBe(8)
    expect(sleeps).toBe(7)
    expect(out).toMatchObject({ action: 'busy_left', queueUnknown: true })
  })

  it('treats a probe that throws as no answer', async () => {
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({
        probeQueue: async (_port, timeoutMs) => {
          clock += timeoutMs!
          throw new Error('socket hang up')
        }
      })
    )
    expect(kills).toEqual([])
    expect(out).toMatchObject({ action: 'busy_left', queueUnknown: true })
  })

  it('gives each attempt only its own timeout, so a hung probe still gets retried', async () => {
    let calls = 0
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({
        now: () => 0,
        probeQueue: (_port, _timeoutMs) => {
          calls++
          return calls === 1 ? new Promise(() => {}) : Promise.resolve({ running: 1, pending: 0 })
        }
      })
    )
    expect(calls).toBe(2)
    expect(out).toMatchObject({ action: 'busy_left', queue: { running: 1 } })
  })

  it('returns on a cancel during a probe that hangs, without waiting it out', async () => {
    const abort = new AbortController()
    const out = await resolvePriorProcess(
      'inst-1',
      { signal: abort.signal },
      deps({
        now: () => 0,
        // Cancelled once the probe is under way; a probe that ignored the cancel would hang
        // until the budget ran out (8 s of attempts), past the test's own timeout.
        probeQueue: () => {
          abort.abort()
          return new Promise(() => {})
        }
      })
    )
    expect(kills).toEqual([])
    expect(out?.action).toBe('left')
  })

  it('never stops anything after a cancel, even on the "stop it" path', async () => {
    const abort = new AbortController()
    abort.abort()
    const out = await resolvePriorProcess(
      'inst-1',
      { stopBusy: true, signal: abort.signal },
      deps()
    )
    expect(kills).toEqual([])
    expect(out).toBeNull()
  })

  it('carries on when reporting progress throws', async () => {
    const out = await resolvePriorProcess(
      'inst-1',
      {
        onProbe: () => {
          throw new Error('Object has been destroyed')
        }
      },
      deps({ probeQueue: async () => ({ running: 1, pending: 0 }) })
    )
    expect(out).toMatchObject({ action: 'busy_left' })
  })

  it('does not wait past the budget on a probe that never settles', async () => {
    let reads = 0
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({
        // The start and the deadline are read at 0; every later read leaves 50 ms of budget.
        now: () => (reads++ < 2 ? 0 : QUEUE_PROBE_BUDGET_MS - 50),
        probeQueue: () => new Promise(() => {})
      })
    )
    expect(out).toMatchObject({ action: 'busy_left', queueUnknown: true })
    expect(kills).toEqual([])
  })

  it('stops probing and never kills once the launch is cancelled', async () => {
    const abort = new AbortController()
    const onProbe = vi.fn()
    const out = await resolvePriorProcess(
      'inst-1',
      { signal: abort.signal, onProbe },
      deps({
        probeQueue: async (_port, timeoutMs) => {
          clock += timeoutMs!
          abort.abort()
          return { running: 0, pending: 0 }
        }
      })
    )
    expect(onProbe).toHaveBeenCalledOnce()
    expect(kills).toEqual([])
    expect(out?.action).toBe('left')
  })

  it('never stops an orphan that does not answer within the budget: the user decides', async () => {
    const started = clock
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({
        probeQueue: async (_port, timeoutMs) => {
          clock += timeoutMs!
          return null
        }
      })
    )
    expect(kills).toEqual([])
    expect(out).toMatchObject({ action: 'busy_left', blocked: 'busy', queueUnknown: true })
    expect(out?.queue).toBeUndefined()
    expect(clock - started).toBe(QUEUE_PROBE_BUDGET_MS)
  })

  it('never touches a child whose Desktop is still running', async () => {
    alive.add(111)
    const out = await resolvePriorProcess('inst-1', {}, deps())
    expect(kills).toEqual([])
    expect(out).toMatchObject({ action: 'left', proof: 'desktop_record', blocked: null })
  })

  it('never touches a child it cannot prove', async () => {
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({ readRecord: () => record({ childStartTime: null }) })
    )
    expect(kills).toEqual([])
    expect(out).toMatchObject({ action: 'left', proof: 'none' })
  })

  it('drops a record whose pid now belongs to another process', async () => {
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({ readStartTimes: async () => new Map([[222, 'a-different-process']]) })
    )
    expect(out).toBeNull()
    expect(kills).toEqual([])
    expect(removed).toEqual([['inst-1', 222]])
  })

  it('waits for a child that was already asked to stop, and does not kill it', async () => {
    let polls = 0
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({
        readRecord: () => record({ stopRequestedAt: 9_000 }),
        sleep: async (ms) => {
          clock += ms
          if (++polls === 5) alive.delete(222)
        }
      })
    )
    expect(kills).toEqual([])
    expect(out).toMatchObject({ action: 'waited', exitedInTime: true, waitMs: 500 })
  })

  it('gives a stopping child its full grace period after slow checks', async () => {
    let polls = 0
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({
        readRecord: () => record({ stopRequestedAt: 9_000 }),
        // A PowerShell-slow start-time query: 12 s, more than the whole grace period.
        readStartTimes: async (pids) => {
          clock += 12_000
          return new Map(
            pids.filter((p) => alive.has(p)).map((p) => [p, p === 222 ? 'child-start' : 'x'])
          )
        },
        sleep: async (ms) => {
          clock += ms
          if (++polls === 50) alive.delete(222)
        }
      })
    )
    expect(kills).toEqual([])
    expect(out).toMatchObject({ action: 'waited', exitedInTime: true })
  })

  it('blocks when a stopping orphan cannot be re-checked after its wait', async () => {
    let queries = 0
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({
        readRecord: () => record({ stopRequestedAt: 9_000 }),
        readStartTimes: async () => (++queries === 1 ? new Map([[222, 'child-start']]) : null)
      })
    )
    expect(kills).toEqual([])
    expect(out).toMatchObject({ action: 'left', blocked: 'unverified' })
  })

  it('terminates a stopping orphan that outlives the wait', async () => {
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({ readRecord: () => record({ stopRequestedAt: 9_000 }) })
    )
    expect(kills).toHaveLength(1)
    expect(out).toMatchObject({ action: 'terminated', waitMs: 10_000 })
  })

  it('leaves a stopping child whose Desktop is still running after the wait', async () => {
    alive.add(111)
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({ readRecord: () => record({ stopRequestedAt: 9_000 }) })
    )
    expect(kills).toEqual([])
    expect(out?.action).toBe('left')
  })

  it('blocks the launch when the orphan outlives its kill, and keeps the record', async () => {
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({ killPidTree: async () => ({ killed: true, exited: false, waitMs: 10_000 }) })
    )
    expect(out).toMatchObject({ action: 'terminated', exitedInTime: false, blocked: 'stuck' })
    expect(removed).toEqual([])
  })

  it('keeps the record and blocks when the orphan cannot be re-verified at the kill', async () => {
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({
        killPidTree: async () => ({
          killed: false,
          reason: 'probe_failed',
          exited: false,
          waitMs: 15_000
        })
      })
    )
    expect(out).toMatchObject({ action: 'left', blocked: 'unverified' })
    expect(removed).toEqual([])
  })

  it("stops this Desktop's own child when nothing manages it any more", async () => {
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({ readRecord: () => record({ desktopPid: SELF.pid, desktopStartTime: SELF.start }) })
    )
    expect(kills).toEqual([[222, 'child-start']])
    expect(out).toMatchObject({ action: 'terminated', blocked: null })
  })

  it("blocks on this Desktop's own stop that outlived both waits", async () => {
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({
        readRecord: () =>
          record({ desktopPid: SELF.pid, desktopStartTime: SELF.start, stopRequestedAt: 9_000 }),
        killPidTree: async () => ({ killed: true, exited: false, waitMs: 5_000 })
      })
    )
    expect(out).toMatchObject({ action: 'terminated', blocked: 'stuck' })
  })

  it('dates the record by the wall clock but waits by the monotonic one', async () => {
    const out = await resolvePriorProcess('inst-1', {}, deps({ wallNow: () => 3_601_000 }))
    expect(out?.ageMs).toBe(3_600_000)
  })

  it('treats a pid that must never be signalled as not ours, and does not block', async () => {
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({
        killPidTree: async () => ({ killed: false, reason: 'unsafe', exited: false, waitMs: 0 })
      })
    )
    expect(out?.blocked).toBeNull()
    expect(removed).toEqual([['inst-1', 222]])
  })

  it('does not block when the proof lapsed at the moment of the kill', async () => {
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({
        killPidTree: async () => {
          alive.delete(222)
          return { killed: false, reason: 'mismatch', exited: true, waitMs: 1 }
        }
      })
    )
    expect(out).toMatchObject({ action: 'waited', blocked: null, exitedInTime: true })
  })
})

describe('resolvePriorProcess: survivors of an exited child', () => {
  const survivor = { pid: 555, startTime: 'survivor-start' }
  let alive = new Set<number>()
  let kills: number[] = []
  let removed: number[] = []
  const deps = (overrides: Partial<PriorProcessDeps> = {}): PriorProcessDeps => ({
    readRecord: () =>
      record({ desktopPid: SELF.pid, desktopStartTime: SELF.start, lingering: [survivor] }),
    removeRecordIf: (_k, pid) => {
      removed.push(pid)
    },
    readStartTimes: async (pids) =>
      new Map(pids.filter((p) => alive.has(p)).map((p) => [p, p === 555 ? 'survivor-start' : 'x'])),
    ownStartTime: async () => SELF.start,
    isPidAlive: (pid) => alive.has(pid),
    // Idle unless a test says otherwise: a survivor still serving the port answers it.
    probeQueue: async () => ({ running: 0, pending: 0 }),
    portInUse: async () => true,
    killPidTree: async (pid) => {
      kills.push(pid)
      alive.delete(pid)
      return { killed: true, exited: true, waitMs: 5 }
    },
    now: () => 0,
    wallNow: () => 0,
    sleep: async () => {},
    ...overrides
  })

  beforeEach(() => {
    alive = new Set([555])
    kills = []
    removed = []
  })

  it('stops a proven survivor even though the Desktop that spawned the child is running', async () => {
    const out = await resolvePriorProcess('inst-1', {}, deps())
    expect(kills).toEqual([555])
    expect(out).toMatchObject({ action: 'terminated', lingering: 1, blocked: null })
    expect(removed).toEqual([222])
  })

  it('keeps the record and blocks when one survivor stops and another cannot be verified', async () => {
    alive.add(556)
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({
        readRecord: () =>
          record({
            desktopPid: SELF.pid,
            desktopStartTime: SELF.start,
            lingering: [survivor, { pid: 556, startTime: 'other-start' }]
          }),
        readStartTimes: async () =>
          new Map([
            [555, 'survivor-start'],
            [556, 'other-start']
          ]),
        killPidTree: async (pid) =>
          pid === 555
            ? { killed: true, exited: true, waitMs: 5 }
            : { killed: false, reason: 'probe_failed', exited: false, waitMs: 5 }
      })
    )
    expect(out).toMatchObject({ blocked: 'unverified', lingering: 1 })
    expect(removed).toEqual([])
  })

  it('keeps the record and blocks when the survivors cannot be checked at all', async () => {
    const out = await resolvePriorProcess('inst-1', {}, deps({ readStartTimes: async () => null }))
    expect(kills).toEqual([])
    expect(out).toMatchObject({ blocked: 'unverified' })
    expect(removed).toEqual([])
  })

  it('never stops a survivor that is running prompts without the user choosing', async () => {
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({ probeQueue: async () => ({ running: 1, pending: 3 }) })
    )
    expect(kills).toEqual([])
    expect(out).toMatchObject({
      action: 'busy_left',
      blocked: 'busy',
      queue: { running: 1, pending: 3 }
    })
    expect(removed).toEqual([])
  })

  it('stops a busy survivor once the user has chosen to', async () => {
    const probeQueue = vi.fn(async () => ({ running: 1, pending: 0 }))
    const out = await resolvePriorProcess('inst-1', { stopBusy: true }, deps({ probeQueue }))
    expect(probeQueue).not.toHaveBeenCalled()
    expect(kills).toEqual([555])
    expect(out).toMatchObject({ action: 'terminated', lingering: 1 })
  })

  it('asks at once, naming the survivors, when nothing serves the port (no probe to wait on)', async () => {
    const probeQueue = vi.fn(async () => ({ running: 0, pending: 0 }))
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({ portInUse: async () => false, probeQueue })
    )
    expect(probeQueue).not.toHaveBeenCalled()
    expect(kills).toEqual([])
    expect(out).toMatchObject({
      action: 'busy_left',
      blocked: 'busy',
      queueUnknown: true,
      survivorPids: [555]
    })
  })

  it('never stops a survivor that does not answer whether it is busy: the user decides', async () => {
    let t = 0
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({
        now: () => t,
        sleep: async (ms) => {
          t += ms
        },
        probeQueue: async (_port, timeoutMs) => {
          t += timeoutMs!
          return null
        }
      })
    )
    expect(kills).toEqual([])
    expect(out).toMatchObject({ action: 'busy_left', blocked: 'busy', queueUnknown: true })
  })

  it('stops nothing once the launch is cancelled during the survivor check', async () => {
    const abort = new AbortController()
    const out = await resolvePriorProcess(
      'inst-1',
      { signal: abort.signal },
      deps({
        probeQueue: async () => {
          abort.abort()
          return { running: 0, pending: 0 }
        }
      })
    )
    expect(kills).toEqual([])
    expect(out).toBeNull()
  })

  it('reports survivors already stopped when a cancel lands during the stop', async () => {
    const abort = new AbortController()
    const out = await resolvePriorProcess(
      'inst-1',
      { signal: abort.signal },
      deps({
        killPidTree: async (pid) => {
          kills.push(pid)
          alive.delete(pid)
          abort.abort()
          return { killed: true, exited: true, waitMs: 5 }
        }
      })
    )
    expect(kills).toEqual([555])
    expect(out).toMatchObject({ action: 'terminated', lingering: 1, blocked: null })
  })

  it('never stops a survivor pid that now names another process', async () => {
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({ readStartTimes: async () => new Map([[555, 'someone-else']]) })
    )
    expect(kills).toEqual([])
    expect(out).toBeNull()
  })

  it('blocks the launch when a survivor outlives its kill', async () => {
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({ killPidTree: async () => ({ killed: true, exited: false, waitMs: 5_000 }) })
    )
    expect(out).toMatchObject({ blocked: 'stuck', lingering: 1 })
    expect(removed).toEqual([])
  })
})

describe.runIf(process.platform !== 'win32')('survivors of a real process group', () => {
  /** A detached leader (like Desktop's ComfyUI) that starts a long-lived child from `childFile`,
   *  then exits when its stdin closes, which the test does only after `trackSpawn` listens. */
  async function leaderWithChild(
    childFile: string
  ): Promise<{ leader: ReturnType<typeof spawn>; survivorPid: number }> {
    fs.writeFileSync(childFile, 'setTimeout(() => {}, 60000)\n')
    const leader = spawn(
      process.execPath,
      [
        '-e',
        `const c = require('child_process').spawn(process.execPath, [${JSON.stringify(childFile)}], { stdio: 'ignore' }); console.log(c.pid); process.stdin.on('end', () => process.exit(0)); process.stdin.resume()`
      ],
      { stdio: ['pipe', 'pipe', 'ignore'], detached: true }
    )
    const survivorPid = await new Promise<number>((r) =>
      leader.stdout!.once('data', (d: Buffer) => r(Number(String(d).trim())))
    )
    return { leader, survivorPid }
  }

  const info = {
    sessionKey: 'inst-1',
    installationId: 'inst-1',
    installPath: '/x',
    port: 1,
    bootId: 'b'
  }

  it('records a ComfyUI that outlives the child, and the next launch stops only it', async () => {
    // Node runs a file of any name, so a script called main.py stands in for a ComfyUI worker.
    const { leader, survivorPid } = await leaderWithChild(path.join(dirs.state, 'main.py'))
    try {
      trackSpawn(leader, info)
      leader.stdin!.end()
      await vi.waitFor(() => expect(readRecord('inst-1')?.lingering?.[0]?.pid).toBe(survivorPid), {
        timeout: 5_000
      })
      expect(isPidAlive(leader.pid!)).toBe(false)

      // This survivor serves no port, so it never answers the busy check; the next launch asks,
      // and this is the user having chosen "Stop it and launch".
      const out = await resolvePriorProcess('inst-1', { stopBusy: true })
      expect(out).toMatchObject({ action: 'terminated', lingering: 1, exitedInTime: true })
      expect(isPidAlive(survivorPid)).toBe(false)
      expect(readRecord('inst-1')).toBeNull()
    } finally {
      try {
        process.kill(survivorPid, 'SIGKILL')
      } catch {}
    }
  })

  it('never records a survivor that is not ComfyUI (a browser, a model server)', async () => {
    const { leader, survivorPid } = await leaderWithChild(path.join(dirs.state, 'server.js'))
    try {
      trackSpawn(leader, info)
      leader.stdin!.end()
      await vi.waitFor(() => expect(readRecord('inst-1')).toBeNull(), { timeout: 5_000 })
      expect(isPidAlive(survivorPid)).toBe(true)
      expect(await resolvePriorProcess('inst-1')).toBeNull()
      expect(isPidAlive(survivorPid)).toBe(true)
    } finally {
      try {
        process.kill(survivorPid, 'SIGKILL')
      } catch {}
    }
  })

  it('drops the record when nothing outlives the child', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 200)'], {
      stdio: 'ignore',
      detached: true
    })
    trackSpawn(child, {
      sessionKey: 'inst-1',
      installationId: 'inst-1',
      installPath: '/x',
      port: 1,
      bootId: 'b'
    })
    await new Promise((r) => child.once('exit', r))
    await vi.waitFor(() => expect(readRecord('inst-1')).toBeNull())
  })
})

describe('record store', () => {
  it('round-trips, and keys with a colon survive as filenames', () => {
    const r = record({ sessionKey: 'performance-test:inst-1' })
    writeRecord(r)
    expect(readRecord('performance-test:inst-1')).toEqual(r)
    expect(listRecords()).toEqual([r])
  })

  it('skips a file whose name is not one it wrote', () => {
    writeRecord(record())
    fs.writeFileSync(path.join(dirs.state, 'comfy-procs', '50%.json'), '{}')
    expect(listRecords().map((r) => r.sessionKey)).toEqual(['inst-1'])
  })

  it.each([
    ['a numeric start token', { childStartTime: 12345 }],
    ['an out-of-range port', { port: 70000 }],
    ['a zero port', { port: 0 }],
    ['pid 1 as the child', { childPid: 1 }],
    ['pid 0 as the owner', { desktopPid: 0 }],
    ['pid 1 as a survivor', { lingering: [{ pid: 1, startTime: 'x' }] }]
  ])('rejects a record with %s', (_why, bad) => {
    writeRecord({ ...record(), ...bad } as unknown as ComfyProcessRecord)
    expect(readRecord('inst-1')).toBeNull()
  })

  it('reads a corrupt or foreign file as no record', () => {
    fs.mkdirSync(path.join(dirs.state, 'comfy-procs'), { recursive: true })
    fs.writeFileSync(path.join(dirs.state, 'comfy-procs', 'inst-1.json'), '{"v":1,')
    fs.writeFileSync(path.join(dirs.state, 'comfy-procs', 'inst-2.json'), '{"v":2}')
    expect(readRecord('inst-1')).toBeNull()
    expect(listRecords()).toEqual([])
  })

  it('leaves a record it cannot read right now, and drops one that is corrupt', () => {
    const dir = path.join(dirs.state, 'comfy-procs')
    fs.mkdirSync(path.join(dir, 'inst-1.json'), { recursive: true })
    removeRecordIf('inst-1', 222)
    expect(fs.existsSync(path.join(dir, 'inst-1.json'))).toBe(true)
    fs.rmdirSync(path.join(dir, 'inst-1.json'))
    fs.writeFileSync(path.join(dir, 'inst-1.json'), '{"v":1,')
    removeRecordIf('inst-1', 222)
    expect(fs.existsSync(path.join(dir, 'inst-1.json'))).toBe(false)
  })

  it('only removes the record of the child it names', () => {
    writeRecord(record({ childPid: 333 }))
    removeRecordIf('inst-1', 222)
    expect(readRecord('inst-1')?.childPid).toBe(333)
    removeRecordIf('inst-1', 333)
    expect(readRecord('inst-1')).toBeNull()
  })

  it('stamps a stop request once, and only on a record this Desktop wrote', () => {
    writeRecord(record({ sessionKey: 'foreign', desktopPid: 111 }))
    markStopRequested('foreign')
    expect(readRecord('foreign')?.stopRequestedAt).toBeUndefined()
    fs.unlinkSync(path.join(dirs.state, 'comfy-procs', 'foreign.json'))

    writeRecord(record({ desktopPid: process.pid }))
    markStopRequested('inst-1')
    const first = readRecord('inst-1')?.stopRequestedAt
    expect(first).toBeGreaterThan(0)
    markStopRequested('inst-1')
    expect(readRecord('inst-1')?.stopRequestedAt).toBe(first)
    markStopRequested('no-such-session')
    expect(listRecords()).toHaveLength(1)
  })

  it.runIf(process.platform !== 'win32')(
    'tracks a real spawn: start times filled in, record gone when it exits',
    async () => {
      const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
        stdio: 'ignore'
      })
      const info = {
        sessionKey: 'inst-1',
        installationId: 'inst-1',
        installPath: '/x',
        port: 1,
        bootId: 'b'
      }
      trackSpawn(child, info)
      expect(readRecord('inst-1')).toMatchObject({ childPid: child.pid, desktopPid: process.pid })
      await vi.waitFor(() => expect(readRecord('inst-1')?.childStartTime).toBeTruthy())
      expect(readRecord('inst-1')?.desktopStartTime).toBeTruthy()
      const exited = new Promise((r) => child.once('exit', r))
      child.kill('SIGKILL')
      await exited
      // The exit bookkeeping looks for survivors first (asynchronous `ps` on macOS).
      await vi.waitFor(() => expect(readRecord('inst-1')).toBeNull())
    }
  )
})

describe('takePriorSessionUnclean', () => {
  it('reports a record left by a dead Desktop that never stopped its child, once', async () => {
    const dead = await deadPid()
    writeRecord(record({ desktopPid: dead, childPid: process.pid }))
    expect(takePriorSessionUnclean()).toBe(true)
    expect(takePriorSessionUnclean()).toBe(false)
    expect(readRecord('inst-1')).not.toBeNull()
  })

  it('does not report a stop that was requested, and drops records whose child is gone', async () => {
    const dead = await deadPid()
    writeRecord(record({ desktopPid: dead, childPid: dead, stopRequestedAt: 1 }))
    expect(takePriorSessionUnclean()).toBe(false)
    expect(listRecords()).toEqual([])
  })

  it('reports a crash whose child also died, then forgets it', async () => {
    const dead = await deadPid()
    writeRecord(record({ desktopPid: dead, childPid: dead }))
    expect(takePriorSessionUnclean()).toBe(true)
    expect(listRecords()).toEqual([])
  })

  it('does not count a child that exited on its own and left a survivor', async () => {
    const dead = await deadPid()
    writeRecord(
      record({
        desktopPid: dead,
        childPid: dead,
        childExitedAt: 1,
        lingering: [{ pid: process.pid, startTime: 'x' }]
      })
    )
    expect(takePriorSessionUnclean()).toBe(false)
    expect(readRecord('inst-1')).not.toBeNull()
  })

  it('ignores records owned by a running Desktop', () => {
    writeRecord(record({ desktopPid: process.pid, childPid: process.pid }))
    expect(isPidAlive(process.pid)).toBe(true)
    expect(takePriorSessionUnclean()).toBe(false)
  })
})

describe('commandLineIsInstall', () => {
  it.each([
    ['/opt/c/one/.venv/bin/python -s ComfyUI/main.py --port 8188', '/opt/c/one', true],
    ['/opt/c/one-two/.venv/bin/python -s ComfyUI/main.py', '/opt/c/one', false],
    ['/opt/c/one/.venv/bin/python -m pip list', '/opt/c/one', false],
    ['/usr/bin/python -s /opt/c/one/ComfyUI/main.py', '/opt/c/one/', true],
    [
      '/usr/bin/python /elsewhere/main.py /opt/c/one/ComfyUI/user/comfyui.db.lock',
      '/opt/c/one',
      false
    ],
    ['/usr/bin/python -s ComfyUI/main.py --input-directory /opt/c/one/input', '/opt/c/one', false],
    [
      '"C:\\c\\one\\.venv\\Scripts\\python.exe" -s ComfyUI\\main.py --port 8188',
      'C:\\c\\one',
      true
    ],
    ['"C:\\Py\\python.exe" "C:\\c\\one\\ComfyUI\\main.py"', 'C:\\c\\one', true],
    // `ps -o args=` on macOS: nothing is quoted, and install paths can contain spaces.
    [
      '/Users/a/My ComfyUI/.venv/bin/python -s ComfyUI/main.py --port 8188',
      '/Users/a/My ComfyUI',
      true
    ],
    [
      '/usr/bin/python3 -s /Users/a/My ComfyUI (1)/ComfyUI/main.py --listen',
      '/Users/a/My ComfyUI (1)',
      true
    ],
    [
      '/usr/bin/python3 /elsewhere/main.py /Users/a/My ComfyUI/ComfyUI/user/comfyui.db.lock',
      '/Users/a/My ComfyUI',
      false
    ],
    [
      '/usr/bin/python3 -s ComfyUI/main.py --input-directory /Users/a/My ComfyUI/input',
      '/Users/a/My ComfyUI',
      false
    ],
    ['/Users/a/My ComfyUI/.venv/bin/python -m pip list', '/Users/a/My ComfyUI', false],
    // A drive-letter path is absolute: another install's main.py is not this one's relative one.
    ['C:\\c\\one\\.venv\\Scripts\\python.exe C:\\c\\two\\ComfyUI\\main.py', 'C:\\c\\one', false],
    ['C:\\c\\one\\.venv\\Scripts\\python.exe ComfyUI\\main.py', 'C:\\c\\one', true]
  ])('%s in %s → %s', (cmd, installPath, expected) => {
    expect(commandLineIsInstall(cmd, installPath)).toBe(expected)
  })
})

describe('commandLineIsInstall with an exact argv', () => {
  it('matches spaced paths exactly and ignores mentions', () => {
    const root = '/home/a/My ComfyUI'
    expect(commandLineIsInstall([`${root}/.venv/bin/python`, '-s', 'ComfyUI/main.py'], root)).toBe(
      true
    )
    expect(commandLineIsInstall(['/usr/bin/python3', `${root}/ComfyUI/main.py`], root)).toBe(true)
    expect(
      commandLineIsInstall(['/usr/bin/python3', '/x/main.py', `${root}/ComfyUI/user/a.lock`], root)
    ).toBe(false)
  })
})

describe.runIf(process.platform === 'linux')('holderIsInstall (real process, spaced path)', () => {
  it.each([
    ['relative main.py run by the install venv interpreter', true],
    ['absolute main.py inside the install', false]
  ])('%s', async (_name, relative) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'My ComfyUI ('))
    const install = path.join(root, 'Install One')
    fs.mkdirSync(path.join(install, 'ComfyUI'), { recursive: true })
    fs.mkdirSync(path.join(install, '.venv', 'bin'), { recursive: true })
    fs.writeFileSync(path.join(install, 'ComfyUI', 'main.py'), 'setTimeout(() => {}, 60000)\n')
    const interpreter = path.join(install, '.venv', 'bin', 'python')
    fs.symlinkSync(process.execPath, interpreter)
    const child = relative
      ? spawn(interpreter, [path.join('ComfyUI', 'main.py')], { cwd: install, stdio: 'ignore' })
      : spawn(process.execPath, [path.join(install, 'ComfyUI', 'main.py')], { stdio: 'ignore' })
    try {
      await vi.waitFor(async () => {
        const argv = await fs.promises.readFile(`/proc/${child.pid}/cmdline`, 'utf-8')
        expect(argv).toContain('main.py')
      })
      expect(await holderIsInstall(child.pid!, install)).toBe(true)
      expect(await holderIsInstall(child.pid!, path.join(root, 'Install Two'))).toBe(false)
    } finally {
      child.kill('SIGKILL')
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('probeQueue', () => {
  let server: http.Server | null = null
  afterEach(async () => {
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()))
    server = null
  })

  async function serve(handler: http.RequestListener): Promise<number> {
    server = http.createServer(handler)
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()))
    return (server.address() as AddressInfo).port
  }

  it('answers null for a port that cannot be probed, without throwing', async () => {
    expect(await probeQueue(0)).toBeNull()
    expect(await probeQueue(70000)).toBeNull()
  })

  it('counts running and pending prompts', async () => {
    const port = await serve((req, res) => {
      expect(req.url).toBe('/queue')
      res.end(JSON.stringify({ queue_running: [[1]], queue_pending: [[2], [3]] }))
    })
    expect(await probeQueue(port)).toEqual({ running: 1, pending: 2 })
  })

  it.each([
    ['not JSON', (_q: http.IncomingMessage, res: http.ServerResponse) => res.end('<html>')],
    ['not a queue', (_q: http.IncomingMessage, res: http.ServerResponse) => res.end('{}')],
    [
      'an error status',
      (_q: http.IncomingMessage, res: http.ServerResponse) => {
        res.statusCode = 500
        res.end('{"queue_running":[],"queue_pending":[]}')
      }
    ]
  ])('answers null for %s', async (_name, handler) => {
    expect(await probeQueue(await serve(handler))).toBeNull()
  })

  it('answers null when nothing listens, and when it hangs (its own timer ends the wait)', async () => {
    // The server never responds: only the probe's own timeout can settle this.
    const port = await serve(() => {})
    expect(await probeQueue(port, 200)).toBeNull()
    server!.closeAllConnections()
    await new Promise<void>((r) => server!.close(() => r()))
    server = null
    expect(await probeQueue(port, 200)).toBeNull()
  })
})
